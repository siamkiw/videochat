const http = require("http");
const crypto = require("crypto");
const fs = require("fs");

const port = 1412;

const server = http.createServer((req, res) => {
  if (req.url === "/" && req.method === "GET") {
    console.log("on GET /");

    res.writeHead(200, { "Content-Type": "text/html" });

    const files = fs.readFileSync("./static/index.html");

    res.write(files);

    res.end();
  }
  else if (req.url === "/rtcchat" && req.method === "GET"){
    console.log("on GET /rctchat")
    res.writeHead(200, { "Content-Type": "text/html" })

    const file = fs.readFileSync("./static/rtcChat.html")

    res.write(file)

    res.end()

  }
   else {
    res.writeHead(200, { "Content-Type": "text/html" });

    res.end(`
        <h1>WELCOME CHAT APP</h1>
        <a href="/">Go to index page.</a>
        `);
  }
});


let clients = []
server.on('upgrade', function (req, socket) {
    if (req.headers['upgrade'] !== 'websocket') {
        socket.end('HTTP/1.1 400 Bad Request');
        return;
    }
    // Read the websocket key provided by the client: 
    const acceptKey = req.headers['sec-websocket-key'];
    // Generate the response value to use in the response: 
    const hash = generateAcceptValue(acceptKey);
    // Write the HTTP response into an array of response lines: 
    const responseHeaders = ['HTTP/1.1 101 Web Socket Protocol Handshake', 'Upgrade: WebSocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${hash}`];
    // Write the response back to the client socket, being sure to append two 
    // additional newlines so that the browser recognises the end of the response 
    // header and doesn't continue to wait for more header data: 

    // Read the subprotocol from the client request headers:
    const protocol = req.headers['sec-websocket-protocol'];
    console.log('protocol from client--->', protocol)
    // If provided, they'll be formatted as a comma-delimited string of protocol
    // names that the client supports; we'll need to parse the header value, if
    // provided, and see what options the client is offering:
    const protocols = !protocol ? [] : protocol.split(',').map(s => s.trim());
    console.log('protocols--->', protocols)
    // To keep it simple, we'll just see if JSON was an option, and if so, include
    // it in the HTTP response:
    if (protocols.includes('json')) {
        // Tell the client that we agree to communicate with JSON data
        responseHeaders.push(`Sec-WebSocket-Protocol: json`);
    }
    clients.push(socket)
    socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');
    console.log("client :", clients.length)

    // socket.on('data', function incoming(message) {
    //     console.log('received: %s', message);
    // });

    // socket.on('data', buffer =>{
    //     console.log('received: %s',  buffer);
    // });

    // -------------------------------------------------------------
    socket.on('data', buffer => {
        console.log('buffer-->', buffer)
        const message = parseMessage(buffer);
        // console.log('message-->', message)
        if (message) {
            // For our convenience, so we can see what the client sent
            console.log(message);
            // We'll just send a hardcoded message in this example 
            // socket.write(constructReply({ message: 'Hello from the server!' }));
            
            clients.forEach(function(client) {
                client.write(constructReply({ received_message: message }));
              });
        } else if (message === null) {
            console.log('WebSocket connection closed by the client.');
        }
    });
    function constructReply(data) {
        // TODO: Construct a WebSocket frame Node.js socket buffer
        // Convert the data to JSON and copy it into a buffer
        const json = JSON.stringify(data)
        const jsonByteLength = Buffer.byteLength(json);
        // Note: we're not supporting > 65535 byte payloads at this stage 
        const lengthByteCount = jsonByteLength < 126 ? 0 : 2;
        const payloadLength = lengthByteCount === 0 ? jsonByteLength : 126;
        const buffer = Buffer.alloc(2 + lengthByteCount + jsonByteLength);
        // Write out the first byte, using opcode `1` to indicate that the message 
        // payload contains text data 
        buffer.writeUInt8(0b10000001, 0);
        buffer.writeUInt8(payloadLength, 1);
        // Write the length of the JSON payload to the second byte 
        let payloadOffset = 2;
        if (lengthByteCount > 0) {
            buffer.writeUInt16BE(jsonByteLength, 2); payloadOffset += lengthByteCount;
        }
        // Write the JSON data to the data buffer 
        buffer.write(json, payloadOffset);
        return buffer;
    }


    function parseMessage(buffer) {
        const firstByte = buffer.readUInt8(0);
        console.log('firstByte-->', firstByte)

        // console.log(' isFinalFrame -->', firstByte >>> 7)
        // const isFinalFrame = Boolean((firstByte >>> 7) & 0×1);
        const isFinalFrame = Boolean((firstByte >>> 7) & 0x1);

        const [reserved1, reserved2, reserved3] = [Boolean((firstByte >>> 6) & 0x1), Boolean((firstByte >>> 5) & 0x1), Boolean((firstByte >>> 4) & 0x1)];

        const opCode = firstByte & 0xF;  // 0xF are reserved for further control frames

        // We can return null to signify that this is a connection termination frame 
        if (opCode === 0x8)
            return null;
        // We only care about text frames from this point onward 
        if (opCode !== 0x1)
            return;
        const secondByte = buffer.readUInt8(1);
        const isMasked = Boolean((secondByte >>> 7) & 0x1);
        // Keep track of our current position as we advance through the buffer 
        let currentOffset = 2;
        let payloadLength = secondByte & 0x7F;
        if (payloadLength > 125) {
            if (payloadLength === 126) {
                payloadLength = buffer.readUInt16BE(currentOffset);
                currentOffset += 2;
            } else {
                // 127 
                // If this has a value, the frame size is ridiculously huge! 
                const leftPart = buffer.readUInt32BE(currentOffset);
                const rightPart = buffer.readUInt32BE(currentOffset += 4);
                // Honestly, if the frame length requires 64 bits, you're probably doing it wrong. 
                // In Node.js you'll require the BigInt type, or a special library to handle this. 
                throw new Error('Large payloads not currently implemented');
            }
        }

        let maskingKey;
        if (isMasked) {
            maskingKey = buffer.readUInt32BE(currentOffset);
            currentOffset += 4;
        }
        // Allocate somewhere to store the final message data
        const data = Buffer.alloc(payloadLength);
        // Only unmask the data if the masking bit was set to 1
        if (isMasked) {
            // Loop through the source buffer one byte at a time, keeping track of which
            // byte in the masking key to use in the next XOR calculation
            for (let i = 0, j = 0; i < payloadLength; ++i, j = i % 4) {
                // Extract the correct byte mask from the masking key
                const shift = j == 3 ? 0 : (3 - j) << 3;
                const mask = (shift == 0 ? maskingKey : (maskingKey >>> shift)) & 0xFF;
                // Read a byte from the source buffer 
                const source = buffer.readUInt8(currentOffset++);
                // XOR the source byte and write the result to the data 
                // console.log('buffer.data-->',buffer.data)
                data.writeUInt8(mask ^ source, i);
            }
        } else {
            // Not masked - we can just read the data as-is
            buffer.copy(data, 0, currentOffset++);
        }
        // const json = data.toString('utf8');
        // console.log('json-->',typeof json)
        // return JSON.parse(json);
        console.log("data not to string yet: ", data)
        const message = data.toString('utf8');
        // console.log('json-->',typeof json)
        return message;
    }


});

// read data form buffer 
// function send(data, encoding, callback) {
//     var socket = this;
//     var header;
//     var payload = new Buffer(data, encoding);
//     var len = payload.length;
//     if (len <= 125) {
//       header = new Buffer(2);
//       header[1] = len;
//     } else if (len <= 0xffff) {
//       header = new Buffer(4);
//       header[1] = 126;
//       header[2] = (len >> 8) & 0xff;
//       header[3] = len & 0xff;
//     } else { /* 0xffff < len <= 2^63 */
//       header = new Buffer(10);
//       header[1] = 127;
//       header[2] = (len >> 56) & 0xff;
//       header[3] = (len >> 48) & 0xff;
//       header[4] = (len >> 40) & 0xff;
//       header[5] = (len >> 32) & 0xff;
//       header[6] = (len >> 24) & 0xff;
//       header[7] = (len >> 16) & 0xff;
//       header[8] = (len >> 8) & 0xff;
//       header[9] = len & 0xff;
//     }
//     header[0] = 0x81;
//     // socket.write(Buffer.concat([header, payload], header.length + payload.length), 'binary', callback);
//   }

function generateAcceptValue(acceptKey) {
  return crypto
    .createHash("sha1")
    .update(acceptKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", "binary")
    .digest("base64");
}

server.listen(port, () => {
  console.log("listen on port : ", port);
});



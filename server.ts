// Note: I'm learning javascript so the comments aren't AI!!
// It just means I'm trying to understand everything!!
// Normally I dont care about making comments otherwise

import { RateLimiterMemory } from "rate-limiter-flexible";
import { Socket } from "socket.io";
import ChatMessage from "./types/ChatMessageObject";

const PORT = process.env.PORT || 3000; // This will mean if in a server, use its port, and if it can't find anyting, use default port 3000
const express = require('express'); // Get the Express.js package
const app = express(); // Create a new express app instance
const http = require('http'); // Get the HTTP package
const server = http.createServer(app); // Create an HTTP server using the new express app as its handler
const { Server } = require("socket.io") // Get the Socket.IO package

const io = new Server(server, process.env.NODE_ENV !== 'production' ? {cors: {
    origin: "http://localhost:5173"
  }
} : {cors: {}}); // Create a new Socket.IO instance using the created HTTP server

function getRandomInt(max: number) { // temp
  return Math.floor(Math.random() * max);
}

const rateLimiter = new RateLimiterMemory(
{
  points: 10, // 10 points
  duration: 3, // per 3 seconds
});

io.on('connection', (socket: Socket) => { // Receive this when a user has ANY connection event to the Socket.IO server
  console.log('a user connected');
  socket.emit('get user id', getRandomInt(100000)) // TODO: login flow. this is temp
  
  socket.on('message sent', async (msg: ChatMessage) => { // Received when the "message sent" gets called from a client
      try {
        await rateLimiter.consume(socket.handshake.address); // consume 1 point per event from IP
        io.emit('client receive message', msg); // Emit it to everyone else!
      } catch(rejRes) {
        // no available points to consume
        // emit error or warning message
        socket.emit('rate limited');
      }
    });
  
    socket.on('disconnect', (reason) => { // Called when a user is disconneted for any reason, passed along with the reason arg.
      console.log(`User disconnected because: ${reason}`);
    });
  });

server.listen(PORT, () => { // Start the server at the chosen port
  console.log('listening on *:3000');
});
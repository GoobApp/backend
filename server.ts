// Note: I'm learning javascript so the comments aren't AI!!
// It just means I'm trying to understand everything!!
// Normally I dont care about making comments otherwise

import { RateLimiterMemory } from "rate-limiter-flexible";
import { Socket } from "socket.io";
import ChatMessage from "./types/ChatMessageObject";

const PORT = process.env.PORT || 3000; // This will mean if in a server, use its port, and if it can't find anyting, use default port 3000
const express = require("express"); // Get the Express.js package
const app = express(); // Create a new express app instance
const http = require("http"); // Get the HTTP package
const server = http.createServer(app); // Create an HTTP server using the new express app as its handler
const { Server } = require("socket.io"); // Get the Socket.IO package

const io = new Server(server, {
  cors: {
    origin: [
      "https://goobapp.github.io",
      "https://goobapp.org",
      "http://localhost:5173", // For developement
    ],
  },
}); // Create a new Socket.IO instance using the created HTTP server

import { createClient, Session } from "@supabase/supabase-js";

const supabaseUrl = "https://wfdcqaqihwsilzegcknq.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY;
let usingSupabase: boolean = false;

if (!supabaseKey) {
  console.error("No supabase key found!");
  // process.exit(1); // Exit with a non-zero code to indicate an error
} else {
  usingSupabase = true;
  const supabase = createClient(supabaseUrl, supabaseKey);
}

const rateLimiter = new RateLimiterMemory({
  points: 7, // 7 messages
  duration: 3, // per 5 seconds
});

const immediateRateLimiter = new RateLimiterMemory({
  points: 1, // 1 message
  duration: 0.2, // per 0.2 seconds
});

io.on("connection", (socket: Socket) => {
  // Receive this when a user has ANY connection event to the Socket.IO server
  console.log("a user connected");

  socket.on("message sent", async (msg: ChatMessage, session: Session) => {
    if (!session) return;

    // Received when the "message sent" gets called from a client
    try {
      await rateLimiter.consume(session.user.id); // consume 1 point per event per each user ID
      await immediateRateLimiter.consume(session.user.id); // do this for immediate stuff (no spamming every 0.1 seconds)
      if (msg.messageContent.length <= 1201) {
        io.emit("client receive message", msg); // Emit it to everyone else!
      }
    } catch (rejRes) {
      // No available points to consume
      // Emit error or warning message
      socket.emit("rate limited");
    }
  });

  socket.on("disconnect", (reason) => {
    // Called when a user is disconneted for any reason, passed along with the reason arg.
    console.log(`User disconnected because: ${reason}`);
  });
});

server.listen(PORT, () => {
  // Start the server at the chosen port
  console.log(`listening on *:${PORT}`);
});

// Note: I'm learning javascript so the comments aren't AI!!
// It just means I'm trying to understand everything!!
// Normally I dont care about making comments otherwise

import { RateLimiterMemory } from "rate-limiter-flexible";
import { Socket } from "socket.io";
import ChatMessage from "./types/ChatMessageObject";

const PORT = process.env.PORT || 3000; // This will mean if in a server, use its port, and if it can't find anything, use default port 3000
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
      "http://localhost:5173", // For development
    ],
  },
}); // Create a new Socket.IO instance using the created HTTP server

import { createClient, Session, SupabaseClient } from "@supabase/supabase-js";
import UserProfile from "./types/UserProfileObject";

const supabaseUrl = "https://wfdcqaqihwsilzegcknq.supabase.co";

const supabaseKey = process.env.SUPABASE_KEY;
let usingSupabase: boolean = false;
let supabase: SupabaseClient;
let activeUsers: { [socketId: string]: UserProfile } = {};

if (!supabaseKey) {
  console.error("No supabase key found!");
  // process.exit(1); // Exit with a non-zero code to indicate an error
} else {
  console.log("Supabase key found!");
  usingSupabase = true;
  supabase = createClient(supabaseUrl, supabaseKey);
}

const rateLimiter = new RateLimiterMemory({
  points: 7, // 7 messages
  duration: 3, // per 5 seconds
});

const immediateRateLimiter = new RateLimiterMemory({
  points: 1, // 1 message
  duration: 0.2, // per 0.2 seconds
});

const verifyValidity = async (socket: Socket) => {
  if (!usingSupabase) {
    return true;
  }

  const token = socket.handshake.auth.token;
  const {
    data: { user },
    error: tokenError,
  } = await supabase.auth.getUser(token);
  return !(tokenError || !user);
};

io.on("connection", (socket: Socket) => {
  // Receive this when a user has ANY connection event to the Socket.IO server

  socket.on("request recent messages", async () => {
    if ((await verifyValidity(socket)) != true) return;
    if (!usingSupabase) return; // Can later warn not using database but meh not right now
    const { data: messagesData, error: messagesError } = await supabase
      .from("messages")
      .select("*,profiles(username,profile_image_url,role)")
      .order("message_id", { ascending: false })
      .limit(25); // Change to number of messages you want to give to the user, but PLEASE do not let the user pick aaaaaaa NOT A GOOD IDEA anyways

    if (messagesError) {
      console.error("Could not get recent messages: " + messagesError);
      return;
    }

    const formattedData: ChatMessage[] = messagesData.map((row) => {
      return {
        userDisplayName: row.profiles.username,
        userProfilePicture: row.profiles.profile_image_url,
        userUUID: row.user_uuid,
        messageContent: row.message_content,
        messageId: row.message_id,
        messageTime: row.created_at,
        isEdited: row.is_edited,
      };
    });

    socket.emit("receive recent messages", formattedData);
  });

  socket.on("request active users", async () => {
    if ((await verifyValidity(socket)) != true) return;
    socket.emit("receive active users", Object.values(activeUsers));
  });

  socket.on("delete message", async (messageID: number ) => {
    if ((await verifyValidity(socket)) != true) return;
    const { error } = await supabase.from("messages").delete().eq("message_id", messageID);
    if (error)
    {
      console.error("Error while attempting to delete message: " + error);
      return;
    }
    else
    {
      io.emit("deleted message", messageID);
    }
  });

  socket.on("give user role", async (userUUID: string, role: string) => {
    if ((await verifyValidity(socket)) != true) return;
    const { error } = await supabase.from("profiles").update({role: role != "" ? role : null}).eq("user_uuid", userUUID);

    if (error)
    {
      console.error("Error while attempting to give user role: " + error);
    }

    // TODO: (maybe) send an update to everyone so they don't have to reload to see it
  });

  socket.on("edit message", async (newId: number, newContent: string) => {
    if (!usingSupabase) {
      io.emit("message edited", newId, newContent);
    } else {
      if ((await verifyValidity(socket)) != true) return;
      const token = socket.handshake.auth.token;
      const {
        data: { user },
        error: tokenError,
      } = await supabase.auth.getUser(token);

      if (tokenError || !user) {
        return new Error("Authentication error");
      }

      const { error } = await supabase
        .from("messages")
        .update({
          // Edit the specific message thing
          message_content: newContent,
          is_edited: true,
        })
        .eq("message_id", newId);

      if (error) {
        console.error("Could not update message (just couldn't idk): " + error);
      } else {
        io.emit("message edited", newId, newContent);
      }
    }
  });

  socket.on("message sent", async (msg: ChatMessage, session: Session) => {
    // Received when the "message sent" gets called from a client

    if ((await verifyValidity(socket)) != true) return;

    if (msg.messageContent.length <= 1201) {
      if (usingSupabase) {
        // Only insert if actually using Supabase!
        const { data, error } = await supabase
          .from("messages")
          .insert({
            // Insert a message into the Supabase table
            user_uuid: msg.userUUID,
            message_content: msg.messageContent,
          })
          .select("message_id");

        if (!data) {
          return;
        }

        msg.messageId = data[0].message_id;

        if (error) {
          console.error("Could not insert message: " + error);
        } else {
          try {
            await rateLimiter.consume(socket.id); // consume 1 point per event per each user ID
            await immediateRateLimiter.consume(socket.id); // do this for immediate stuff (no spamming every 0.1 seconds)
            io.emit("client receive message", msg); // Emit it to everyone else!
          } catch (rejRes) {
            // No available points to consume
            // Emit error or warning message
            socket.emit("rate limited");
          }
        }
      }
    }
  });

  socket.on("disconnect", (reason) => {
    // Called when a user is disconnected for any reason, passed along with the reason arg.

    const activeUser = activeUsers[socket.id];

    if (activeUser) {
      io.emit("remove active user", activeUser);
      delete activeUsers[socket.id];
    }
  });

  socket.on("add to active users list", async (user: UserProfile) => {
    if ((await verifyValidity(socket)) != true) return;

    if (!user) {
      console.warn(`User null! User: ${user}`);
      return;
    }

    for (const [key, value] of Object.entries(activeUsers)) {
      if (value.userUUID === user.userUUID && key != socket.id) {
        delete activeUsers[key];
      }
    }

    activeUsers[socket.id] = user;
    io.emit("new active user", user);
  });
});

server.listen(PORT, () => {
  // Start the server at the chosen port
  console.log(`listening on *:${PORT}`);
});
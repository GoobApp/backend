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

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import UserProfile from "./types/UserProfileObject";

require("dotenv").config();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

let usingSupabase: boolean = false;
let supabase: SupabaseClient;
let activeUsers: { [socketId: string]: UserProfile } = {};

if (!SUPABASE_KEY || !SUPABASE_URL) {
  console.error("No supabase key found!");
  // process.exit(1); // Exit with a non-zero code to indicate an error
} else {
  console.log("Supabase key found!");
  usingSupabase = true;
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

const rateLimiter = new RateLimiterMemory({
  points: 7, // 7 messages
  duration: 3, // per 5 seconds
});

const immediateRateLimiter = new RateLimiterMemory({
  points: 1, // 1 message
  duration: 0.2, // per 0.2 seconds
});

const verifyValidity = async (
  socket: Socket
): Promise<{ role: string | null; uuid: string }> => {
  if (!usingSupabase) {
    return { role: "Owner", uuid: socket.handshake.auth.token };
  }

  const token = socket.handshake.auth.token;
  const { data: authData, error: authError } = await supabase.auth.getUser(
    token
  );
  const userId = authData?.user?.id;

  if (authError || !userId) {
    return { role: "tokenError", uuid: token };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_uuid", userId)
    .maybeSingle();

  const finalUUID = userId ?? token;

  if (error) {
    return { role: "tokenError", uuid: finalUUID };
  } else {
    return {
      role: data ? data.role : null,
      uuid: finalUUID,
    };
  }
};

io.on("connection", (socket: Socket) => {
  // Receive this when a user has ANY connection event to the Socket.IO server

  socket.on("request recent messages", async () => {
    const role = await verifyValidity(socket);
    if (role.role == "tokenError") return;

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
        messageImageUrl: row.message_image_url,
        messageId: row.message_id,
        messageTime: row.created_at,
        isEdited: row.is_edited,
      };
    });

    socket.emit("receive recent messages", formattedData);
  });

  socket.on("request active users", async () => {
    const role = await verifyValidity(socket);
    if (role.role == "tokenError") return;

    socket.emit("receive active users", Object.values(activeUsers));
  });

  socket.on("delete message", async (messageID: number) => {
    // FIXME: anybody can pretend to be owner/user (maybe?)
    const role = await verifyValidity(socket);
    if (role.role == "tokenError") return;

    if (!usingSupabase) {
      io.emit("deleted message", messageID);
      console.log("deleted message!");
      return;
    }

    // const token = socket.handshake.auth.token;
    // const supabaseUser = createClient(SUPABASE_URL, SUPABASE_KEY, {
    //   global: { headers: { Authorization: `Bearer ${token}` } },
    // });

    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("message_id", messageID);
    if (error) {
      console.error("Error while attempting to delete message: " + error);
      return;
    } else {
      io.emit("deleted message", messageID);
    }
  });

  socket.on("give user role", async (userUUID: string, newRole: string) => {
    const user = await verifyValidity(socket);
    if (user.role != "Owner") return;
    if (newRole == "Owner") return; // Don't allow people to give owner role!

    const { error } = await supabase
      .from("profiles")
      .update({ role: newRole != "" ? newRole : null })
      .eq("user_uuid", userUUID)
      .or("role.is.null,role.neq.Owner");

    if (error) {
      console.error("Error while attempting to give user role: " + error);
    } else {
      for (const [socketId, profile] of Object.entries(activeUsers)) {
        if (profile.userUUID == userUUID) {
          activeUsers[socketId].userRole = newRole;
          return;
        }
      }
    }

    // TODO: (maybe) send an update to everyone so they don't have to reload to see it
  });

  socket.on("edit message", async (newId: number, newContent: string) => {
    // FIXME: anybody can pretend to be owner/user (maybe)
    if (!usingSupabase) {
      io.emit("message edited", newId, newContent);
      console.log("edited message!");
    } else {
      const role = await verifyValidity(socket);
      if (role.role == "tokenError") return;

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

  socket.on("message sent", async (msg: ChatMessage) => {
    // Received when the "message sent" gets called from a client

    const user = await verifyValidity(socket);
    if (user.role == "tokenError") return;

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
      } else {
        console.log("sending message!");
        io.emit("client receive message", msg); // Emit it to everyone else!
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
    const role = await verifyValidity(socket);
    if (role.role == "tokenError") return;

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

  socket.on("upload image", async (file: ArrayBuffer, fileType: string) => {
    const user = await verifyValidity(socket);
    if (user.role == "tokenError") return;

    if (!fileType.startsWith("image/")) {
      console.error("Not an image file!");
      return;
    }

    const fileBlob = new Blob([file], { type: fileType });
    const formData = new FormData();
    formData.append("image", fileBlob, fileType);

    if (!process.env.IMGBB_KEY) {
      console.error("No imgBB key!1!");
      return;
    }

    if (!usingSupabase) console.log("Uploading image...");

    fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_KEY}`, {
      method: "POST",
      body: formData,
    })
      .then((response) => {
        if (!response.ok) {
          // If the response is not OK, parse the body for a custom message
          // and throw an error to trigger the .catch block.
          return response.json().then((errorData) => {
            throw new Error(
              errorData.message || `HTTP error! status: ${response.status}`
            );
          });
        }

        return response.json();
      })
      .then(async (img) => {
        let message = {
          userDisplayName: "Image",
          userProfilePicture: "",
          userUUID: user.uuid,
          messageContent: "",
          messageImageUrl: img.data.url,
          messageTime: Date.now(),
          messageId: 0,
          isEdited: false,
        };

        // Only insert if actually using Supabase!
        if (usingSupabase) {
          const { data, error } = await supabase
            .from("messages")
            .insert({
              // Insert a message into the Supabase table
              user_uuid: user.uuid,
              message_image_url: img.data.url,
            })
            .select("*,profiles(username,profile_image_url,role)")
            .single();

          if (!data) {
            console.error(
              error
                ? `Supabase error: ${error.message}! Hint: ${error.hint}`
                : "Supabase error!"
            );
            return;
          }

          message.messageId = data.message_id;
          message.messageTime = data.created_at;
          message.userDisplayName = data.profiles.username;
          message.userProfilePicture = data.profiles.profile_image_url;

          if (error) {
            console.error("Could not insert message: " + error);
          } else {
            try {
              await rateLimiter.consume(socket.id); // consume 1 point per event per each user ID
              await immediateRateLimiter.consume(socket.id); // do this for immediate stuff (no spamming every 0.1 seconds)
              io.emit("client receive message", message); // Emit it to everyone else!
            } catch (rejRes) {
              // No available points to consume
              // Emit error or warning message
              socket.emit("rate limited");
            }
          }
        } else {
          console.log("Image uploaded: " + img.data.url);
          io.emit("client receive message", message); // Emit it to everyone else!
        }
      })
      .catch((error) => {
        console.log("Fetch error:", error.message);
      });
  });
});

server.listen(PORT, () => {
  // Start the server at the chosen port
  console.log(`listening on *:${PORT}`);
});

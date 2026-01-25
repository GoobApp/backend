// Note: I'm learning javascript so the comments aren't AI!!
// It just means I'm trying to understand everything!!
// Normally I don't care about making comments otherwise

import express from "express";
import http from "http"; // Get the HTTP package
import { RateLimiterMemory } from "rate-limiter-flexible";
import { Server, Socket } from "socket.io";
import SendMessageToAI from "./GoobAI";
import ChatMessage from "./types/ChatMessageObject";

const PORT = process.env.PORT || 3000; // This will mean if in a server, use its port, and if it can't find anything, use default port 3000
const app = express(); // Create a new express app instance
const server = http.createServer(app); // Create an HTTP server using the new express app as its handler

app.get("/", (req, res) => {
  res.redirect("https://goobapp.org");
});

const corsOptions = {
  origin: [
    "https://goobapp.pages.dev",
    "https://goobapp.org",
    "https://www.goobapp.org",
    "http://localhost:5173", // For development
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
};

import cors from "cors";

app.use(cors(corsOptions));
app.options("/upload", cors(corsOptions));

const io = new Server(server, {
  cors: corsOptions,
}); // Create a new Socket.IO instance using the created HTTP server

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import UserProfile from "./types/UserProfileObject";

require("dotenv").config();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

let usingSupabase: boolean = false;
let supabase: SupabaseClient;
let activeUsers: { [socketId: string]: UserProfile } = {};

const mapData = (data: any) => {
  // uh oh any type im lazy!!
  let msg: ChatMessage = {
    messageContent: data.message_content,
    messageId: data.message_id,
    isEdited: false,
    messageTime: data.created_at,
    userUUID: data.user_uuid,
    userDisplayName: data.profiles.username,
    userProfilePicture: data.profiles.profile_image_url,
    userRole: data.profiles.role,
    messageImageUrl: "",
  };

  return msg;
};

let recentMessages: ChatMessage[] = [];
const maxMessageContext = 10;
let customAddedPrompt: string | null = null;
let customPrompt: string | null = null;

const getRecentMessagesForAI = async () => {
  const { data, error } = await supabase
    .from("messages")
    .select("*,profiles(username,profile_image_url,role)")
    .order("message_id", { ascending: false })
    .limit(10); // Change to number of messages you want to give to the user, but PLEASE do not let the user pick aaaaaaa NOT A GOOD IDEA anyways

  if (error) {
    console.log(error);
    return;
  }

  for (let index = 0; index < data.length; index++) {
    recentMessages.push(mapData(data[index]));
  }
};

if (!SUPABASE_KEY || !SUPABASE_URL) {
  console.error("No supabase key found!");
  // process.exit(1); // Exit with a non-zero code to indicate an error
} else {
  console.log("Supabase key found!");
  usingSupabase = true;
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  getRecentMessagesForAI();
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
  handshakeToken: string,
): Promise<{ role: string | null; uuid: string }> => {
  if (!usingSupabase) {
    return { role: "Owner", uuid: handshakeToken };
  }

  const token = handshakeToken;
  const { data: authData, error: authError } =
    await supabase.auth.getUser(token);
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
    const role = await verifyValidity(socket.handshake.auth.token);
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
        userDisplayName: (row.profiles && row.profiles.username) || "",
        userProfilePicture:
          (row.profiles && row.profiles.profile_image_url) || "",
        userRole: (row.profiles && row.profiles.role) || "",
        userUUID: row.user_uuid || "",
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
    const role = await verifyValidity(socket.handshake.auth.token);
    if (role.role == "tokenError") return;

    socket.emit("receive active users", Object.values(activeUsers));
  });

  socket.on("delete account", async (userUUID: string | null) => {
    const role = await verifyValidity(socket.handshake.auth.token);
    if (role.role == "tokenError") return;

    let responseError;

    if (userUUID !== null) {
      if (role.role == "Owner") {
        const { data, error } = await supabase.auth.admin.deleteUser(userUUID);
        responseError = error;
      }
    } else {
      const { data, error } = await supabase.auth.admin.deleteUser(role.uuid);
      responseError = error;
    }

    if (responseError) {
      console.error(responseError);
    } else {
      socket.emit("deleted account");
    }
  });

  socket.on("delete message", async (messageID: number) => {
    const role = await verifyValidity(socket.handshake.auth.token);
    if (role.role == "tokenError") return;

    if (!usingSupabase) {
      io.emit("deleted message", messageID);
      recentMessages.forEach((element) => {
        if (element.messageId == messageID) {
          delete recentMessages[recentMessages.indexOf(element)];
        }
      });

      console.log("deleted message!");
      return;
    }

    let responseError;

    if (role.role == "Owner") {
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("message_id", messageID);
      responseError = error;
    } else {
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("user_uuid", role.uuid)
        .eq("message_id", messageID);
      responseError = error;
    }

    if (responseError) {
      console.error(
        "Error while attempting to delete message: " + responseError,
      );
    } else {
      io.emit("deleted message", messageID);
      recentMessages.forEach((element) => {
        if (element.messageId == messageID) {
          delete recentMessages[recentMessages.indexOf(element)];
        }
      });
    }
  });

  socket.on("give user role", async (userUUID: string, newRole: string) => {
    const user = await verifyValidity(socket.handshake.auth.token);
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
    if (!usingSupabase) {
      io.emit("message edited", newId, newContent);
      recentMessages.forEach((element) => {
        if (element.messageId == newId) {
          recentMessages[recentMessages.indexOf(element)].isEdited = true;
          recentMessages[recentMessages.indexOf(element)].messageContent =
            newContent;
        }
      });
      console.log("edited message!");
    } else {
      const role = await verifyValidity(socket.handshake.auth.token);
      if (role.role == "tokenError") return;

      let responseError;

      if (role.role == "Owner") {
        const { error } = await supabase
          .from("messages")
          .update({
            // Edit the specific message thing
            message_content: newContent,
            is_edited: true,
          })
          .eq("message_id", newId);
        responseError = error;
      } else {
        const { error } = await supabase
          .from("messages")
          .update({
            // Edit the specific message thing
            message_content: newContent,
            is_edited: true,
          })
          .eq("user_uuid", role.uuid)
          .eq("message_id", newId);
        responseError = error;
      }

      if (responseError) {
        console.error(
          "Could not update message (just couldn't idk): " + responseError,
        );
      } else {
        io.emit("message edited", newId, newContent);
        recentMessages.forEach((element) => {
          if (element.messageId == newId) {
            recentMessages[recentMessages.indexOf(element)].isEdited = true;
            recentMessages[recentMessages.indexOf(element)].messageContent =
              newContent;
          }
        });
      }
    }
  });

  const gooberUUID = "d63332a2-cb49-4da0-9095-68e1ee8f20e9"; // feels bad putting a uuid in there like this but whatever

  const SendMessageToAiIfNeeded = async (message: ChatMessage) => {
    if (message.messageContent.toLowerCase().includes("@goob")) {
      const response = await SendMessageToAI(
        customPrompt,
        customAddedPrompt,
        recentMessages,
      );

      if (!response) return;

      let msg: ChatMessage = {
        messageContent: response,
        messageId: Date.now(), // This gets autoset by supabase but no reason not to set it also here (local testing)
        messageImageUrl: "",
        userRole: "Bot",
        messageTime: Date.now(),
        userDisplayName: "Goofy Goober",
        userProfilePicture:
          "https://raw.githubusercontent.com/GoobApp/backend/refs/heads/main/goofy-goober.png",
        userUUID: gooberUUID,
        isEdited: false,
      };

      if (usingSupabase) {
        // Only insert if actually using Supabase!
        const { data, error } = await supabase
          .from("messages")
          .insert({
            // Insert a message into the Supabase table
            user_uuid: gooberUUID,
            message_content: response,
            message_image_url: null,
          })
          .select("message_id");

        if (!data) {
          console.error("Goofy goober Supabase insert error");
          return;
        }

        msg.messageId = data[0].message_id;

        if (error) {
          console.error("Could not insert message: " + error);
        } else {
          io.emit("client receive message", msg); // Emit it to everyone else!
          recentMessages.push(msg);
          if (recentMessages.length > maxMessageContext) recentMessages.shift();
        }
      } else {
        console.log("sending message (Goofy Goober)!");
        io.emit("client receive message", msg); // Emit it to everyone else!
        recentMessages.push(msg);
        if (recentMessages.length > maxMessageContext) recentMessages.shift();
      }
    }
  };

  socket.on("message sent", async (msg: ChatMessage) => {
    // Received when the "message sent" gets called from a client

    const user = await verifyValidity(socket.handshake.auth.token);
    if (user.role == "tokenError") return;

    if (msg.messageContent.length <= 1201) {
      if (usingSupabase) {
        if (user.role != "Owner") {
          try {
            await rateLimiter.consume(socket.id); // consume 1 point per event per each user ID
            await immediateRateLimiter.consume(socket.id); // do this for immediate stuff (no spamming every 0.1 seconds)
          } catch (rejRes) {
            // No available points to consume
            // Emit error or warning message
            socket.emit("rate limited");
            return;
          }
        }

        // Only insert if actually using Supabase!
        const { data, error } = await supabase
          .from("messages")
          .insert({
            // Insert a message into the Supabase table
            user_uuid: user.uuid,
            message_content: msg.messageContent,
            message_image_url: msg.messageImageUrl,
          })
          .select("*,profiles(username,profile_image_url)")
          .single();

        if (!data) {
          return;
        }

        msg.messageId = data.message_id;
        msg.messageContent = data.message_content;
        msg.isEdited = false;
        msg.messageTime = data.created_at;
        msg.userUUID = data.user_uuid;
        msg.userDisplayName = data.profiles.username;
        msg.userProfilePicture = data.profiles.profile_image_url;

        io.emit("client receive message", msg); // Emit it to everyone else!

        if (error) {
          console.error("Could not insert message: " + error);
        }

        recentMessages.push(msg);
        if (recentMessages.length > maxMessageContext) recentMessages.shift();

        SendMessageToAiIfNeeded(msg);
      } else {
        console.log("sending message!");
        io.emit("client receive message", msg); // Emit it to everyone else!
        recentMessages.push(msg);
        if (recentMessages.length > maxMessageContext) recentMessages.shift();

        SendMessageToAiIfNeeded(msg);
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
    const role = await verifyValidity(socket.handshake.auth.token);
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

  socket.on("set system prompt", async (prompt: string) => {
    const role = await verifyValidity(socket.handshake.auth.token);
    if (role.role == "Owner") {
      console.log("Custom system prompt set!");
      customPrompt = prompt;
      socket.emit("custom prompt set");

      recentMessages = []; // clear array because otherwise it kinda just reverts back to same ways
    }
  });

  socket.on("add to system prompt", async (prompt: string) => {
    const role = await verifyValidity(socket.handshake.auth.token);
    if (role.role == "Owner") {
      console.log("Custom system prompt added to!");
      customAddedPrompt = prompt;
      socket.emit("custom added prompt set");

      recentMessages = []; // clear array because otherwise it kinda just reverts back to same ways
    }
  });

  socket.on("reset system prompt", async (prompt: string) => {
    const role = await verifyValidity(socket.handshake.auth.token);
    if (role.role == "Owner") {
      console.log("Custom system prompt reset!");
      customPrompt = null;
      customAddedPrompt = null;
      socket.emit("custom prompt reset");
      recentMessages = []; // clear array because otherwise it kinda just reverts back to same ways
    }
  });
});

server.listen(PORT, () => {
  // Start the server at the chosen port
  console.log(`listening on *:${PORT}`);
});

import multer from "multer";
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.post("/upload", upload.single("image"), async (req, res) => {
  const file = req.file;

  if (!file) {
    if (!usingSupabase) console.log("No file!");
    res.sendStatus(400); // error 400: can't understand request
    return;
  }

  let user: { role: string | null; uuid: string };
  if (usingSupabase) {
    const socketToken = req.headers.authorization;
    if (!socketToken || socketToken.trim() == "") {
      res.sendStatus(400); // error 400: can't understand request
      return;
    }

    user = await verifyValidity(socketToken.replace("Bearer ", ""));
    if (user.role == "tokenError") {
      res.sendStatus(403); // error 403: forbidden
      return;
    }
  } else {
    console.log("Image requested to be uploaded!");
  }

  if (!file.mimetype.startsWith("image/")) {
    console.error("Not an image file!");
    res.sendStatus(400); // error 400: can't understand request
    return;
  }

  // const fileBlob = new Blob([file], { type: fileType });
  // const formData = new FormData();
  // formData.append("image", file.buffer);
  // formData.append()

  const fileBlob = new Blob([new Uint8Array(file.buffer)], {
    type: file.mimetype,
  });
  const formData = new FormData();
  formData.append("image", fileBlob, file.originalname);

  if (!process.env.IMGBB_KEY) {
    console.error("No imgBB key!1!");
    res.sendStatus(500); // error 500: internal server error
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
            errorData.message || `HTTP error! status: ${response.status}`,
          );
        });
      }

      return response.json();
    })
    .then(async (img) => {
      let message = {
        userDisplayName: "Image",
        userProfilePicture: "",
        userUUID: "",
        userRole: null,
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
              : "Supabase error!",
          );

          res.sendStatus(500); // error 500: internal server error
          return;
        }

        message.messageId = data.message_id;
        message.messageContent = data.message_content;
        message.isEdited = false;
        message.messageTime = data.created_at;
        message.userUUID = data.user_uuid;
        message.userDisplayName = data.profiles.username;
        message.userProfilePicture = data.profiles.profile_image_url;
        message.userRole = data.profiles.role;

        if (error) {
          console.error("Could not insert message: " + error);
        } else {
          io.emit("client receive message", message); // Emit it to everyone else!
          message.messageContent = "IMAGE";
          recentMessages.push(message);
          if (recentMessages.length > maxMessageContext) recentMessages.shift();
        }
      } else {
        console.log("Image uploaded: " + img.data.url);
        io.emit("client receive message", message); // Emit it to everyone else!
        message.messageContent = "IMAGE";
        recentMessages.push(message);
        if (recentMessages.length > maxMessageContext) recentMessages.shift();
      }

      res.sendStatus(201);
    })
    .catch((error) => {
      console.log("Fetch error:", error.message);
      res.sendStatus(500); // error 500: internal server error
    });
});

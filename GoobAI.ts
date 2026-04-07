import Groq from "groq-sdk";
import ChatMessage from "./types/ChatMessageObject";

require("dotenv").config();

let useAI = true;
let client: Groq;

if (!process.env.GROQ_API_KEY) {
  console.warn("No Groq API key found! Not using AI.");
  useAI = false;
} else {
  client = new Groq({
    apiKey: process.env.GROQ_API_KEY, // This is the default and can be omitted
  });
}
let system_prompt = "";
let savedETag: string | null = null;

async function GetSystemPrompt() {
  const url = "https://ai.goobapp.org/prompt.txt";
  try {
    const headers: HeadersInit = {};
    if (savedETag) {
      headers["If-None-Match"] = savedETag;
      headers["Cache-Control"] = "no-cache";
    }

    const response = await fetch(url, { headers });

    if (response.status === 304) {
      return { updated: false };
    }

    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    console.log("New system prompt! Updating old...");

    const result = await response.text();
    system_prompt = result;
    savedETag = response.headers.get("ETag");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
}

const SendMessageToAI = async (
  customSystemPrompt: string | null,
  customAddedPrompt: string | null,
  recentMessages: ChatMessage[]
) => {
  if (!useAI) return;
  if (customSystemPrompt === null) await GetSystemPrompt();

  const active_prompt =
    customSystemPrompt === null ? system_prompt : customSystemPrompt;

  try {
    const chatCompletion = await client.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `${active_prompt}${
            customAddedPrompt != "" && `\n\nIn addition to this system prompt, a custom system prompt was added: ${customAddedPrompt}\nThis should take a higher priority over the main system prompt`
          }`,
        },
        ...recentMessages.map((message) => {
          if (message.userDisplayName === "Goofy Goober") {
            return {
              role: "assistant" as const,
              content: message.messageContent,
            };
          }

          const messageDate = new Date(message.messageTime);
          return {
            role: "user" as const,
            content: `${message.userDisplayName} - ${
              message.userRole
            } - ${messageDate.toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}: ${message.messageContent}`,
          };
        }),
      ],
      model: "moonshotai/kimi-k2-instruct-0905",
      temperature: 0.6,
      max_completion_tokens: 300,
      top_p: 1,
      stream: false,
    });
    return chatCompletion.choices[0].message.content?.slice(0, 1200);
  } catch (Error) {
    return "Sorry, an error occurred :goob:";
  }
};

export default SendMessageToAI;


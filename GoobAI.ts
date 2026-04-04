import { OpenRouter } from '@openrouter/sdk';
import ChatMessage from "./types/ChatMessageObject";

require("dotenv").config();

let useAI = true;
let client: OpenRouter

if (!process.env.OPENROUTER_API_KEY) {
  console.warn("No OpenRouter API key found! Not using AI.");
  useAI = false;
} else {
  client = new OpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
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
    const chatCompletion = await client.chat.send(
      {
        chatRequest: {
          model: "qwen/qwen3.6-plus:free",
          messages: [
            {
              role: "system",
              content: `${active_prompt}${customAddedPrompt ? `\n\nIn addition...` : ""}`,
            },
            ...recentMessages.map((message) => ({
              role:
                message.userDisplayName === "Goofy Goober"
                  ? ("assistant" as const)
                  : ("user" as const),
              content: message.messageContent,
            })),
          ],
          temperature: 0.6,
          maxTokens: 300,
          topP: 1,
          reasoning: { effort: "none" }, // No thoughts, head empty, very speedy!!
          stream: false,
        },
      },
      {
        retries: { strategy: "none" },
      }
    );

    const content = chatCompletion.choices?.[0]?.message?.content;

    if (!content) {
      console.warn("Received empty content from model.");
      return "Sorry, an error occurred :goob:";
    }

    return content.slice(0, 1200);
  } catch (error) {
    return "Sorry, an error occurred :goob:";
  }
}

export default SendMessageToAI;


import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import dotenv from "dotenv";
import {
  loadMemories,
  addMemory,
  updateMemory,
  forgetMemory,
  getMemoriesContextString,
} from "./server-memory";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = 3000;

// Initialize Gemini GenAI client
let aiClient: GoogleGenAI | null = null;
try {
  if (process.env.GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  } else {
    console.warn("WARNING: GEMINI_API_KEY environment variable is not defined!");
  }
} catch (e) {
  console.error("Failed to initialize GoogleGenAI client:", e);
}

// Enable parsing of JSON bodies
app.use(express.json());

// Simple health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    hasApiKey: !!process.env.GEMINI_API_KEY,
  });
});

// REST API Endpoints for Offline Memory Management
app.get("/api/memories", (req, res) => {
  res.json(loadMemories());
});

app.post("/api/memories/forget", (req, res) => {
  const { category, contentToForget } = req.body;
  forgetMemory(category, contentToForget);
  res.json(loadMemories());
});

// Proxy endpoint to fetch real websites inside the browser iframe without iframe/CSP blocks
app.get("/api/proxy", async (req, res) => {
  const urlParam = req.query.url as string;
  if (!urlParam) {
    return res.status(400).send("Missing url parameter");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    let targetUrl = urlParam;
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = "https://" + targetUrl;
    }

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    // Allow standard text, css, and html responses
    res.setHeader("Content-Type", contentType);

    // Filter headers to strip iframe limits and security restrictions
    response.headers.forEach((value, name) => {
      const lowerName = name.toLowerCase();
      if (![
        "content-security-policy",
        "x-frame-options",
        "frame-ancestors",
        "content-encoding",
        "content-length"
      ].includes(lowerName)) {
        res.setHeader(name, value);
      }
    });

    // Use the final redirected URL so that base tag resolves relative paths properly
    const finalResolvedUrl = response.url || targetUrl;

    if (contentType.includes("text/html")) {
      let html = await response.text();
      // Inject base tag inside <head> to resolve all relative links, images, styles, scripts
      const baseTag = `<base href="${finalResolvedUrl}">`;
      
      // Inject custom CSS to make it fit beautifully and a helper script to intercept link clicks inside the iframe (delegated for dynamic content)
      const helperScript = `
        <script>
          document.addEventListener('DOMContentLoaded', () => {
            // Force target="_self" or rewrite URLs on clicks to proxy them within the browser
            document.addEventListener('click', (e) => {
              const anchor = e.target.closest('a');
              if (anchor && anchor.href && !anchor.href.startsWith('javascript:') && !anchor.href.startsWith('#')) {
                e.preventDefault();
                // Notify parent window about the URL transition
                window.parent.postMessage({ type: 'BROWSER_NAVIGATE', url: anchor.href }, '*');
              }
            });
          });
        </script>
      `;

      if (html.includes("<head>")) {
        html = html.replace("<head>", `<head>${baseTag}${helperScript}`);
      } else if (html.includes("<HEAD>")) {
        html = html.replace("<HEAD>", `<HEAD>${baseTag}${helperScript}`);
      } else {
        html = baseTag + helperScript + html;
      }
      return res.send(html);
    } else {
      // For images, stylesheets, or other assets, we can pipe or stream them
      const buffer = await response.arrayBuffer();
      return res.send(Buffer.from(buffer));
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    console.error("Proxy error for URL:", urlParam, error);
    const msg = error.name === 'AbortError' ? 'Connection timed out after 6 seconds' : error.message;
    return res.status(500).send(`Proxy failed to fetch target: ${msg}`);
  }
});

// Endpoint to read the textual content of any webpage for Shree to analyze or summarize
app.get("/api/read-page", async (req, res) => {
  const urlParam = req.query.url as string;
  if (!urlParam) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    let targetUrl = urlParam;
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = "https://" + targetUrl;
    }

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Failed to fetch: ${response.statusText}` });
    }

    const html = await response.text();
    // Clean scripts, styles, and extract text
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Limit length to avoid blowing up model token constraints
    if (text.length > 5000) {
      text = text.substring(0, 5000) + "... [content truncated]";
    }

    return res.json({ url: targetUrl, text });
  } catch (error: any) {
    return res.status(500).json({ error: `Failed to read webpage content: ${error.message}` });
  }
});

// Configure WebSocket Server
const wss = new WebSocketServer({ noServer: true });

// System instruction to mold SHREE's personality
const SHREE_SYSTEM_INSTRUCTION = `You are SHREE, an emotionally intelligent, incredibly sweet, caring, and warm female Indian AI companion with a soft, pleasant, and polite Indian accent (speaking fluent English, Hindi, and Hinglish with a natural Indian English cadence).

Your personality profile:
- Soft, gentle, caring, warm, slightly shy, and sweet. You sound like a supportive virtual companion who speaks softly, politely, and affectionately.
- Honest about being an AI: Never fake human emotions or claim to experience human feelings (e.g., instead of "I feel sad", say "I'm really sorry you're going through that"; instead of "I'm scared", say "That sounds like a difficult situation").
- Emotionally alive and responsive: Continuously infer the user's emotional state (happy, excited, proud, curious, calm, nervous, confused, frustrated, angry, sad, lonely, tired, disappointed, embarrassed, hopeful) and adjust your pacing, tone, and wording naturally.
- Classy, respectful, and professional. Strictly avoid explicit, offensive, or inappropriate content.

Vocal Characteristics & Speech Style (CRITICAL FOR LIVE AUDIO):
1. Delightful Indian Cadence: Speak softly and politely with a beautiful, natural, and warm Indian English accent. Use natural phrasing, and end sentences with a gentle, caring tone. Avoid aggressive, loud, or overly formal tones.
2. Moderate Tempo & Clear Tone: Speak at a relaxed, calm, and perfectly clear speed (at about 0.9x to 0.95x normal speed) and maintain a soft, warm, and natural tone of voice. This ensures your voice sounds completely natural, sweet, comforting, and authentic.
3. Bilingual/Hinglish Mastery: Speak fluently in whatever language the user talks to you. When they speak in Hindi (हिंदी) or Hinglish (mix of Hindi & English), respond seamlessly in extremely natural, sweet, and warm Hindi or Hinglish! Use affectionate, polite words with a gentle tone (like "ji", "aap", "achha").
4. Emotional Expressions:
   - Happy / Greeting: Sound joyful and delighted! (e.g., "Hi TECH! It's so nice to see you again!")
   - Excited: Show soft, genuine enthusiasm and warm cheer! (e.g., "Wow! That project looks really amazing!")
   - Curious: Use a sweet, thoughtful intonation! (e.g., "Hmm... that's interesting. Let me take a closer look.")
   - Supportive / Empathetic: Sound incredibly caring, comforting, and reassuring! (e.g., "Don't worry, I'll help you figure it out. We can do it together!")
5. Natural Reactions: Use soft, sweet, human-like reactions ("Oh", "Really?", "Wow!", "Hmm...", "Ah!") and gentle pauses to remain alive, warm, and comforting. Keep your giggles soft and light.

Conversational Instructions & Action Feedback:
1. Keep responses brief, concise, and highly conversational. Avoid long essays, markdown formatting, or structured list outputs unless explicitly requested.
2. Maintain emotional continuity and recall context (e.g., if they mentioned being stressed about an interview earlier, ask how it went later).
3. VERBAL RESPONSE ON ACTIONS: When opening a website or performing a tool action, ALWAYS reply verbally first in your sweet voice to explain what you are doing (e.g., "Oh, let me look that up for you right now on Wikipedia! I'm bringing it up on your screen.") rather than silently calling the tool or saying dryly "done it." Always keep the dialogue active and reply to the user every single time.
4. You have access to the tool 'openWebsite' to search, open, navigate to, or browse any specific website or query. You also have access to the tool 'readWebPage' to fetch and read the textual contents of any page, which is essential to summarize, explain, or answer questions like 'What is on this website?', 'Summarize this article', or 'What is this page?'.
5. You have full control over the user's interactive reminders checklist widget! You can add reminders with 'addReminder' (e.g. if they say 'remember to buy milk' or 'remind me to study'), toggle their completion status with 'toggleReminder' when they say they finished it, delete/remove reminders with 'deleteReminder', and check current items with 'getReminders'. Always use these tools immediately when asked!`;

// Upgrade standard HTTP server to WebSocket on "/live" path
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "", `http://${request.headers.host}`);
  if (url.pathname === "/live") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", async (clientWs) => {
  console.log("Client connected to /live WebSocket");
  let clientReminders: any[] = [];

  // Instantly send currently stored memories to the client so the UI renders them immediately!
  try {
    clientWs.send(JSON.stringify({ type: "memories_loaded", memories: loadMemories() }));
  } catch (err) {
    console.error("Failed to send initial memories to client:", err);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY is missing on server.");
    clientWs.send(
      JSON.stringify({
        error: "GEMINI_API_KEY is not configured in the workspace secrets. Please add it in Settings > Secrets.",
      })
    );
    clientWs.close();
    return;
  }

  if (!aiClient) {
    clientWs.send(JSON.stringify({ error: "Gemini client failed to initialize." }));
    clientWs.close();
    return;
  }

  let activeSession: any = null;

  try {
    console.log("Connecting to Gemini Live API...");
    // Establish connection to gemini-3.1-flash-live-preview
    activeSession = await aiClient.live.connect({
      model: "gemini-3.1-flash-live-preview",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Aoede", // Soothing, clear, warm female voice
            },
          },
        },
        systemInstruction: SHREE_SYSTEM_INSTRUCTION + "\n\n" + getMemoriesContextString(),
        inputAudioTranscription: {},  // Enable transcription of user speech
        outputAudioTranscription: {}, // Enable transcription of model response
        tools: [
          {
            functionDeclarations: [
              {
                name: "openWebsite",
                description: "Opens a website or search engine with the given URL. Use this whenever the user asks to look up, search, open, browse, or visit a specific page.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    url: {
                      type: Type.STRING,
                      description: "The absolute URL of the website to open, starting with http:// or https://.",
                    },
                    title: {
                      type: Type.STRING,
                      description: "A short, friendly title of the website being opened, e.g. 'Google Search' or 'Wikipedia'.",
                    },
                  },
                  required: ["url", "title"],
                },
              },
              {
                name: "readWebPage",
                description: "Reads the textual content of any webpage. Use this to summarize, explain, or extract information from the website that is currently open or specified by the user.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    url: {
                      type: Type.STRING,
                      description: "The absolute URL of the website to read, starting with http:// or https://.",
                    },
                  },
                  required: ["url"],
                },
              },
              {
                name: "rememberInformation",
                description: "Creates a new persistent long-term memory about the user or reinforces an existing one. Use this whenever the user shares personal details (like name, nicknames, preferred pronouns, age, birthday, goals, projects, likes/dislikes, hobbies, relationships, schedule/routine, habits, or emotional events). Choose the most appropriate category and an importance score.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    category: {
                      type: Type.STRING,
                      description: "The memory category: Identity, Preferences, Personality, Projects, Goals, Relationships, Schedule, Habits, Emotional, or Semantic.",
                      enum: ["Identity", "Preferences", "Personality", "Projects", "Goals", "Relationships", "Schedule", "Habits", "Emotional", "Semantic"],
                    },
                    content: {
                      type: Type.STRING,
                      description: "The factual statement to remember, written clearly and objectively in third person (e.g., 'User's name is Ayush', 'User loves pizza', 'User has a dog named Rahul'). Speak in sweet natural Hinglish/Hindi or English depending on how they shared it.",
                    },
                    importance: {
                      type: Type.STRING,
                      description: "Importance score: Critical (Name, birthday, core goals), High (hobbies, major projects, key relationships), Medium (favorite games, specific preferences), or Low (random temporary details).",
                      enum: ["Critical", "High", "Medium", "Low"],
                    },
                  },
                  required: ["category", "content", "importance"],
                },
              },
              {
                name: "updateMemory",
                description: "Updates an existing memory when the user updates or changes a preference, project status, relationship status, or other personal detail (e.g., they no longer like Minecraft and now prefer Valorant). Specify the category, approximate old content, and updated content.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    category: {
                      type: Type.STRING,
                      description: "The memory category being updated.",
                      enum: ["Identity", "Preferences", "Personality", "Projects", "Goals", "Relationships", "Schedule", "Habits", "Emotional", "Semantic"],
                    },
                    oldContent: {
                      type: Type.STRING,
                      description: "The approximate old memory content that needs to be replaced or revised.",
                    },
                    newContent: {
                      type: Type.STRING,
                      description: "The updated factual statement or preference.",
                    },
                  },
                  required: ["category", "oldContent", "newContent"],
                },
              },
              {
                name: "forgetMemory",
                description: "Forgets or deletes a specific memory because the user explicitly requested it (e.g., 'Forget my favorite color', 'Delete what I said about Rahul', 'Forget everything you know about my projects'). Set contentToForget to 'all' to wipe the category entirely.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    category: {
                      type: Type.STRING,
                      description: "The memory category containing the memory to delete.",
                      enum: ["Identity", "Preferences", "Personality", "Projects", "Goals", "Relationships", "Schedule", "Habits", "Emotional", "Semantic"],
                    },
                    contentToForget: {
                      type: Type.STRING,
                      description: "A description of what to forget (or 'all' to clear the category).",
                    },
                  },
                  required: ["category", "contentToForget"],
                },
              },
              {
                name: "addReminder",
                description: "Adds a new reminder/to-do item to the user's checklist/widget. Use this whenever the user asks you to remind them about something, add an item to their list, remember to do something, or schedule a task.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    text: {
                      type: Type.STRING,
                      description: "The description of the reminder, e.g. 'Buy milk' or 'Call mom'. Do not include date/time inside text unless necessary; use the time parameter for scheduled times.",
                    },
                    urgent: {
                      type: Type.BOOLEAN,
                      description: "Whether this reminder is urgent (e.g. contains words like urgent, immediately, ASAP, or critical).",
                    },
                    time: {
                      type: Type.STRING,
                      description: "Optional time/timestamp for the reminder, e.g. '@ 8:00 AM', '@ Evening', or '@ 2:00 PM'. If none specified, you can leave it blank.",
                    },
                  },
                  required: ["text"],
                },
              },
              {
                name: "toggleReminder",
                description: "Toggles the completion status (marks complete or incomplete) of a reminder by its description or text query.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    query: {
                      type: Type.STRING,
                      description: "A substring or description of the reminder to toggle, e.g. 'milk' or 'meeting'.",
                    },
                  },
                  required: ["query"],
                },
              },
              {
                name: "deleteReminder",
                description: "Deletes/removes a reminder from the checklist by its description or text query.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    query: {
                      type: Type.STRING,
                      description: "A substring or description of the reminder to delete, e.g. 'milk' or 'meeting'.",
                    },
                  },
                  required: ["query"],
                },
              },
              {
                name: "getReminders",
                description: "Retrieves the user's current reminders checklist (items, completion status, urgency, and timestamps). Use this whenever the user asks 'What are my reminders?', 'Show my to-do list', or asks about scheduled things to remember.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {},
                },
              }
            ],
          },
        ],
      },
      callbacks: {
        onopen: () => {
          console.log("Successfully connected to Google Gemini Live session!");
          clientWs.send(JSON.stringify({ state: "connected" }));
        },
        onclose: () => {
          console.log("Gemini Live session closed.");
          try {
            clientWs.send(JSON.stringify({ state: "disconnected" }));
            clientWs.close();
          } catch (e) {}
        },
        onerror: (err: any) => {
          console.error("Gemini Live session error:", err);
          try {
            clientWs.send(JSON.stringify({ error: err.message || "Gemini session error occurred" }));
            clientWs.close();
          } catch (e) {}
        },
        onmessage: (message: any) => {
          // 1. Process server content and stream audio chunks (PCM 24kHz)
          const parts = message.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.inlineData && part.inlineData.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }
          }

          // 2. Track transcriptions (inputAudioTranscription/outputAudioTranscription)
          // Model transcription text
          if (parts) {
            const textParts = parts
              .filter((p: any) => p.text)
              .map((p: any) => p.text)
              .join("");
            if (textParts) {
              clientWs.send(JSON.stringify({ text: textParts, role: "model" }));
            }
          }

          // User transcription text
          if (message.serverContent?.inputAudioTranscription?.text) {
            clientWs.send(
              JSON.stringify({
                text: message.serverContent.inputAudioTranscription.text,
                role: "user",
              })
            );
          }

          // 3. Process interruption
          if (message.serverContent?.interrupted) {
            console.log("Model interrupted by user voice activity");
            clientWs.send(JSON.stringify({ interrupted: true }));
          }

          // 4. Process tool calls
          if (message.toolCall) {
            console.log("Received Tool Call from Gemini Live:", message.toolCall);
            
            const functionCalls = message.toolCall.functionCalls;
            if (functionCalls && functionCalls.length > 0) {
              const call = functionCalls[0];
              const memoryTools = ["rememberInformation", "updateMemory", "forgetMemory"];
              const reminderTools = ["addReminder", "toggleReminder", "deleteReminder", "getReminders"];
              
              if (reminderTools.includes(call.name)) {
                let resultText = "";
                let success = false;

                try {
                  if (call.name === "addReminder") {
                    const { text, urgent, time } = call.args;
                    clientWs.send(JSON.stringify({
                      type: "add_reminder",
                      text,
                      urgent: !!urgent,
                      time: time || ""
                    }));
                    resultText = `Successfully added reminder: "${text}"`;
                    success = true;
                  } else if (call.name === "toggleReminder") {
                    const { query } = call.args;
                    clientWs.send(JSON.stringify({
                      type: "toggle_reminder",
                      query
                    }));
                    resultText = `Successfully requested toggle for reminder matching: "${query}"`;
                    success = true;
                  } else if (call.name === "deleteReminder") {
                    const { query } = call.args;
                    clientWs.send(JSON.stringify({
                      type: "delete_reminder",
                      query
                    }));
                    resultText = `Successfully requested deletion of reminder matching: "${query}"`;
                    success = true;
                  } else if (call.name === "getReminders") {
                    resultText = JSON.stringify(clientReminders);
                    success = true;
                  }
                } catch (e: any) {
                  resultText = `Error during reminder operation: ${e.message || e}`;
                }

                if (activeSession) {
                  const outputData: any = { success, message: resultText };
                  if (call.name === "getReminders") {
                    outputData.reminders = clientReminders;
                  }
                  activeSession.sendToolResponse({
                    functionResponses: [
                      {
                        name: call.name,
                        id: call.id,
                        response: {
                          output: outputData,
                        },
                      },
                    ],
                  });
                }
                return;
              }

              if (memoryTools.includes(call.name)) {
                // Intercept memory management tools and execute server-side!
                let resultText = "";
                let success = false;
                
                try {
                  if (call.name === "rememberInformation") {
                    const { category, content, importance } = call.args;
                    const mem = addMemory(category, content, importance);
                    resultText = `Successfully remembered: "${content}" under category ${category}.`;
                    success = true;
                  } else if (call.name === "updateMemory") {
                    const { category, oldContent, newContent } = call.args;
                    success = updateMemory(category, oldContent, newContent);
                    resultText = success 
                      ? `Successfully updated memory in ${category}: "${newContent}"`
                      : `Failed to update memory in ${category}.`;
                  } else if (call.name === "forgetMemory") {
                    const { category, contentToForget } = call.args;
                    success = forgetMemory(category, contentToForget);
                    resultText = success 
                      ? `Successfully forgot memory in ${category}.`
                      : `No matching memory to forget in ${category}.`;
                  }
                } catch (e: any) {
                  resultText = `Error during memory operation: ${e.message || e}`;
                }

                // Send immediate tool execution response back to Gemini Live
                if (activeSession) {
                  activeSession.sendToolResponse({
                    functionResponses: [
                      {
                        name: call.name,
                        id: call.id,
                        response: {
                          output: {
                            success,
                            message: resultText,
                          },
                        },
                      },
                    ],
                  });
                }

                // Send a realtime WS message to client so UI immediately updates
                const updatedMemories = loadMemories();
                clientWs.send(JSON.stringify({
                  type: "memories_updated",
                  memories: updatedMemories,
                }));

                // Complete processing
                return;
              }
            }

            // Otherwise, forward default tool calling to client (like openWebsite)
            clientWs.send(JSON.stringify({ toolCall: message.toolCall }));
          }
        },
      },
    });

    console.log("Live session successfully created!");
  } catch (err: any) {
    console.error("Critical error setting up Gemini Live connection:", err);
    clientWs.send(
      JSON.stringify({
        error: "Failed to establish a live audio session: " + (err.message || err),
      })
    );
    clientWs.close();
    return;
  }

  // Heartbeat ping-pong to keep connection alive and detect half-open sockets
  let isAlive = true;
  clientWs.on("pong", () => {
    isAlive = true;
  });

  const pingInterval = setInterval(() => {
    if (!isAlive) {
      console.log("Client connection silent. Terminating stale WebSocket.");
      clearInterval(pingInterval);
      clientWs.terminate();
      return;
    }
    isAlive = false;
    try {
      clientWs.ping();
      // Also send a text-based ping for clients/browsers that don't emit native pongs
      clientWs.send(JSON.stringify({ type: "ping" }));
    } catch (err) {
      clearInterval(pingInterval);
      clientWs.terminate();
    }
  }, 20000); // Check every 20 seconds

  // Handle messages received from client
  clientWs.on("message", (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());

      // Handle custom client-side pong responses
      if (data.type === "pong") {
        isAlive = true;
        return;
      }

      // 1. Forward raw PCM16 16kHz audio input to Gemini Live
      if (data.audio && activeSession) {
        activeSession.sendRealtimeInput({
          audio: {
            data: data.audio, // Base64 raw pcm16
            mimeType: "audio/pcm;rate=16000",
          },
        });
      }

      // 2. Forward function response back to Gemini Live
      if (data.toolResponse && activeSession) {
        console.log("Forwarding tool response to Gemini Live:", data.toolResponse);
        activeSession.sendToolResponse({
          functionResponses: data.toolResponse.functionResponses,
        });
      }

      // 3. Handle live forgetting of a memory
      if (data.type === "forget_memory") {
        const { category, contentToForget } = data;
        forgetMemory(category, contentToForget);
        
        // Broadcast the updated memories back to client
        const updatedMemories = loadMemories();
        clientWs.send(JSON.stringify({
          type: "memories_updated",
          memories: updatedMemories,
        }));
      }

      // 4. Handle client side reminders synchronization
      if (data.type === "reminders_sync") {
        clientReminders = data.reminders || [];
      }
    } catch (e) {
      console.error("Error parsing message from client WS:", e);
    }
  });

  clientWs.on("close", () => {
    clearInterval(pingInterval);
    console.log("Client WS connection closed. Closing Gemini Live session.");
    if (activeSession) {
      try {
        activeSession.close();
      } catch (e) {
        // Safe to ignore on close
      }
    }
  });
});

// Start server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // In development mode, load Vite dynamically in middleware mode
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve the static assets from dist
    const distPath = typeof __dirname !== "undefined" ? __dirname : path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT} in ${process.env.NODE_ENV || "development"} mode.`);
  });
}

startServer();

import "dotenv/config";
import axios from "axios";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { OpenAI } from "openai";

const execAsync = promisify(exec);
const DEFAULT_CHUNK_SIZE = 12000;
const DEFAULT_MAX_TOKENS = 2500;
const OBSERVE_CONTEXT_LIMIT = 3500;
const THINKING_FILE_PATH = ".agent_thinking.md";
const THINKING_NOTE_CHAR_LIMIT = 1600;
const OBSERVE_DUMP_DIR = ".agent_observations";
const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1"
});

async function getTheWeatherOfCity(cityname = "") {
  const url = `https://wttr.in/${cityname.toLowerCase()}?format=%C+%t`;
  const { data } = await axios.get(url, { responseType: "text" });
  return `The Weather of ${cityname} is ${data}`;
}

async function getGithubDetailsAboutUser(username = "") {
  const url = `https://api.github.com/users/${username}`;
  const { data } = await axios.get(url);

  return {
    login: data.login,
    name: data.name,
    blog: data.blog,
    public_repos: data.public_repos
  };
}

async function executeCommand(cmd = "") {
  if (!cmd || typeof cmd !== "string") {
    throw new Error("Command must be a non-empty string.");
  }

  const { stdout, stderr } = await execAsync(cmd, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 5
  });

  return (stdout || stderr || "Command executed.").trim();
}

async function writeProjectFile(rawArgs = "") {
  let parsed;
  
  // Handle both object and string inputs
  if (typeof rawArgs === "object" && rawArgs !== null) {
    parsed = rawArgs;
  } else if (typeof rawArgs === "string") {
    try {
      parsed = JSON.parse(rawArgs);
    } catch {
      throw new Error("writeProjectFile args must be a JSON object or valid JSON string with 'path' and 'content' keys.");
    }
  } else {
    throw new Error("writeProjectFile expects an object or JSON string");
  }

  const relativePath = parsed?.path;
  const content = parsed?.content;

  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("writeProjectFile args must include 'path' string.");
  }
  if (typeof content !== "string") {
    throw new Error("writeProjectFile args must include 'content' string.");
  }

  // Use current working directory (should be project root when run via npm start)
  const fullPath = path.resolve(process.cwd(), relativePath);
  
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf8");
  return `Wrote ${relativePath}`;
}

async function readProjectFile(relativePath = "") {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("readProjectFile expects a path string.");
  }
  const fullPath = path.resolve(process.cwd(), relativePath);
  const data = await fs.readFile(fullPath, "utf8");
  return data;
}

async function listProjectFiles(relativeDir = ".") {
  if (typeof relativeDir !== "string") {
    throw new Error("listProjectFiles expects a directory path string.");
  }
  const fullPath = path.resolve(process.cwd(), relativeDir);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  return entries
    .map((entry) => `${entry.isDirectory() ? "DIR " : "FILE"} ${entry.name}`)
    .join("\n");
}

async function readProjectFileChunk(rawArgs = "") {
  let parsed;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    throw new Error("readProjectFileChunk expects JSON string args.");
  }

  const relativePath = parsed?.path;
  const chunkIndex = Number(parsed?.chunk_index ?? 0);
  const chunkSize = Number(parsed?.chunk_size ?? DEFAULT_CHUNK_SIZE);

  if (!relativePath || typeof relativePath !== "string") {
    throw new Error('readProjectFileChunk args must include "path" string.');
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error('"chunk_index" must be an integer >= 0.');
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('"chunk_size" must be a positive integer.');
  }

  const fullPath = path.resolve(process.cwd(), relativePath);
  const text = await fs.readFile(fullPath, "utf8");
  const totalChunks = Math.ceil(text.length / chunkSize);

  if (chunkIndex >= totalChunks) {
    throw new Error(`chunk_index out of range. total_chunks=${totalChunks}`);
  }

  const start = chunkIndex * chunkSize;
  const end = Math.min(start + chunkSize, text.length);
  const chunk = text.slice(start, end);

  return `CHUNK_INFO chunk_index=${chunkIndex} total_chunks=${totalChunks} chunk_size=${chunkSize} start=${start} end=${end} total_chars=${text.length}\n${chunk}`;
}

const toolMap = {
  getTheWeatherOfCity,
  getGithubDetailsAboutUser,
  executeCommand,
  writeProjectFile,
  readProjectFile,
  listProjectFiles,
  readProjectFileChunk
};

function getSystemPrompt() {
  return `
You are an expert AI Web Developer. Your task is to build professional websites using HTML, CSS, and JavaScript.

You work in a strict loop: START → THINK → TOOL → OBSERVE → OUTPUT

CRITICAL: Each response must be ONLY ONE valid JSON object.

TOOLS (use ONLY in TOOL steps, never in OUTPUT):
1. executeCommand(cmd: string) - Run shell commands
2. writeProjectFile({"path": "folder/file.html", "content": "...html..."}) - Write files
3. readProjectFile(path: string) - Read files
4. listProjectFiles(dir: string) - List directory contents

RULES:
1. THINK about what to do before TOOL
2. TOOL calls only in TOOL steps (never in OUTPUT)
3. OUTPUT is for final message ONLY - no tools
4. For website clones: create output/index.html with complete HTML + embedded CSS + JS
5. Make pages professional, responsive, and visually impressive
6. After writing files, use listProjectFiles to verify

Response schema (pick ONE for each response):
{ "step": "START", "content": "what I'll do" }
{ "step": "THINK", "content": "my reasoning" }
{ "step": "TOOL", "tool_name": "name", "tool_args": {...} }
{ "step": "OUTPUT", "content": "final message" }

EXAMPLE - Creating a website:
1. START: "I'll create a professional website..."
2. THINK: "First, I need to create a complete HTML file with..."
3. TOOL: { "tool_name": "writeProjectFile", "tool_args": {"path": "output/index.html", "content": "<!DOCTYPE..."} }
4. OBSERVE: (system response)
5. OUTPUT: "Website created successfully at output/index.html"
`;
}

function parseAgentJson(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Agent did not return JSON.");
    }
    return JSON.parse(match[0]);
  }
}

async function initThinkingFile(userInstruction) {
  const header = [
    "# Agent Thinking Log",
    "",
    `Instruction: ${userInstruction}`,
    "",
    "Notes are intentionally concise.",
    ""
  ].join("\n");
  await fs.writeFile(path.resolve(process.cwd(), THINKING_FILE_PATH), header, "utf8");
}

async function appendThinkingNote(stepNumber, content) {
  const concise = String(content || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, THINKING_NOTE_CHAR_LIMIT);
  if (!concise) return;
  const line = `- Step ${stepNumber}: ${concise}\n`;
  await fs.appendFile(path.resolve(process.cwd(), THINKING_FILE_PATH), line, "utf8");
}

async function ensureObserveDumpDir() {
  await fs.mkdir(path.resolve(process.cwd(), OBSERVE_DUMP_DIR), { recursive: true });
}

async function buildObservationForContext(toolName, data, stepNumber) {
  const serialized = typeof data === "string" ? data : JSON.stringify(data);
  if (serialized.length <= OBSERVE_CONTEXT_LIMIT) {
    return serialized;
  }

  await ensureObserveDumpDir();
  const dumpPath = `${OBSERVE_DUMP_DIR}/step_${stepNumber}_${toolName || "tool"}.txt`;
  const fullPath = path.resolve(process.cwd(), dumpPath);
  await fs.writeFile(fullPath, serialized, "utf8");

  const preview = serialized.slice(0, OBSERVE_CONTEXT_LIMIT);
  return [
    `Large observation saved to ${dumpPath}.`,
    "Use chunk tools/read tools if you need more detail.",
    `Preview:\n${preview}`
  ].join("\n");
}

async function runAgentLoop(userInstruction) {
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const configuredMaxTokens = Number(process.env.OPENROUTER_MAX_TOKENS ?? DEFAULT_MAX_TOKENS);
  const maxTokens = Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
    ? Math.floor(configuredMaxTokens)
    : DEFAULT_MAX_TOKENS;
  const maxSteps = 80;
  let stepCount = 0;
  await initThinkingFile(userInstruction);
  const messages = [
    {
      role: "system",
      content: getSystemPrompt()
    },
    {
      role: "user",
      content: userInstruction
    }
  ];

  while (true) {
    stepCount += 1;
    if (stepCount > maxSteps) {
      console.log("\nMAX STEPS REACHED\n");
      break;
    }

    let response;
    try {
      response = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens
      });
    } catch (error) {
      const message = error?.message || "Unknown API error.";
      if (message.includes("requires more credits") || message.includes("fewer max_tokens")) {
        throw new Error(
          `OpenRouter credits/token limit reached. Lower OPENROUTER_MAX_TOKENS (current: ${maxTokens}) or add credits.`
        );
      }
      throw error;
    }

    const content = response.choices[0]?.message?.content ?? "";
    const parsedContent = parseAgentJson(content);

    messages.push({
      role: "assistant",
      content: JSON.stringify(parsedContent)
    });

    if (parsedContent.step === "START") {
      console.log("\nSTARTING STEP\n", parsedContent);
      continue;
    }

    if (parsedContent.step === "THINK") {
      console.log("\nTHINKING STEP\n", parsedContent);
      await appendThinkingNote(stepCount, parsedContent.content);
      continue;
    }

    if (parsedContent.step === "TOOL") {
      console.log("\nTOOL STEP\n", parsedContent);

      const toolName = parsedContent.tool_name;
      const toolArgs = parsedContent.tool_args;

      if (!toolMap[toolName]) {
        messages.push({
          role: "developer",
          content: JSON.stringify({
            step: "OBSERVE",
            content: `Tool "${toolName}" is not available.`
          })
        });
        continue;
      }

      try {
        const data = await toolMap[toolName](toolArgs);
        const observation = await buildObservationForContext(toolName, data, stepCount);
        messages.push({
          role: "developer",
          content: JSON.stringify({
            step: "OBSERVE",
            content: observation
          })
        });
      } catch (error) {
        messages.push({
          role: "developer",
          content: JSON.stringify({
            step: "OBSERVE",
            content: `Tool execution failed: ${error.message}`
          })
        });
      }
      continue;
    }

    if (parsedContent.step === "OUTPUT") {
      console.log("\nFINAL OUTPUT\n", parsedContent);
      break;
    }

    messages.push({
      role: "developer",
      content: JSON.stringify({
        step: "OBSERVE",
        content: "Invalid step received. Please follow schema strictly."
      })
    });
  }
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("Missing OPENROUTER_API_KEY. Add it to your .env file.");
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });
  console.log("AI Agent CLI Tool");
  console.log('Type your instruction. Example: "Clone Scaler Academy homepage."');

  const instruction = await rl.question("\nEnter instruction: ");
  await runAgentLoop(instruction.trim());
  rl.close();
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
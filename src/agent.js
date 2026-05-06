/**
 * agent.js — Core agent loop using OpenRouter API.
 *
 * OpenRouter is OpenAI-compatible, so we use axios to call:
 *   POST https://openrouter.ai/api/v1/chat/completions
 *
 * Message format (standard OpenAI):
 *   { role: "system" | "user" | "assistant", content: "..." }
 *
 * No extra SDK needed — axios is already installed.
 *
 * Loop:
 *   START → THINK → TOOL → OBSERVE → THINK → ... → OUTPUT
 *
 * Gemini batching fix is preserved: parseAllSteps() extracts every
 * JSON object from a response in case the model returns multiple steps.
 */

import "dotenv/config";
import readline from "readline";
import axios from "axios";
import { tool_map } from "./tools.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import {
  printBanner,
  printStep,
  printError,
  printInfo,
  printUserPrompt,
} from "./display.js";

// ── OpenRouter config ─────────────────────────────────────────────────────────

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";

// Highly stable free model on OpenRouter
const MODEL = "google/gemini-flash-1.5-8b:free";

/**
 * Calls the OpenRouter chat completions endpoint.
 * @param {Array} messages  — OpenAI-format message history
 * @returns {Promise<string>} raw text content from the model
 */
async function callLLM(messages) {
  let response;
  try {
    response = await axios.post(
      OPENROUTER_BASE,
      { 
        model: MODEL, 
        messages, 
        temperature: 0.1
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/cli-agent",
          "X-Title": "Scaler AI Agent",
        },
        timeout: 60000,
        validateStatus: () => true,
      }
    );
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }

  // Surface HTTP errors clearly (e.g. invalid model, bad key, quota exceeded)
  if (response.status !== 200) {
    const errMsg =
      response.data?.error?.message ||
      JSON.stringify(response.data) ||
      `HTTP ${response.status}`;
    throw new Error(`[${response.status}] ${errMsg}`);
  }

  const choice = response.data?.choices?.[0]?.message;

  // Primary: standard content field
  if (choice?.content) return choice.content;

  // Fallback: reasoning models (e.g. gpt-oss, o-series) put output in reasoning field.
  // openrouter/free routes randomly and may hit these models.
  const reasoning =
    choice?.reasoning ||
    choice?.reasoning_details?.[0]?.text;

  if (reasoning) {
    // Reasoning text is raw thought — wrap it so the agent can nudge the model
    // to re-emit proper JSON on the next turn.
    return reasoning;
  }

  throw new Error("Empty response — model returned no content or reasoning: " + JSON.stringify(response.data));
}

// ── Readline interface ────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts ALL JSON step objects from a raw model response.
 */
function parseAllSteps(raw) {
  let cleaned = raw.trim();

  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
  }

  // Case 1: single valid JSON
  try {
    return [JSON.parse(cleaned)];
  } catch { /* fall through */ }

  // Case 2: brace-depth extraction — every top-level {...} block
  const results = [];
  let depth = 0, start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try { results.push(JSON.parse(cleaned.slice(start, i + 1))); } catch { /* skip */ }
        start = -1;
      }
    }
  }
  if (results.length > 0) return results;

  throw new Error("No valid JSON step found in model response");
}

/**
 * Dispatches a tool call and returns the observation string.
 */
async function dispatchTool(parsed) {
  const { tool_name, tool_args } = parsed;

  if (!tool_map[tool_name]) {
    return `Tool not found: "${tool_name}". Available: ${Object.keys(tool_map).join(", ")}`;
  }

  try {
    const result = await tool_map[tool_name](tool_args);
    return typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
  } catch (err) {
    return `Tool error in ${tool_name}: ${err.message}`;
  }
}

// ── Agent loop ────────────────────────────────────────────────────────────────

async function runAgentLoop(userMessage, history) {
  history.push({ role: "user", content: userMessage });

  const MAX_ITERATIONS = 20;
  let iterations = 0;
  let done = false;

  while (!done && iterations < MAX_ITERATIONS) {
    iterations++;

    // ── Call OpenRouter ────────────────────────────────────────────────────
    let raw;
    try {
      raw = await callLLM(history);
    } catch (err) {
      printError(`OpenRouter API error: ${err.message}`);
      break;
    }

    // ── Parse all steps from this response ────────────────────────────────
    let steps;
    try {
      steps = parseAllSteps(raw);
    } catch {
      printError("No JSON found in response. Nudging model…");
      history.push({ role: "assistant", content: raw });
      history.push({
        role: "user",
        content: JSON.stringify({
          step: "OBSERVE",
          content: "Your last response had no valid JSON. Reply with ONLY a single JSON object matching the schema.",
        }),
      });
      continue;
    }

    // ── Process each step in the batch ────────────────────────────────────
    for (const parsed of steps) {
      printStep(parsed);

      history.push({ role: "assistant", content: JSON.stringify(parsed) });

      if (parsed.step === "OUTPUT") {
        done = true;
        break;
      }

      if (parsed.step === "TOOL") {
        const observation = await dispatchTool(parsed);
        const observeMsg = { step: "OBSERVE", content: observation };
        printStep(observeMsg);
        history.push({ role: "user", content: JSON.stringify(observeMsg) });
      }
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    printError("Agent reached the maximum iteration limit.");
  }
}

// ── Main CLI loop ─────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      "\n  ❌  OPENROUTER_API_KEY is not set.\n" +
      "     Add it to your .env file:\n" +
      "     OPENROUTER_API_KEY=sk-or-v1-...\n"
    );
    process.exit(1);
  }

  printBanner();

  // History starts with the system prompt — stays for the whole session
  let history = [{ role: "system", content: SYSTEM_PROMPT }];

  printUserPrompt();

  for await (const line of rl) {
    const userMessage = line.trim();

    if (!userMessage) { printUserPrompt(); continue; }

    if (userMessage.toLowerCase() === "exit" || userMessage.toLowerCase() === "quit") {
      console.log("\n  👋  Goodbye!\n");
      process.exit(0);
    }

    if (userMessage.toLowerCase() === "clear") {
      history = [{ role: "system", content: SYSTEM_PROMPT }];
      printInfo("Conversation cleared. Starting fresh.\n");
      printUserPrompt();
      continue;
    }

    printInfo(`Agent is thinking… (model: ${MODEL})`);
    await runAgentLoop(userMessage, history);
    printUserPrompt();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
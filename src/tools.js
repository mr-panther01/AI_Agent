/**
 * tools.js — All tool implementations available to the AI agent.
 *
 * Each tool is a standalone async function. The tool_map at the bottom
 * binds tool names (as the LLM knows them) to their implementations.
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import axios from "axios";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────
// 1. getTheWeatherOfCity
// ─────────────────────────────────────────────

/**
 * Fetches live weather for a given city using the wttr.in API.
 * @param {string} cityname
 * @returns {Promise<string>}
 */
export async function getTheWeatherOfCity(cityname = "") {
  const url = `https://wttr.in/${encodeURIComponent(cityname.trim())}?format=%C+%t`;
  const { data } = await axios.get(url, { responseType: "text" });
  return `The Weather of ${cityname} is ${data.trim()}`;
}

// ─────────────────────────────────────────────
// 2. getGithubDetailsAboutUser
// ─────────────────────────────────────────────

/**
 * Fetches public GitHub profile data for a given username.
 * @param {string} username
 * @returns {Promise<object>}
 */
export async function getGithubDetailsAboutUser(username = "") {
  const url = `https://api.github.com/users/${username.trim()}`;
  const { data } = await axios.get(url);
  return {
    login: data.login,
    name: data.name,
    blog: data.blog,
    public_repos: data.public_repos,
    followers: data.followers,
    bio: data.bio,
  };
}

// ─────────────────────────────────────────────
// 3. executeCommand
// ─────────────────────────────────────────────

/**
 * Executes a shell command on the user's machine.
 * Returns stdout on success, or the error message on failure.
 * @param {string} cmd - Shell command string
 * @returns {Promise<string>}
 */
export async function executeCommand(cmd = "") {
  try {
    const { stdout, stderr } = await execAsync(cmd, { shell: true });
    return stdout.trim() || stderr.trim() || `Command executed: ${cmd}`;
  } catch (err) {
    return `Error executing command: ${err.message}`;
  }
}

// ─────────────────────────────────────────────
// 4. writeFile
// ─────────────────────────────────────────────

/**
 * Writes content to a file at the given path (creates dirs if needed).
 * This is used by the agent to generate HTML / CSS / JS output files.
 * @param {{ filePath: string, content: string }} args
 * @returns {Promise<string>}
 */
export async function writeFile(args) {
  let filePath, content;

  // Handle both object and string cases
  try {
    if (typeof args === "object" && args !== null) {
      filePath = args.filePath;
      content = args.content;
    } else if (typeof args === "string") {
      const parsed = JSON.parse(args);
      filePath = parsed.filePath;
      content = parsed.content;
    }
  } catch (e) {
    return `Error parsing arguments: ${e.message}`;
  }

  if (!filePath || content === undefined) {
    return "Error: filePath and content are required.";
  }

  // Resolve relative to where the process is running (usually project root)
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const dir = path.dirname(resolvedPath);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolvedPath, content, "utf-8");

  return `File written successfully: ${resolvedPath}`;
}

// ─────────────────────────────────────────────
// 5. readFile
// ─────────────────────────────────────────────

/**
 * Reads and returns the content of a file.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function readFile(filePath = "") {
  try {
    const resolvedPath = path.resolve(filePath.trim());
    const content = fs.readFileSync(resolvedPath, "utf-8");
    return content;
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
}

// ─────────────────────────────────────────────
// 6. listDirectory
// ─────────────────────────────────────────────

/**
 * Lists the files in a given directory.
 * @param {string} dirPath
 * @returns {Promise<string>}
 */
export async function listDirectory(dirPath = ".") {
  try {
    const resolvedPath = path.resolve(dirPath.trim());
    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
    const result = entries
      .map((e) => `${e.isDirectory() ? "[DIR] " : "[FILE]"} ${e.name}`)
      .join("\n");
    return result || "Empty directory.";
  } catch (err) {
    return `Error listing directory: ${err.message}`;
  }
}

// ─────────────────────────────────────────────
// Tool map — name → function
// ─────────────────────────────────────────────

export const tool_map = {
  getTheWeatherOfCity,
  getGithubDetailsAboutUser,
  executeCommand,
  writeFile,
  readFile,
  listDirectory,
};

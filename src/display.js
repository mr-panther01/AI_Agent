/**
 * display.js — All console output / formatting utilities.
 *
 * Uses chalk for coloured terminal output so each agent step is
 * visually distinct and easy to follow in the demo video.
 */

import chalk from "chalk";

// ── Banner ──────────────────────────────────────────────────────────────────

export function printBanner() {
  console.log();
  console.log(chalk.bold.hex("#FF6B35")("  ╔══════════════════════════════════════════╗"));
  console.log(chalk.bold.hex("#FF6B35")("  ║") + chalk.bold.white("     🤖  CLI Agent  —  Assignment 02       ") + chalk.bold.hex("#FF6B35")("║"));
  console.log(chalk.bold.hex("#FF6B35")("  ║") + chalk.dim("     Powered by GPT-4.1-mini + ReAct       ") + chalk.bold.hex("#FF6B35")("║"));
  console.log(chalk.bold.hex("#FF6B35")("  ╚══════════════════════════════════════════╝"));
  console.log();
  console.log(chalk.dim("  Type your instruction and press Enter."));
  console.log(chalk.dim("  Type ") + chalk.yellow("exit") + chalk.dim(" or ") + chalk.yellow("quit") + chalk.dim(" to stop the agent."));
  console.log(chalk.dim("  Type ") + chalk.yellow("clear") + chalk.dim(" to start a fresh conversation."));
  console.log();
}

// ── Step printers ────────────────────────────────────────────────────────────

export function printStep(parsed) {
  const { step } = parsed;

  switch (step) {
    case "START":
      console.log();
      console.log(chalk.bold.blue("  ▶ START"));
      console.log(chalk.blue(`    ${parsed.content}`));
      break;

    case "THINK":
      console.log(chalk.bold.cyan("  💭 THINK"));
      console.log(chalk.cyan(`    ${parsed.content}`));
      break;

    case "TOOL":
      console.log(chalk.bold.magenta(`  🔧 TOOL  →  ${parsed.tool_name}`));
      console.log(chalk.magenta(`    args: ${typeof parsed.tool_args === "string" ? parsed.tool_args : JSON.stringify(parsed.tool_args)}`));
      break;

    case "OBSERVE":
      console.log(chalk.bold.yellow("  👁  OBSERVE"));
      // Trim long observe output for readability
      const obs = String(parsed.content);
      const display = obs.length > 400 ? obs.slice(0, 400) + " …[truncated]" : obs;
      console.log(chalk.yellow(`    ${display}`));
      break;

    case "OUTPUT":
      console.log();
      console.log(chalk.bold.green("  ✅ OUTPUT"));
      console.log(chalk.green(`    ${parsed.content}`));
      console.log();
      break;

    default:
      console.log(chalk.dim(`  [${step}] ${JSON.stringify(parsed)}`));
  }
}

// ── Error / info helpers ─────────────────────────────────────────────────────

export function printError(msg) {
  console.log(chalk.bold.red(`\n  ❌ ERROR: ${msg}\n`));
}

export function printInfo(msg) {
  console.log(chalk.dim(`  ℹ  ${msg}`));
}

export function printUserPrompt() {
  process.stdout.write(chalk.bold.hex("#FF6B35")("\n  You › "));
}

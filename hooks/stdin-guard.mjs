#!/usr/bin/env node
// Hook entrypoint for the "command handler receives JSON on stdin" convention.
//
// Installed as `.uaf/hooks/claude-guard.mjs` and `.uaf/hooks/codex-guard.mjs`.
// Depends on the sibling `./guard-core.mjs`, which the installer copies alongside it.
//
// Claude Code semantics (docs/research/claude-code.md §5): exit 0 continues,
// exit 2 blocks the tool call and feeds stderr back to the model.
// Codex semantics are documented only partially; this script emits the same shape.

import { loadRules, evaluateCommand, extractCommand, moduleDir } from "./guard-core.mjs";

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

const raw = await readStdin();
let payload = {};
try {
  payload = raw.trim() === "" ? {} : JSON.parse(raw);
} catch {
  // A malformed payload is not a policy violation; let the tool call proceed.
  process.exit(0);
}

const toolName = payload.tool_name ?? payload.toolName ?? payload.tool ?? "unknown";
const command = extractCommand(payload.tool_input ?? payload.toolInput ?? payload.input ?? payload.arguments);

if (command === null) process.exit(0);

const { rules, error } = loadRules(moduleDir(import.meta.url));
if (!rules) {
  process.stderr.write(`uaf guard: ${error}; no command policy applied\n`);
  process.exit(0);
}

const verdict = evaluateCommand(command, rules);

if (verdict.decision === "block") {
  process.stdout.write(
    `${JSON.stringify({
      decision: "block",
      reason: verdict.reason,
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.reason },
    })}\n`,
  );
  process.stderr.write(`uaf guard blocked ${toolName}: ${verdict.reason}\n`);
  process.exit(2);
}

if (verdict.decision === "review") {
  process.stdout.write(
    `${JSON.stringify({
      systemMessage: `uaf guard: review before running — ${verdict.reason}`,
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: `Policy note (${verdict.id}): ${verdict.reason}` },
    })}\n`,
  );
}

process.exit(0);

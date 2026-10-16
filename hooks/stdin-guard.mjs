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
}

const verdict = rules ? evaluateCommand(command, rules) : null;

// Exit through `process.exitCode`, never `process.exit()`: piped stdout and
// stderr are written asynchronously, so an explicit exit can discard a decision
// payload that has not flushed. Pipes are small — the same defect truncated CLI
// output on macOS CI after 8,154 bytes — and a dropped decision is worse than a
// slow one: the agent would see neither the block nor its reason. This payload is
// 293 bytes, so it is hardening, not a reproduced truncation: setting the code
// lets Node drain the pipes and exit on its own, and the blocked path still
// reports code 2.
if (verdict?.decision === "block") {
  process.stdout.write(
    `${JSON.stringify({
      decision: "block",
      reason: verdict.reason,
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.reason },
    })}\n`,
  );
  process.stderr.write(`uaf guard blocked ${toolName}: ${verdict.reason}\n`);
  process.exitCode = 2;
}

if (verdict?.decision === "review") {
  process.stdout.write(
    `${JSON.stringify({
      systemMessage: `uaf guard: review before running — ${verdict.reason}`,
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: `Policy note (${verdict.id}): ${verdict.reason}` },
    })}\n`,
  );
}

// Allowed, reviewed, and policy-less runs fall out with the default code 0.
// The two `process.exit(0)` calls above cannot truncate anything: they run
// before the first byte is written to stdout or stderr.

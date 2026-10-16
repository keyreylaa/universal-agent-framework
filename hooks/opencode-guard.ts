// @ts-nocheck
// OpenCode plugin, installed as `<repo>/.opencode/plugin/uaf-guard.ts`.
// Depends on `<repo>/.uaf/hooks/guard-core.mjs`, copied by the installer.
// OpenCode has no declarative hook system: tool interception is only reachable
// through the plugin API (docs/research/opencode.md §4, §10).

import { loadRules, evaluateCommand, evaluateWrite, extractCommand } from "../../.uaf/hooks/guard-core.mjs";

const SHELL_TOOLS = { bash: true, shell: true };
const WRITE_TOOLS = { edit: true, write: true, patch: true, multiedit: true };

export const UafGuard = async ({ directory }) => {
  const { rules, error } = loadRules(directory);
  if (!rules) {
    return {
      event: async ({ event }) => {
        if (event?.type === "session.created") {
          // Surfaced once per session so a missing policy file is visible.
          process.stderr.write(`uaf guard: ${error}; no command policy applied\n`);
        }
      },
    };
  }

  return {
    "tool.execute.before": async (input, output) => {
      const tool = input?.tool ?? "";

      if (SHELL_TOOLS[tool] === true) {
        const command = extractCommand(output?.args ?? {});
        if (command === null) return;
        const verdict = evaluateCommand(command, rules);
        if (verdict.decision === "block") {
          throw new Error(`uaf guard blocked ${tool}: ${verdict.reason}`);
        }
        if (verdict.decision === "review") {
          process.stderr.write(`uaf guard (${verdict.id}): ${verdict.reason}\n`);
        }
        return;
      }

      if (WRITE_TOOLS[tool] === true) {
        const filePath = String(output?.args?.filePath ?? output?.args?.path ?? output?.args?.file ?? "");
        const content = String(output?.args?.content ?? output?.args?.newString ?? "");
        const verdict = evaluateWrite({ filePath, content }, rules);
        if (verdict.decision === "block") {
          throw new Error(`uaf guard blocked write to ${filePath}: ${verdict.reason}`);
        }
      }
    },
  };
};

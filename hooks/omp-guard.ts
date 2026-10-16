// @ts-nocheck
// Oh My Pi hook entrypoint, installed as `<repo>/.omp/hooks/pre/uaf-guard.ts`.
// Depends on `<repo>/.uaf/hooks/guard-core.mjs`, copied by the installer.
// Oh My Pi discovers `hooks/pre/*.{ts,js}` and loads each factory through the
// extension runner (omp://hooks.md). A throwing `tool_call` handler fails closed.

import { loadRules, evaluateCommand, evaluateWrite, extractCommand } from "../../../.uaf/hooks/guard-core.mjs";

const SHELL_TOOLS = { bash: true, shell: true, powershell: true, cmd: true, pwsh: true };
const WRITE_TOOLS = { write: true, edit: true, apply_patch: true, multiedit: true, notebook_edit: true };

export default function uafGuard(pi) {
  const { rules, error } = loadRules(new URL(".", import.meta.url).pathname);
  if (!rules) {
    pi.logger?.warn?.(`uaf guard: ${error}; no command policy applied`);
    return;
  }

  pi.on("tool_call", async (event) => {
    if (SHELL_TOOLS[event.toolName] === true) {
      const command = extractCommand(event.input);
      if (command === null) return;
      const verdict = evaluateCommand(command, rules);
      if (verdict.decision === "block") {
        return { block: true, reason: `uaf guard blocked ${event.toolName}: ${verdict.reason}` };
      }
      if (verdict.decision === "review") {
        return { additionalContext: `uaf guard (${verdict.id}): ${verdict.reason}` };
      }
      return;
    }

    if (WRITE_TOOLS[event.toolName] === true) {
      const filePath = String(event.input?.path ?? event.input?.file_path ?? event.input?.paths?.[0] ?? "");
      const content = String(event.input?.content ?? event.input?.new_string ?? "");
      const verdict = evaluateWrite({ filePath, content }, rules);
      if (verdict.decision === "block") {
        return { block: true, reason: `uaf guard blocked write to ${filePath}: ${verdict.reason}` };
      }
    }
  });
}

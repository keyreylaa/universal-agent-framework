// @ts-nocheck
// OpenCode plugin, installed as `<repo>/.opencode/plugin/uaf-guard.ts`.
// Depends on `<repo>/.uaf/hooks/guard-core.mjs`, copied by the installer.
// OpenCode has no declarative hook system: tool interception is only reachable
// through the plugin API (docs/research/opencode.md §4, §10).
//
// OpenCode 2 loads a plugin only when its module default-exports a definition
// with an `id` and a `setup(ctx)` (or `effect`) function. The V1 shape — a named
// export returning a hook object — is refused at load with
// `Plugin must export a default definition with an id and an effect or setup
// function`, so the default export below is the whole contract. `Plugin.define`
// from `@opencode/plugin` is the typed equivalent; a plain object keeps this
// entrypoint dependency-free like the other three.

import { loadRules, evaluateCommand, evaluateWrite, extractCommand } from "../../.uaf/hooks/guard-core.mjs";

const SHELL_TOOLS = { bash: true, shell: true };
const WRITE_TOOLS = { edit: true, write: true, patch: true, multiedit: true };

export default {
  id: "uaf-guard",
  async setup(ctx) {
    const { rules, error } = loadRules(ctx.location.directory);
    if (!rules) {
      // Surfaced once per session so a missing policy file is visible. The V2
      // event stream replaces the V1 `event` hook; setup returns its cleanup.
      const controller = new AbortController();
      void (async () => {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            if (event?.type === "session.created") {
              process.stderr.write(`uaf guard: ${error}; no command policy applied\n`);
            }
          }
        } catch {
          // The subscription closed; nothing else to report.
        }
      })();
      return () => controller.abort();
    }

    // V2 registers hooks on the owning domain; the callback receives one event.
    await ctx.tool.hook("execute.before", (event) => {
      const tool = event?.tool ?? "";

      if (SHELL_TOOLS[tool] === true) {
        const command = extractCommand(event?.input ?? {});
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
        const input = event?.input ?? {};
        const filePath = String(input.filePath ?? input.path ?? input.file ?? "");
        const content = String(input.content ?? input.newString ?? "");
        const verdict = evaluateWrite({ filePath, content }, rules);
        if (verdict.decision === "block") {
          throw new Error(`uaf guard blocked write to ${filePath}: ${verdict.reason}`);
        }
      }
    });
  },
};

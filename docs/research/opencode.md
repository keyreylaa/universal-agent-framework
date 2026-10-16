# OpenCode extension surface — verified 2026-10

**Version scope (read first).** Two surfaces exist simultaneously:
- **v1** — `https://opencode.ai/docs/*`. Singular config keys (`agent`, `command`, `plugin`, `permission`, `provider`). This is the surface the question names (`opencode.json`, `.opencode/plugin/*.ts`, `.opencode/command/*.md`).
- **v2** — `https://opencode.ai/v2/docs/*` (mirror `https://v2.opencode.ai/docs/*`), banner "New OpenCode v2 is now available". Plural keys (`agents`, `commands`, `plugins`, `skills`, `permissions`, `providers`).

The config schema at `https://opencode.ai/config.json` is the **v2** schema (plural keys; singular ones retained, `permission` marked `"deprecated": true`). Repo: `sst/opencode` redirects to **`github.com/anomalyco/opencode`** (API `full_name: anomalyco/opencode`, `default_branch: dev`); docs header links to the anomalyco URL. `dev` branch = v2 codebase (packages `core`, `plugin`, `plugins`, `sdk`, `server`, `tui`, …); v1 code exists at tags `v1.x` (e.g. `v1.19.2`) under `packages/opencode/src/...`. Latest tags observed: `v2.0.30`, `v1.19.2`.

Missing/ambiguous items per question are listed as "v2 delta" or marked UNVERIFIED.

## Verified facts

### 1. Config — `opencode.json` / `opencode.jsonc`
- Both JSON and JSONC supported; `$schema: "https://opencode.ai/config.json"`. [docs/config](https://opencode.ai/docs/config/)
- Locations & precedence (later overrides earlier): remote `.well-known/opencode` → global `~/.config/opencode/opencode.json` → `OPENCODE_CONFIG` (custom file) → project `opencode.json` (found in cwd, traversing up to nearest git dir) → `.opencode` dirs → `OPENCODE_CONFIG_CONTENT` → managed files (`/etc/opencode/` on Linux, `/Library/Application Support/opencode/` macOS, `%ProgramData%\opencode` Windows) → macOS MDM prefs domain `ai.opencode.managed`. [docs/config#precedence-order](https://opencode.ai/docs/config/#precedence-order)
- Custom config dir: `OPENCODE_CONFIG_DIR` (searched for agents/commands/modes/plugins like `.opencode`). TUI settings live in `tui.json`/`~/.config/opencode/tui.json` (`$schema` `https://opencode.ai/tui.json`); `theme`/`keybinds`/`tui` keys in `opencode.json` are deprecated. [docs/config#schema](https://opencode.ai/docs/config/#schema)
- Top-level keys documented in v1 `docs/config`: `model`, `small_model`, `provider`, `agent`, `default_agent`, `subagent_depth`, `command`, `instructions`, `permission`, `tools` (deprecated since v1.1.1, merged into `permission`), `mcp`, `plugin`, `formatter`, `lsp`, `share`, `autoupdate`, `snapshot`, `server`, `shell`, `compaction`, `watcher`, `disabled_providers`, `enabled_providers`, `username`, `attachment`, `experimental`, `logLevel`, `layout` (deprecated), `autoshare` (deprecated). [docs/config](https://opencode.ai/docs/config/)
- Variable substitution in config: `{env:VAR}` and `{file:path/to/file}`. [docs/config#variables](https://opencode.ai/docs/config/#variables)
- **v2 delta:** file `opencode.jsonc`; keys `permissions` (array), `policies`, `agents`, `commands`, `plugins`, `skills` (also `references`, `worktree`, `update` = `disable|notify|auto`, `snapshots`, `warming`, `default_agent`). Config dir also loads `agents/`, `commands/`, `skills/`, `plugins/`. [v2 config](https://v2.opencode.ai/docs/config/), [config.json schema](https://opencode.ai/config.json)

### 2. Rules / instructions
- `AGENTS.md`: project root (applies to that dir + subdirs) and global `~/.config/opencode/AGENTS.md`. `/init` generates/updates it. [docs/rules](https://opencode.ai/docs/rules/)
- Precedence: (1) local files traversing up (`AGENTS.md`, `CLAUDE.md`) (2) global `~/.config/opencode/AGENTS.md` (3) `~/.claude/CLAUDE.md`. First match wins per category; `AGENTS.md` beats `CLAUDE.md`. [docs/rules#precedence](https://opencode.ai/docs/rules/#precedence)
- Claude-Code compatibility fallbacks: `CLAUDE.md`, `~/.claude/CLAUDE.md`, `~/.claude/skills/`; disable with `OPENCODE_DISABLE_CLAUDE_CODE`, `…_PROMPT`, `…_SKILLS` env vars. [docs/rules#claude-code-compatibility](https://opencode.ai/docs/rules/#claude-code-compatibility)
- `instructions: ["CONTRIBUTING.md","docs/guidelines.md",".cursor/rules/*.md"]` — glob array, also accepts remote URLs (5 s timeout); combined with `AGENTS.md`. OpenCode does **not** auto-parse `@file` references inside `AGENTS.md`. [docs/rules#custom-instructions](https://opencode.ai/docs/rules/#custom-instructions)
- **v2 delta:** same name; "Project instructions" added to agents alongside skills/references. [v2 agents](https://v2.opencode.ai/docs/agents/)

### 3. Skills (`SKILL.md`)
- Yes. Native `skill` tool, loaded on demand. Directories: `.opencode/skills/<name>/SKILL.md`, `~/.config/opencode/skills/<name>/SKILL.md`, `.claude/skills/…`, `~/.claude/skills/…`, `.agents/skills/…`, `~/.agents/skills/…`. Discovery walks up from cwd to the git worktree. [docs/skills](https://opencode.ai/docs/skills/)
- Frontmatter: `name` (required), `description` (required, 1–1024 chars), `license`, `compatibility`, `metadata` (string→string). OpenCode-specific keys live in `metadata`: `opencode/slash: "true"` (exposes `/name`), `opencode/autoinvoke: "false"` (hides from auto-selection). Name regex `^[a-z0-9]+(-[a-z0-9]+)*$`, 1–64 chars, must equal directory name. [docs/skills#write-frontmatter](https://opencode.ai/docs/skills/)
- Activation: skills are listed in the `skill` tool description as `<available_skills><skill><name>…</name><description>…</description></skill></available_skills>`; agent calls `skill({ name: "git-release" })`. Non-autoinvoke skills load only by exact name. [docs/skills#recognize-tool-description](https://opencode.ai/docs/skills/)
- Permissions: `permission.skill` accepts a pattern map (`"*": "allow"`, `"internal-*": "deny"`, `"experimental-*": "ask"`); `allow` loads immediately, `deny` hides + rejects, `ask` prompts. Overridable per agent (frontmatter or `agent.<name>.permission.skill`). Disable with `tools: { skill: false }`. [docs/skills#configure-permissions](https://opencode.ai/docs/skills/)
- **v2 delta:** skills discovered under `.opencode/skills/`; `skills` config is an array of extra local dirs or well-known URLs (`"./team-skills"`, `"https://example.com/.well-known/skills/"`); plugin API `ctx.skill.transform/reload/list`. [v2 config#skills](https://v2.opencode.ai/docs/config/), [v2 build/plugins](https://v2.opencode.ai/docs/build/plugins/)
- Local skill-index/remote-index download code: `packages/opencode/src/skill/discovery.ts` (v1.19.2) caches to `<cache>/skills`, requires `SKILL.md`. Whether a singular `.opencode/skill/` path is also scanned: UNVERIFIED (docs and config scanning use plural `skills`).

### 4. Plugins
- Layout (v1): `.opencode/plugins/` (project) and `~/.config/opencode/plugins/` (global), auto-loaded at startup; npm packages via `"plugin": ["opencode-helicone-session", "@my-org/custom-plugin"]`. npm plugins installed with Bun at startup, cached in `~/.cache/opencode/node_modules/`; local plugins may use a `.opencode/package.json` (dependencies installed via `bun install`). [docs/plugins](https://opencode.ai/docs/plugins/)
- Load order: global config → project config → global plugin dir → project plugin dir; all hooks run in sequence. [docs/plugins#load-order](https://opencode.ai/docs/plugins/#load-order)
- Plugin shape: `export const X = async ({ project, client, $, directory, worktree }) => ({ /* hooks */ })`; typed as `Plugin` from `@opencode-ai/plugin`. [docs/plugins#create-a-plugin](https://opencode.ai/docs/plugins/)
- **v1 hook names + signatures** (union of the published typings `@opencode-ai/plugin` `dist/index.d.ts` and `packages/plugin/src/index.ts@v1.0.200`):
  - `dispose?: () => Promise<void>`
  - `event?: (input: { event: Event }) => Promise<void>`
  - `config?: (input: Config) => Promise<void>`
  - `auth?: AuthHook` = `{ provider: string; loader?; methods: [{type:"oauth"|"api", label, prompts?, authorize?}] }`
  - `tool?: { [key: string]: ToolDefinition }` (custom tools; `tool({description, args: Zod, execute})` from `@opencode-ai/plugin`)
  - `"chat.message"?: (input: { sessionID; agent?; model?: {providerID, modelID}; messageID? }, output: { message: UserMessage; parts: Part[] }) => Promise<void>`
  - `"chat.params"?: (input: { sessionID; agent; model; provider: ProviderContext; message }, output: { temperature; topP; topK; options: Record<string, any> }) => Promise<void>`
  - `"chat.headers"?: (… ) => Promise<void>`
  - `"permission.ask"?: (input: Permission, output: { status: "ask"|"deny"|"allow" }) => Promise<void>`
  - `"command.execute.before"?: (input: { command; sessionID; arguments }, output: …) => Promise<void>`
  - `"tool.execute.before"?: (input: { tool; sessionID; callID }, output: { args: any }) => Promise<void>`
  - `"tool.execute.after"?: (input: { tool; sessionID; callID }, output: { title; output; metadata }) => Promise<void>`
  - `"shell.env"?: (input: { cwd; sessionID?; callID? }, output: { env: Record<string,string> }) => Promise<void>`
  - `"tool.definition"?: (input: { toolID }, output: { description; parameters: any }) => Promise<void>`
  - experimental: `"experimental.chat.messages.transform"`, `"experimental.chat.system.transform"`, `"experimental.provider.small_model"`, `"experimental.session.compacting"` (`output.context: string[]`, `output.prompt`), `"experimental.compaction.autocontinue"`, `"experimental.text.complete"`.
  Sources: `https://unpkg.com/@opencode-ai/plugin/dist/index.d.ts` (published typings of this repo's plugin package) and `github.com/anomalyco/opencode/blob/v1.0.200/packages/plugin/src/index.ts`.
- **Subscribable events** (via `event`, dots not colons): `command.executed`; `file.edited`, `file.watcher.updated`; `installation.updated`; `lsp.client.diagnostics`, `lsp.updated`; `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated`; `permission.asked`, `permission.replied`; `server.connected`; `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated`; `shell.env`; `tool.execute.after`, `tool.execute.before`; `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`. [docs/plugins#events](https://opencode.ai/docs/plugins/#events)
- Structured logging: `client.app.log({ body: { service, level: debug|info|warn|error, message, extra } })`. [docs/plugins#logging](https://opencode.ai/docs/plugins/#logging)
- **v2 delta (breaking):** plugins are `Plugin.define({ id, setup(ctx) })` from **`@opencode/plugin`** (`@opencode/plugin/effect` for Effect); no hook-object export. Capabilities: transform hooks `ctx.{agent,command,integration,mcp,model,provider,reference,skill,tool,vcs,websearch}.transform()`, `reload()` for each, runtime hooks `ctx.session.hook("context"|"retry"|"prompt")`, `ctx.aisdk.hook("sdk"|"language")`, `ctx.tool.transform()`, `ctx.storage`, `ctx.event.subscribe()`, `ctx.permission.{assert,list,get,reply}`, `ctx.session.*`, `ctx.generate.text`. Plugin config: `"plugins": ["pkg", { "package": "@acme/opencode-plugin", "options": {...} }]`, `-id`/`-*`/`.*` to disable, local dirs `.opencode/plugins/`, plugin CLI `opencode plugin add|list|check|update|remove`. [v2 build/plugins](https://v2.opencode.ai/docs/build/plugins/), [v2 plugins](https://v2.opencode.ai/docs/plugins/), `packages/plugin/src/README.md` (dev branch)
- v1 accepts both `.opencode/plugin/` and `.opencode/plugins/` dirs: `Glob.scan("{plugin,plugins}/*.{ts,js}")` in `packages/opencode/src/config/plugin.ts@v1.19.2`.

### 5. Custom commands
- Files: `.opencode/command/*.md` and `~/.config/opencode/command/*.md`; JSON alternative `"command": { "<name>": { template, description, agent, model, subtask } }` (`template` required). File name = command name ⇒ `/test`. [docs/commands](https://opencode.ai/docs/commands/)
- Frontmatter seen in docs: `description`, `agent`, `model`; `subtask: true` forces subagent invocation. Body is the template.
- Placeholders: `$ARGUMENTS`, positional `$1`, `$2`, `$3`; shell substitution `` !`npm test` `` (runs in project root, output inlined); file references `@src/components/Button.tsx` (content inlined). [docs/commands#prompt-config](https://opencode.ai/docs/commands/#prompt-config)
- Loader at v1.19.2 scans `{command,commands}/**/*.md` (`packages/opencode/src/config/command.ts`), i.e. singular and plural both work. **v2 delta:** `.opencode/commands/` (and `commands/` in the config dir); `"commands": { name: { description, template } }`. [v2 config#commands](https://v2.opencode.ai/docs/config/)

### 6. Agents
- Files: `.opencode/agent/*.md` (v1 docs write `.opencode/agents/`) and `~/.config/opencode/agents/*.md` (docs form; CLI help says `.opencode/agent`); JSON `"agent": { "<name>": {…} }`. Loader at v1.19.2 scans `{agent,agents}/**/*.md` plus legacy `{mode,modes}/*.md` (`packages/opencode/src/config/agent.ts`); nested dirs become part of the agent ID. [docs/agents#markdown](https://opencode.ai/docs/agents/), [docs/cli#agent](https://opencode.ai/docs/cli/#agent)
- Frontmatter/keys: `description` (required), `mode` (`primary|subagent|all`, default `all` in v1), `model` (`provider/model-id`), `temperature`, `top_p`, `steps` (max agentic iterations), `prompt` (or `{file:./prompts/x.txt}`, path relative to the config file), `tools` (deprecated; `true`≡`{"*":"allow"}`), `permission` (see §7), `disable`, `hidden`, `color`, plus arbitrary provider options passed through. [docs/agents#options](https://opencode.ai/docs/agents/#options)
- Built-ins: primary `build`, `plan`, plus hidden `compaction`, `title`, `summary`; subagents `general`, `explore`, `scout`. `opencode agent create` / `opencode agent list`. [docs/agents#built-in](https://opencode.ai/docs/agents/#built-in)
- **v2 delta:** `.opencode/agents/<name>.md` / `~/.config/opencode/agents/<name>.md`, frontmatter = same fields as an `agents` entry, body = `system`; `permissions` is an ordered rule list; legacy `temperature`, `top_p`, `prompt`, `permission`, `tools`, `disable`, `maxSteps` are disallowed; `mode` defaults to `primary`. [v2 agents](https://v2.opencode.ai/docs/agents/)

### 7. Permissions
- Values: `"allow"` (run), `"ask"` (prompt), `"deny"` (block). Global form `"permission": "allow"`, per-key form, or catch-all `"*"`. Object (pattern map) syntax is supported for `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `lsp`, `skill`; other keys take the shorthand only. Rules use last-match-wins; `*` (zero+ chars) and `?` (one char) wildcards; `~`/`$HOME` expansion. [docs/permissions](https://opencode.ai/docs/permissions/)
- Keys: `read`, `edit` (covers write/edit/apply_patch), `glob`, `grep`, `list`, `bash` (matches parsed command, e.g. `git status --porcelain`), `task` (subagent type), `skill` (skill name), `lsp`, `question`, `webfetch` (URL), `websearch`, `external_directory`, `doom_loop` (same tool call 3×). [docs/permissions#available-permissions](https://opencode.ai/docs/permissions/#available-permissions)
- Defaults: most `allow`; `doom_loop` and `external_directory` `ask`; `read` allows everything except `*.env`, `*.env.*` (denied) with `*.env.example` allowed. Agents merge over global (`agent.<name>.permission` wins). `--auto` / `opencode run --auto` auto-approves anything not explicitly denied. [docs/permissions#defaults](https://opencode.ai/docs/permissions/#defaults)
- **v2 delta:** `"permissions": [{ "action": "shell", "resource": "git push *", "effect": "ask" }]` where `resource` may be a path/command/agent ID and `action` accepts wildcards; global rules evaluate before agent rules; `policies` can hard-deny a permission check. [v2 agents#permissions](https://v2.opencode.ai/docs/agents/), [v2 config#permissions](https://v2.opencode.ai/docs/config/)

### 8. MCP
- `"mcp": { "<name>": { … } }` under `opencode.json`. Local: `type: "local"`, `command: ["npx","-y","pkg"]` (array, required), optional `cwd`, `environment` (object), `enabled` (bool), `timeout` (ms, default 5000). Remote: `type: "remote"`, `url` (required), optional `headers` (object), `oauth` (object or `false`), `enabled`, `timeout`. [docs/mcp-servers](https://opencode.ai/docs/mcp-servers/)
- OAuth auto-handled (401 → flow, dynamic client registration RFC 7591); pre-registered via `oauth.clientId/clientSecret/scope`; tokens at `~/.local/share/opencode/mcp-auth.json`. MCP tools are enabled/disabled like any tool (`"tools": { "my-mcp*": false }`). [docs/mcp-servers#oauth](https://opencode.ai/docs/mcp-servers/#oauth)
- CLI: `opencode mcp add`, `list`/`ls`, `auth [name]` / `auth list` / `auth ls`, `logout [name]`, `debug <name>`. [docs/cli#mcp](https://opencode.ai/docs/cli/#mcp)
- **v2 delta:** global `mcp.timeout` applies to servers from config files (per-server `timeout` overrides); plugin API `ctx.mcp.transform/reload` with `disabled: true|false`. [v2 config#mcp](https://v2.opencode.ai/docs/config/), [v2 build/plugins](https://v2.opencode.ai/docs/build/plugins/)

### 9. CLI & SDK
- `opencode run [message..]`: `--command`, `--continue/-c`, `--session/-s`, `--fork`, `--model/-m`, `--agent`, `--file/-f`, `--format` (default|json), `--title`, `--attach <url>`, `--password/-p`, `--username/-u`, `--dir`, `--port`, `--variant`, `--thinking`, `--auto`. [docs/cli#run](https://opencode.ai/docs/cli/#run)
- TUI entry `opencode [project]`: `--continue`, `--session`, `--fork`, `--prompt`, `--model`, `--agent`, `--auto`, `--port`, `--hostname`, `--mdns`, `--mdns-domain`, `--cors`. [docs/cli#tui](https://opencode.ai/docs/cli/#tui)
- Global flags include `--version/-v`, **`--print-logs`** (print logs to stderr), `--log-level` (DEBUG/INFO/WARN/ERROR), `--pure` (run without external plugins). [docs/cli](https://opencode.ai/docs/cli/)
- `opencode serve` (`--port`, `--hostname`, `--mdns`, `--mdns-domain`, `--cors`; HTTP basic auth via `OPENCODE_SERVER_PASSWORD`, user defaults to `opencode`), `opencode web`, `opencode attach [url]`, `opencode auth login` (`--provider/-p`, `--method/-m`; credentials in `~/.local/share/opencode/auth.json`), `opencode auth list|ls|logout`, `opencode models [provider]`, `opencode session list|delete`, `opencode export|import`, `opencode stats`, `opencode github install|run`, `opencode debug`. [docs/cli](https://opencode.ai/docs/cli/)
- SDK/packages: `@opencode-ai/sdk` (`createOpencode`, `createOpencodeClient`, options `hostname` default `127.0.0.1`, `port` default `4096`, `signal`, `timeout`, `config`); upstream types seen in the plugin typings: `@opencode-ai/sdk`, `@opencode-ai/sdk/v2`; plugin package `@opencode-ai/plugin`. [docs/sdk](https://opencode.ai/docs/sdk/), `https://unpkg.com/@opencode-ai/plugin/dist/index.d.ts`
- **v2 delta:** shared background server by default (`--standalone`, `--server <url>`, `opencode service set disabled true`), `opencode run` "Mini" mode, plugin CLI, plugin package `@opencode/plugin`. [v2 cli](https://v2.opencode.ai/docs/cli/), `packages/plugin/src/README.md` (dev)

### 10. Hooks beyond plugins
- No declarative hook system found. The v1 config docs enumerate every top-level key (see §1) and contain **no** `hooks` key; file/tool/session events are only reachable through the plugin `event` hook and the plugin hooks in §4. File-level automation is via LSP events (`lsp.client.diagnostics`, `lsp.updated`) and `file.edited` / `file.watcher.updated`, all plugin-side. [docs/config](https://opencode.ai/docs/config/), [docs/plugins#events](https://opencode.ai/docs/plugins/#events)
- Automatic (non-plugin) event producers: the GitHub Actions integration (`opencode github install|run`, flags `--event`, `--token`) and auto-compaction. [docs/cli#github](https://opencode.ai/docs/cli/#github)
- **v2 delta:** declarative policy statements (`policies`: allow/deny provider use, hard-deny a permission check, block an MCP server/skill/plugin) — the closest thing to declarative hooks — plus session/aisdk runtime hooks in the plugin API. [v2 config#policies](https://v2.opencode.ai/docs/config/), [v2 build/plugins](https://v2.opencode.ai/docs/build/plugins/)

## Unverified / unknown
- Whether `.opencode/skill/` (singular) is scanned in v1: the docs and `config/agent.ts`/`command.ts`/`plugin.ts` globs use `{x,xs}` pairs for agents/commands/plugins, but no singular/plural pair was observed for skills; `packages/opencode/src/skill/index.ts` (local scan) was not read — UNVERIFIED.
- Exact final v1 release number (tags `v1.19.2` and earlier `v1.1.x`/`v1.14.x` confirmed; highest v1 tag not enumerated to the end) — UNVERIFIED.
- Which surface new installs get by default (v1 docs still served at `/docs` while `/v2/docs` is advertised and `config.json` is the v2 schema) — UNVERIFIED.
- v2 command frontmatter field list beyond `description`/`template` (`arguments`, `agent`, `model` mentioned in the v2 docs cross-reference but not read) — UNVERIFIED.
- v2 skills frontmatter/`metadata` keys (`opencode/slash`, `opencode/autoinvoke`) — only verified for v1 — UNVERIFIED.
- Whether v1 accepts v2 plural keys (`agents`, `commands`, `permissions`, `plugins`) via `ConfigV2Compat` — file `packages/opencode/src/config/v2-compat.ts` exists at v1.19.2, behavior not read — UNVERIFIED.
- v1 `experimental.text.complete` and `tool.definition` hook semantics (names verified in typings only) — UNVERIFIED beyond signature.

## Sources
- https://opencode.ai/docs/config/
- https://opencode.ai/docs/rules/
- https://opencode.ai/docs/skills/
- https://opencode.ai/docs/plugins/
- https://opencode.ai/docs/commands/
- https://opencode.ai/docs/agents/
- https://opencode.ai/docs/permissions/
- https://opencode.ai/docs/mcp-servers/
- https://opencode.ai/docs/cli/
- https://opencode.ai/docs/sdk/
- https://opencode.ai/config.json (JSON Schema; v2-shape, singular keys deprecated)
- https://v2.opencode.ai/docs/config/
- https://v2.opencode.ai/docs/agents/
- https://v2.opencode.ai/docs/plugins/
- https://v2.opencode.ai/docs/build/plugins/
- https://v2.opencode.ai/docs/cli/
- https://github.com/anomalyco/opencode (canonical repo; sst/opencode redirects here)
- https://github.com/anomalyco/opencode/blob/v1.0.200/packages/plugin/src/index.ts (v1 `Hooks`)
- https://github.com/anomalyco/opencode/blob/v1.19.2/packages/opencode/src/config/agent.ts
- https://github.com/anomalyco/opencode/blob/v1.19.2/packages/opencode/src/config/command.ts
- https://github.com/anomalyco/opencode/blob/v1.19.2/packages/opencode/src/config/plugin.ts
- https://github.com/anomalyco/opencode/blob/v1.19.2/packages/opencode/src/skill/discovery.ts
- https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/README.md (v2 plugin API)
- https://unpkg.com/@opencode-ai/plugin/dist/index.d.ts (published typings of the v1 plugin API)

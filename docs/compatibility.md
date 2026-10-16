# Compatibility matrix

Two levels of confidence are used throughout, and the distinction is the point of this document:

- **runtime-verified** — exercised against a running agent in this environment.
- **docs-derived** — read from the agent's official documentation. The path is correct as
  documented; the agent was not present to confirm it.

Only **Oh My Pi** is installed in the development environment. Its adapter is runtime-verified:
`tests/e2e/omp-discovery.test.mjs` installs the skill set and asserts that Oh My Pi's own
`skill://` resolver returns the content of an installed skill, and that duplicate copies in two
shared skill roots collapse instead of being namespaced. The other three adapters are docs-derived
and `uaf compat` reports them as such.

Sources for every claim: `docs/research/claude-code.md`, `docs/research/codex.md`,
`docs/research/opencode.md`, and the Oh My Pi documentation (`omp://skills.md`,
`omp://context-files.md`, `omp://hooks.md`, `omp://slash-command-internals.md`).

## Capability matrix

| Capability | Claude Code | Codex CLI | OpenCode | Oh My Pi |
| --- | --- | --- | --- | --- |
| Skills file format | `SKILL.md` + YAML frontmatter | `SKILL.md` + frontmatter (agent-skills standard) | `SKILL.md` + frontmatter | `SKILL.md` + frontmatter |
| Project skills | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` | `.opencode/skills/…`, also `.claude/skills`, `.agents/skills` | `.omp/skills/…`, also `.claude/skills`, `.agents/skills` |
| User skills | `~/.claude/skills/…` | `$HOME/.agents/skills/…` | `~/.config/opencode/skills/…` | `~/.omp/agent/skills/…` |
| Model-invoked activation | yes (description match) | yes (description match) | yes (`skill` tool) | yes (metadata in system prompt) |
| User-invoked activation | `/skill-name` | `$skill` mention, `/skills` picker | `/name` when the skill opts in via `metadata` | `/skill:<name>` |
| Disable model invocation | `disable-model-invocation: true` | `skills.config` enable/disable | `metadata.opencode/autoinvoke: "false"` | `hide: true` |
| Project commands | `.claude/commands/*.md` | **none** — user-scope prompts only | `.opencode/command/*.md` | `.omp/commands/*.md` |
| User commands | `~/.claude/commands/` | `$CODEX_HOME/prompts/*.md` (documented as deprecated) | `~/.config/opencode/command/` | `~/.omp/agent/commands/` |
| Argument placeholder | `$ARGUMENTS`, `$N` | `$ARGUMENTS`, `$1` | `$ARGUMENTS`, `$1` | `$ARGUMENTS`, `$1`, `$@` |
| Project context file | `CLAUDE.md` (and `AGENTS.md` only when no `CLAUDE.md` exists) | `AGENTS.md` | `AGENTS.md` (beats `CLAUDE.md`) | `AGENTS.md`, `CLAUDE.md`, native `.omp/AGENTS.md` |
| User context file | `~/.claude/CLAUDE.md` | `$CODEX_HOME/AGENTS.md` | `~/.config/opencode/AGENTS.md` | `~/.omp/agent/AGENTS.md` |
| Path-scoped rules | `.claude/rules/*.md` with `paths:` frontmatter | none | none (`instructions` glob array instead) | rulebook files; `RULES.md` is always-apply |
| Declarative hooks | `hooks` key of a settings JSON file | `hooks.json` or `[hooks]` in `config.toml` | **none** — plugins only | **none** — extensions only |
| Hook approval/trust | exit code 2 blocks `PreToolUse` | per-definition-hash trust review via `/hooks` | n/a (plugin code runs in-process) | `tool_call` handlers fail closed |
| Command-hook input | JSON on stdin | JSON on stdin (schema only partially documented) | n/a | n/a |
| Plugin/extension unit | `.claude-plugin/plugin.json` + marketplace | plugin + marketplace via `codex plugin` | `.opencode/plugin/*.ts` or npm package | `.omp/extensions/*.ts` or npm package |
| Extension language | JSON manifest + Markdown components | TOML/JSON manifest | TypeScript | TypeScript (`ExtensionAPI`) |
| Permission model | `permissions.allow/ask/deny`, `defaultMode` | sandbox mode + approval policy | `permission.*` pattern maps | tool approval tiers |
| MCP | `.mcp.json`, `~/.claude.json`, `claude mcp` | `[mcp_servers.*]`, `codex mcp` | `mcp` object, `opencode mcp` | `.mcp.json`, `mcp://` resources |
| Non-interactive mode | `claude -p` | `codex exec` (read-only sandbox by default) | `opencode run` | `omp -p` |
| Config directory | `~/.claude` (`CLAUDE_CONFIG_DIR`) | `~/.codex` (`CODEX_HOME`) | `~/.config/opencode` (`OPENCODE_CONFIG_DIR`) | `~/.omp/agent` (`PI_CODING_AGENT_DIR`, profiles) |

## Why only two skill roots serve four agents

The installer does not copy a skill four times. It computes a set cover over the locations each
agent actually reads (`SKILL_LOCATIONS` in `core/emit.mjs`):

| Location | Read by | Note |
| --- | --- | --- |
| `.claude/skills` | Claude Code, OpenCode, Oh My Pi | OpenCode and Oh My Pi both read Claude's directory. |
| `.agents/skills` | Codex, OpenCode, Oh My Pi | Codex's only documented repository skill path. |
| `.omp/skills` | Oh My Pi | Native, highest precedence. Not needed when a shared root is already written. |
| `.opencode/skills` | OpenCode | Native. Not needed when a shared root is already written. |

No single location covers all four, so the minimum is two. At user scope the pair is
`~/.agents/skills` plus `~/.claude/skills`, with the same reasoning.

Duplicated content is not a correctness problem: Oh My Pi collapses byte-identical copies of a
skill and the Claude and OpenCode loaders de-duplicate the directories they read. The end-to-end
test asserts that the resulting listing contains no namespaced duplicates.

## Context files

| File written | Serves | Reasoning |
| --- | --- | --- |
| `AGENTS.md` | Codex, OpenCode, Oh My Pi (plus Claude Code when no `CLAUDE.md` exists) | The broadest-reach project instruction file. |
| `CLAUDE.md` | Claude Code, OpenCode, Oh My Pi | Written only when the file already exists, because Claude Code ignores `AGENTS.md` while a `CLAUDE.md` is present. |
| `~/.omp/agent/AGENTS.md`, `~/.claude/CLAUDE.md`, `$CODEX_HOME/AGENTS.md`, `~/.config/opencode/AGENTS.md` | one agent each | User scope is per-agent; the agents do not share a user context file. |

The framework deliberately does **not** write `.omp/AGENTS.md`. Oh My Pi reads native project
context only from the nearest non-empty `.omp/` directory, so creating that file would shadow a
repository-root `AGENTS.md` at the same depth and silently drop the user's own guidance.

## Known gaps, stated rather than worked around

| Gap | Consequence | Closest reliable alternative |
| --- | --- | --- |
| Codex has no project-level command directory. | Project-scope commands are not installed for Codex; `uaf install` reports this. | Codex's user-scope prompts, or the equivalent skill. |
| Codex command hooks require a per-definition-hash trust review. | The installed guard does not run until the user approves it in `/hooks`. | `uaf git --commit` and `uaf secrets` run standalone. |
| Codex hook input/output schema is only partially documented. | The guard's decision protocol for Codex is not runtime-verified. | Treat the Codex guard as advisory; rely on the sandbox and approval policy. |
| OpenCode has no declarative hooks. | Enforcement requires a TypeScript plugin in `.opencode/plugin/`, and OpenCode 2 loads it only when the module default-exports `{ id, setup }`. | The installed plugin entrypoint, or `uaf` in a git hook. |
| Claude Code reads `AGENTS.md` only when no `CLAUDE.md` exists. | A repository with a `CLAUDE.md` needs the block written into that file too. | Handled automatically by the installer. |
| Only Oh My Pi could be exercised here. | Claude Code, Codex, and OpenCode adapters are unverified at runtime. | Re-run `npm run test:e2e` on a machine with those agents installed. |

## Checking the matrix on your machine

```sh
node core/cli.mjs compat          # the table above, generated from the registry
node core/cli.mjs compat --json   # the same data, machine-readable
node core/cli.mjs doctor          # which agents are present and which adapters are verified
```

`uaf compat` reads `core/agents.mjs`. Every entry there carries a `verified` field that names the
documentation it came from, so the registry and this document cannot drift apart silently.

# universal-agent-framework

One shared set of skills, commands, safety checks, and project memory for Claude Code, OpenAI
Codex CLI, OpenCode, and Oh My Pi.

## Why

Four coding agents, four extension models, and a strong incentive to write the same guidance four
times. This framework authors each artifact once in the vendor-neutral Agent Skills layout,
installs it into the directories each agent actually reads, and proves the placement with tests
rather than assuming it.

It is not a collection of Markdown files. The runtime is a dependency-free Node.js program (about
4,000 lines including comments) that decides what to install, records what it owns, indexes the
project, scans credentials, and blocks the handful of commands that are catastrophic and easy to
type.

## Features

- **Skills authored once.** 13 skills covering engineering quality, dependency decisions, eight
  languages by reference, debugging, testing, security, code review, Git, GitHub publishing,
  documentation, project memory, Discord bots, and data extraction.
- **Two directories instead of four.** The installer computes which shared skill roots cover the
  selected agents, so all four agents are served by `.claude/skills` and `.agents/skills` rather
  than four duplicated copies.
- **Exact removal.** Every mutation is recorded in an ownership manifest. Uninstall reverses it
  and *preserves* anything edited by hand, reporting what it kept and why.
- **Real verification.** `uaf git --commit` inspects the staged index blobs and `uaf gh` inspects
  the outgoing commit range, so a credential already deleted from disk is still caught.
- **Deterministic project memory.** A no-embeddings index with incremental rebuilds, secret
  exclusion before any read, atomic writes, and crash-safe recovery.
- **A hook policy with one source of truth.** One JSON rule set, four native entrypoints, blocking
  only what is irreversible or credential-exposing.
- **Three verification modes** whose depth is driven by assessed risk, not by enthusiasm.
- **Zero runtime dependencies.** `node:` builtins only. No build step.

## Requirements

- Node.js >= 20 (the same floor every supported agent already needs).
- Git, for the Git and GitHub preflight.
- Optional: the `gh` CLI for repository, CI, and divergence checks.

## Installation

### One command

```sh
curl -fsSL https://raw.githubusercontent.com/keyreylaa/universal-agent-framework/main/scripts/get.sh | sh -s -- --agents claude,codex,opencode,omp
```

Run it from the project you want to configure. It caches the framework under
`${XDG_DATA_HOME:-$HOME/.local/share}/uaf/src`, prints the plan, and asks before writing
anything. Add `--yes` to skip the prompt, or `--dry-run` to only see the plan.

Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/keyreylaa/universal-agent-framework/main/scripts/get.ps1))) -Agents claude,codex,opencode,omp
```

Useful environment variables: `UAF_REF` (git ref to fetch; pin a tag to fix a version),
`UAF_HOME` (cache location), `UAF_TARGET` (project to configure), `UAF_SOURCE` (a fork, a
tarball URL, or a local checkout).

This downloads and runs code. The default `main` ref moves; pass `UAF_REF=v0.1.0` to pin a
tag you have inspected.

### From a clone

```sh
git clone https://github.com/keyreylaa/universal-agent-framework
cd universal-agent-framework

scripts/install.sh --dry-run                    # see the plan; nothing is written
scripts/install.sh --cwd /path/to/project --agents claude,codex,opencode,omp
```

`--agents` is optional: with no flag, the installer targets the agents it detects, then the list in
`.uaf/config.json`. Use `--scope user` to install into your user configuration directories instead
of a project (hooks and the vendored runtime are project-scope only).

The installer refuses to run against the framework's own checkout unless `--self` is passed, so
invoking the script from the clone cannot accidentally configure the clone itself.

Both entry points print the full plan and ask before writing. In a non-interactive shell the
command refuses and exits 2 unless `--yes` is passed.

Verify, then remove cleanly:

```sh
node /path/to/universal-agent-framework/core/cli.mjs doctor
node /path/to/universal-agent-framework/core/cli.mjs status
node /path/to/universal-agent-framework/core/cli.mjs uninstall --yes
```

Full detail: `docs/installation.md`.

## Quick start

After installing into a project, the shipped commands are available to the agent:

| Command | Purpose |
| --- | --- |
| `/uaf-doctor` | Diagnose the environment, detected agents, and install state. |
| `/uaf-index` | Build or refresh the project index. |
| `/uaf-recall <terms>` | Find where something is implemented, using the index. |
| `/uaf-remember <note>` | Record a durable decision or constraint. |
| `/uaf-preflight` | Git pre-commit checks: secrets, identity, staged set, artifacts. |
| `/uaf-publish-check` | GitHub checks: destination, divergence, CI, outgoing secrets. |
| `/uaf-secrets [paths]` | Credential pattern scan. |
| `/uaf-mode [get\|set\|suggest]` | Inspect or change the operating mode. |
| `/uaf-status` | Installed artifacts and drift. |
| `/uaf-compat` | The cross-agent capability matrix. |

The commands invoke the runtime vendored into the project, so a global install is not required:

```sh
node "$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs" git --commit
```

## Usage examples

```sh
uaf index                          # incremental; unchanged files are reused
uaf search "rate limit" --kind code
uaf remember "Retries use exponential backoff; the cap is deliberate." --kind convention
uaf secrets src config             # scan specific paths
uaf git --commit                   # pre-commit gate; exits 1 when blocked
uaf gh                             # read-only; nothing is pushed
uaf mode suggest --files src/auth/login.ts,db/migrations/01.sql
```

## How skills are activated

Four distinct mechanisms, and each agent implements a different subset:

| Class | Mechanism | Notes |
| --- | --- | --- |
| Always-on | The managed block in `AGENTS.md` / `CLAUDE.md` | Short by design; ships on every request. |
| Contextual | Agent matches a skill's `description` against the task | All four agents support this. |
| Explicit | `/skill:<name>`, `$name`, `/name`, or the picker | Varies by agent; see `docs/compatibility.md`. |
| Event-driven | Hook entrypoints wired per agent | Only Claude Code, Codex, Oh My Pi, and OpenCode, each differently. |

Verification status is stated per agent rather than assumed. Only Oh My Pi is installed in the
development environment, so only its adapter is runtime-verified: the end-to-end suite installs
the skill set and asserts that Oh My Pi's own resolver returns an installed skill. The other three
are derived from official documentation, cited in `docs/research/`.

## Configuration

Project settings live in `.uaf/config.json`:

```json
{
  "mode": "full",
  "agents": ["claude", "codex", "opencode", "omp"],
  "index": { "exclude": ["vendor-copy/", "*.generated.ts"] }
}
```

| Key | Meaning |
| --- | --- |
| `mode` | `lite`, `full` (default), or `ultra`. Verification depth, not feature count. |
| `agents` | Default agent selection when `--agents` is absent and nothing is detected. |
| `index.exclude` | Extra globs excluded from the index, on top of `.gitignore`. |

Precedence is flag > project config > user config (`~/.uaf/config.json`) > default.

## Testing

```sh
npm test          # unit, integration, and security suites
npm run test:e2e  # end-to-end agent discovery; skips itself when no agent is installed
npm run test:all
```

The suites are described in `docs/testing.md`. Tests build their own temporary project and
sandboxed `HOME`, so they never touch your real configuration directories.

## Security

- Credential scanning covers the staged index and the outgoing commit range, not just the working
  tree.
- Secret-named files are never read by the indexer, so they cannot reach a prompt or a memory note.
- The hook policy blocks destructive and credential-exposing commands and warns on the rest; it is
  a guard, not a sandbox.
- A clean scan is not proof of security, and this framework claims no such thing.

Read `docs/security.md` before relying on any of it, and `SECURITY.md` to report a problem.

## Compatibility

| Agent | Skills | Commands | Context | Hooks | Runtime-verified |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `.claude/skills` | `.claude/commands` | `CLAUDE.md` | `settings.json` `hooks` | no |
| Codex CLI | `.agents/skills` | user-scope prompts only | `AGENTS.md` | `.codex/hooks.json` | no |
| OpenCode | `.opencode/skills`, `.claude/skills`, `.agents/skills` | `.opencode/command` | `AGENTS.md` | plugin only | no |
| Oh My Pi | `.omp/skills`, `.claude/skills`, `.agents/skills` | `.omp/commands` | `AGENTS.md`, `CLAUDE.md` | `.omp/hooks/pre` extension | yes |

Every path is cited in `docs/compatibility.md` and in `core/agents.mjs`.

## Repository layout

```
core/            dependency-free runtime (CLI, installer, indexer, scanning, preflight)
skills/          skill sources, authored once in the Agent Skills layout
commands/        workflow commands, copied into each agent's command directory
hooks/           one guard policy plus a thin entrypoint per agent runtime
templates/       managed context block and .uaf/.gitignore
scripts/         get.sh, get.ps1 (one-command bootstrap) and install/uninstall wrappers
tests/           unit/ integration/ security/ e2e/
docs/            architecture, compatibility, installation, skills, commands, memory,
                 security, testing, development, troubleshooting, research/
```

## Contributing

See `CONTRIBUTING.md`. The short version: no runtime dependencies, tests must assert observable
behaviour, and an adapter change needs a citation and a test.

## License

MIT. See `LICENSE`.

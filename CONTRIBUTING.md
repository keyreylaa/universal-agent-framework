# Contributing

## Prerequisites

- Node.js >= 20 (the same floor the framework declares in `package.json`).
- `git`.
- One or more of the supported agents, if you want to exercise an adapter end to end.

There are no runtime dependencies. Adding one requires the justification described in
`skills/engineering/dependencies/SKILL.md` and should be raised as an issue first.

## Setup

```sh
git clone <repository-url>
cd universal-agent-framework
npm test          # unit, integration, and security suites
npm run test:e2e  # end-to-end; skips itself when no agent is installed
```

## Layout

| Path | Contents |
| --- | --- |
| `core/` | Zero-dependency runtime: CLI, installer, indexer, secret scanning, preflight, modes. |
| `skills/<category>/<name>/SKILL.md` | Skills authored once in the vendor-neutral Agent Skills layout. |
| `commands/` | Slash commands, copied into each agent's native command directory. |
| `hooks/` | One shared guard policy plus a thin entrypoint per agent runtime. |
| `templates/` | The managed context block and the `.uaf/.gitignore` written by install. |
| `core/agents.mjs` | The agent registry: every path, cited to a research note. |
| `docs/research/` | Source-backed capability notes for each agent, with citations. |
| `tests/` | `unit/`, `integration/`, `security/`, `e2e/`. |
| `scripts/` | `get.sh`/`get.ps1` (fetch-then-install bootstrap) and the install/uninstall wrappers for POSIX shells and PowerShell. |

## Changing an adapter

1. Read the corresponding file in `docs/research/`. If the behaviour is not documented there,
   add a citation before changing code.
2. Update the agent entry in `core/agents.mjs` and the table in `docs/compatibility.md` together.
3. Add or update a test in `tests/unit/emit.test.mjs` covering the path resolution.
4. If you cannot verify the behaviour against a running agent, say so in the entry's `notes`
   and keep `runtimeVerified` as `false`. Do not claim compatibility because a file was written.

## Adding or editing a skill

- Directory: `skills/<category>/<name>/SKILL.md`, where `<name>` matches the frontmatter `name`.
- Allowed frontmatter keys: `name`, `description`, `license`, `metadata`.
- The `description` must be one line and must state both what the skill does and when it should
  activate, because all four agents select skills by matching that text.
- Values must be unambiguous YAML. Run `node core/cli.mjs skills` — it fails on ambiguous
  frontmatter before an agent silently drops the file.
- Keep the listing cheap: `node core/cli.mjs skills` prints the total always-on token cost.
- Support files belong beside `SKILL.md` (for example `references/`). Discovery is not recursive,
  so a skill that needs sub-documents must reference them explicitly from its body.

## Adding a command

- File: `commands/<name>.md`. The frontmatter `description` is required; quote any `argument-hint`.
- Use `$ARGUMENTS` for arguments: it is the only placeholder all four agents understand.
- Resolve the vendored runtime instead of assuming a global install:
  `node "$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs" <command>`.

## Style

- Plain ESM, `node:` builtins only, no build step.
- Prefer a small explicit function over an abstraction with one caller.
- Static string-keyed lookup tables are objects; `Map`/`Set` are for dynamic keys.
- Comments explain why. A comment that restates the code should be deleted.
- Tests assert observable behaviour. Do not pin implementation details or incidental formatting.

## Pull requests

Include:

- what changed and why;
- the exact commands you ran and their results (`npm test`, plus `npm run test:e2e` if you
  touched an adapter);
- anything you could not verify, stated plainly.

Do not include generated artifacts, local configuration, or credentials. Run `npm test` before
pushing; the security suite fails the build if a fixture would leak a real-looking credential.

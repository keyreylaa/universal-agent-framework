# Commands

Two command surfaces are documented here: the `uaf` CLI in `core/cli.mjs`, and the slash commands
that ship in `commands/` and are copied into each agent's native command directory.

## Exit codes

`core/cli.mjs` defines one `EXIT` map and every handler returns a value from it.

| Code | Name | Meaning |
| --- | --- | --- |
| 0 | `OK` | Success. |
| 1 | `FINDINGS` | Findings that need attention: blocking preflight results, drift, an invalid skill, no index. |
| 2 | `USAGE` | Usage error, unknown command, or a mutation refused because it was not confirmed. |
| 3 | `BLOCKED` | A command refused to proceed because doing so would violate policy. |

An uncaught error inside a handler is printed and mapped to `FINDINGS` (1); a fatal error at the top
level also exits 1. `--json` is a global flag: handlers that branch on it emit a JSON document to
stdout instead of the human-readable form.

## Read-only versus mutating

Read-only commands perform no mutation: `doctor`, `compat`, `status`, `skills`, `search`, `secrets`,
`git`, `gh`, `notes`, `prompt`, and `mode get|suggest`.

Mutating commands: `install`, `uninstall`, `index`, `remember`, and `mode set`.

`install` (outside `--dry-run`) and `uninstall` are the two commands behind the confirmation gate.
The gate returns `true` immediately when `--yes` is passed. Otherwise, if stdin is not a TTY it
refuses with `refusing to proceed without confirmation; re-run with --yes` and exits 2; if stdin is
a TTY it asks `[y/N]`. No command ever publishes anything remotely.

Several handlers read an internal `--cwd <dir>` override (used by the test suite to point at a
sandbox project); it is not part of the documented surface.

## Command reference

Unless stated otherwise, every command accepts `--json`.

### `install`

Install skills, commands, hooks, and the managed context block for one or more agents.

```sh
uaf install [--agents <ids>] [--scope project|user] [--dry-run] [--link]
            [--no-hooks] [--no-commands] [--no-context] [--mode lite|full|ultra] [--yes]
```

- `--agents` — comma-separated subset of `claude,codex,opencode,omp`. Defaults to the detected
  agents. With no selection and nothing detected, it fails with `no agents selected` (exit 2). An
  unknown id fails with `unknown agent '<id>'` (exit 2).
- `--scope` — `project` (default) or `user`. User scope targets the home directory.
- `--dry-run` — print the plan and change nothing (exit 0).
- `--link` — symlink skill directories instead of copying them.
- `--no-hooks`, `--no-commands`, `--no-context` — omit that artifact group.
- `--mode` — mode baked into the managed context block.
- `--yes` — apply without the interactive confirmation.

JSON output, `--dry-run`:

```json
{
  "scope": "project",
  "scopeRoot": "/abs/root",
  "projectRoot": "/abs/root",
  "agents": ["claude", "codex"],
  "skills": [{ "name": "...", "category": "...", "bytes": 0, "description": "..." }],
  "actions": [{ "type": "copy", "target": "/abs/path", "description": "...", "agent": "claude" }],
  "warnings": [],
  "budget": { "skillBytes": 0, "skillListingTokensEstimate": 0, "target": "..." }
}
```

JSON output, applied:

```json
{
  "applied": 42,
  "byStatus": { "created": 40, "replaced": 2 },
  "manifest": "/abs/root/.uaf/install.json",
  "warnings": [],
  "actions": [{ "type": "copy", "target": "/abs/path", "status": "created" }]
}
```

Exit: 0 on success; 2 when the agent selection is invalid or the confirmation is refused.

### `uninstall`

Remove exactly what install created. Hand-modified files are preserved, not deleted.

```sh
uaf uninstall [--scope project|user] [--purge] [--yes]
```

- `--scope` — `project` (default) or `user`.
- `--purge` — also delete `.uaf/index.json`, `.uaf/memory`, and `.uaf/cache`. Without it, project
  index and memory are kept.

JSON output:

```json
{
  "removed": [{ "type": "copy", "target": "/abs/path", "status": "removed" }],
  "preserved": [{ "type": "copy", "target": "/abs/path", "reason": "content changed since install; left in place" }],
  "prunedDirs": ["/abs/dir"]
}
```

When no manifest exists it emits `{ "removed": [], "preserved": [], "prunedDirs": [], "note": "..." }`.
Removal is driven entirely by the manifest: `copy`, `link`, `block`, `json-array-append`, and
`write-if-absent` entries are reversed, `.uaf/guard-rules.json` and `.uaf/index.lock` are removed,
then the manifest itself, then now-empty directories are pruned. Exit: 0 on success; 2 when the
confirmation is refused.

### `status`

Show the install manifest and detect drift.

```sh
uaf status [--scope project|user]
```

JSON output is the manifest description:

```json
{
  "exists": true,
  "scopeRoot": "/abs/root",
  "frameworkVersion": "0.1.0",
  "createdAt": "...",
  "updatedAt": "...",
  "agents": ["claude"],
  "entries": 42,
  "drift": [{ "target": "/abs/path", "state": "modified" }]
}
```

`state` is `missing` (claimed file gone) or `modified` (content changed since install). Exit: 1 when
drift is present, otherwise 0.

### `doctor`

Diagnose the environment, agent detection, and installed state.

```sh
uaf doctor
```

Flags read by the handler: `--scopeRoot <dir>` (treats that directory as the scope root),
`--mode`, `--cwd`, `--json`.

JSON output:

```json
{
  "framework": { "version": "0.1.0", "root": "/abs/framework" },
  "runtime": { "node": "v20.0.0", "platform": "linux/arm64", "cwd": "...", "projectRoot": "..." },
  "agents": [{ "id": "omp", "label": "Oh My Pi", "installed": true, "signal": "binary:omp", "userRoot": "...", "skillsProject": "...", "commandsProject": "...", "runtimeVerified": true }],
  "detected": ["omp"],
  "manifest": { "exists": false, "entries": 0, "drift": [] },
  "mode": { "resolved": "full", "origin": "default", "policy": {} },
  "config": { "project": {}, "user": {} },
  "index": null,
  "checks": [{ "level": "warn", "message": "..." }]
}
```

`index` is `null` when no index exists, otherwise an object with `generatedAt`, `version`, `files`,
`lines`, `byKind`, `byLanguage`, and `path`. `checks[].level` is `warn` or `info`. Exit: 0.

### `compat`

Print the cross-agent capability matrix.

```sh
uaf compat
```

JSON output is an array of rows, one per agent id, each carrying the spec verbatim plus resolved
paths:

```json
[
  {
    "id": "codex",
    "label": "OpenAI Codex CLI",
    "runtimeVerified": false,
    "research": "docs/research/codex.md",
    "skills": { "project": ".agents/skills", "user": "/home/u/.agents/skills", "citation": "..." },
    "commands": { "project": null, "user": "/home/u/.codex/prompts", "citation": "..." },
    "context": { "project": "AGENTS.md", "user": "/home/u/.codex/AGENTS.md", "citation": "..." },
    "hooks": { "kind": "codex-hooks-json", "events": ["..."], "citation": "..." },
    "rules": { "project": null, "support": "none" },
    "permissions": { "file": ["..."], "keys": ["..."] },
    "notes": ["..."],
    "resolved": { "id": "codex", "skillsProject": "/abs/repo/.agents/skills", "...": "..." }
  }
]
```

Exit: 0.

### `index`

Build or refresh the project index.

```sh
uaf index [--force] [--mode lite|full|ultra]
```

`--force` re-derives the index instead of reusing unchanged files by size and mtime. A stale lock
from an interrupted run is noted and the index is rebuilt from the last consistent snapshot.
Secret-named files, binaries, oversized files, build output, vendored dependencies, and
`.gitignore`d paths are skipped.

JSON output:

```json
{
  "path": "/abs/root/.uaf/index.json",
  "stats": {
    "scanned": 0, "indexed": 0, "reused": 0, "rehashed": 0,
    "added": 0, "changed": 0, "removed": 0,
    "skippedSecret": 0, "skippedBinary": 0, "skippedLarge": 0,
    "durationMs": 0
  },
  "summary": { "files": 0, "lines": 0, "byKind": {}, "byLanguage": {} },
  "tooling": {},
  "warnings": []
}
```

Exit: 0.

### `search`

Search the index.

```sh
uaf search <query> [--limit N] [--kind <kind>] [--language <language>] [--chars N]
```

- `<query>` — the positional terms joined by spaces; empty query fails with
  `usage: uaf search <query>` (exit 2).
- `--limit` — maximum results, default 20.
- `--kind`, `--language` — filter results.
- `--chars` — character budget for the human-readable formatter, default 4000.

A missing index fails with `no index found; run \`uaf index\` first` and exit 1.

JSON output:

```json
{ "query": "retry", "count": 1, "results": [{ "path": "src/retry.ts", "...": "..." }] }
```

Exit: 0 on a completed search (including zero matches); 1 for a missing index; 2 for an empty query.

### `remember`

Record a project note.

```sh
uaf remember "<text>" [--kind decision|convention|bug|constraint|preference|question] [--id <key>]
```

- `--kind` — one of `decision`, `convention`, `bug`, `constraint`, `preference`, `question`;
  anything else falls back to `note`.
- `--id` — the note key; defaults to `note-<base36 timestamp>`. Recording an existing id updates it.

Empty text fails with `usage: uaf remember "note text" [--id key]` (exit 2). Text that matches a
high-severity credential pattern is refused with `refusing to store a note containing credential
material` and exit 3. The note is written to `.uaf/memory/NOTES.json` (and into the index) only on
success.

JSON output: `{ "id": "...", "kind": "...", "text": "...", "notes": 1 }`. Exit: 0.

### `notes`

List recorded notes.

```sh
uaf notes
```

JSON output is the notes array; human output is one `id [kind] text` line per note, or
`no project notes recorded`. Exit: 0.

### `prompt`

Print the always-on context/mode block.

```sh
uaf prompt [--mode lite|full|ultra] [--project <name>]
```

The block is the mode preamble followed by `templates/context-block.md` with `{{mode}}` and
`{{modeSummary}}` substituted.

JSON output: `{ "mode": "...", "origin": "...", "tokens": 0, "block": "..." }`. Exit: 0.

### `skills`

List authored skills with sizes and token estimates, and validate the authored commands.

```sh
uaf skills
```

JSON output:

```json
{
  "skills": [{ "name": "code-quality", "category": "engineering", "valid": true, "errors": [], "warnings": [], "bytes": 0, "lines": 0, "description": "...", "listingTokens": 0, "files": 1 }],
  "commands": [{ "name": "uaf-doctor", "description": "...", "issues": [] }],
  "listingTokens": 1465,
  "ok": true
}
```

`ok` is true only when every skill is valid and no command has a frontmatter issue. Exit: 0 when
`ok`, otherwise 1.

### `secrets`

Scan files or the current diff for credentials.

```sh
uaf secrets [<paths...>]
```

With no paths it scans the project root. This is a pattern and file-name scan, not a review.

JSON output: `{ "scanned": 0, "skipped": 0, "findings": [] }`. Exit: 1 when at least one
high-severity finding is present, otherwise 0.

### `git`

Git preflight. Read-only: it inspects the index blobs (what would be committed), not the working
tree.

```sh
uaf git [--commit]
```

`--commit` runs the pre-commit checks. JSON output:
`{ "ok": true, "summary": { "error": 0, "warn": 0, "info": 0 }, "findings": [], "info": {} }`.
Exit: 0 when `ok`, otherwise 1.

### `gh`

GitHub preflight: remote, repository existence, divergence, outgoing secrets, and CI run status.
Read-only; nothing is pushed.

```sh
uaf gh [--remote origin]
```

JSON output:
`{ "ok": true, "degraded": false, "summary": {}, "findings": [], "info": {} }`. Exit: 0 when `ok`,
otherwise 1.

### `mode`

Get, set, or suggest the operating mode.

```sh
uaf mode get
uaf mode set <lite|full|ultra> [--scope project|user]
uaf mode suggest [--files a,b,c]
```

- `get` — resolve the current mode. JSON: `{ "mode": "...", "origin": "...", "policy": {} }`.
- `set` — write `.uaf/config.json` (project, default) or `~/.uaf/config.json` (`--scope user`). An
  invalid mode fails with `mode must be one of: lite, full, ultra` (exit 2). This branch has no
  `--json` form: it prints one confirmation line.
- `suggest` — derive a mode from risk. `--files` is a comma-separated list; with no `--files` the
  handler uses the first 40 paths from the project index (empty when no index exists). JSON:
  `{ "mode": "...", "reason": "...", "risk": { "score": 0, "level": "...", "reasons": [] } }`.

An unknown action fails with `unknown mode action '<action>'. Use get | set <mode> | suggest`
(exit 2). Otherwise exit 0.

### `help` and `version`

`uaf help` (or `--help`) prints the `HELP` string; `uaf version` (or `--version`) prints the
`package.json` version. Both exit 0. An unknown command prints `uaf: unknown command '<command>'`
followed by the help text to stderr and exits 2.

## Slash commands

Each file in `commands/` is a prompt copied into every selected agent's native command directory as
`<name>.md`. Layout, per `core/agents.mjs`:

| Agent | Project commands | User commands |
| --- | --- | --- |
| Claude Code | `.claude/commands` | `~/.claude/commands/` |
| Codex CLI | none (unsupported) | `$CODEX_HOME/prompts/` |
| OpenCode | `.opencode/command` | `~/.config/opencode/command/` |
| Oh My Pi | `.omp/commands` | `~/.omp/agent/commands/` |

Every shipped command resolves the vendored runtime rather than assuming a global install:

```sh
node "$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs" <args>
```

| File | Purpose | `$ARGUMENTS` use |
| --- | --- | --- |
| `uaf-doctor.md` | Run the environment diagnostic and report detection, install state, and mode. | `doctor $ARGUMENTS` — unquoted; hint `[--json]`. |
| `uaf-compat.md` | Show the cross-agent capability matrix. | `compat $ARGUMENTS` — unquoted; hint `[--json]`. |
| `uaf-status.md` | Show what is installed and whether any installed file has drifted. | `status $ARGUMENTS` — unquoted; hint `[--scope project\|user] [--json]`. |
| `uaf-index.md` | Build or refresh the project index. | `index $ARGUMENTS` — unquoted; hint `[--force] [--json]`. |
| `uaf-recall.md` | Find where something is implemented using the index. | `search "$ARGUMENTS"` — quoted; hint `<query terms>`. |
| `uaf-remember.md` | Record a durable decision, convention, constraint, or bug. | `remember "$ARGUMENTS"` — quoted; hint `"<note text>" [--kind ...] [--id key]`. |
| `uaf-secrets.md` | Scan files for credential patterns before sharing or committing. | `secrets $ARGUMENTS` — unquoted; hint `[paths...] [--json]`. |
| `uaf-preflight.md` | Run the git commit preflight. | `git --commit $ARGUMENTS` — a fixed subcommand, then unquoted args; hint `[--json]`. |
| `uaf-publish-check.md` | Check the GitHub destination, divergence, CI, and outgoing secrets. | `gh $ARGUMENTS` — unquoted; hint `[--remote origin] [--json]`. |
| `uaf-mode.md` | Inspect or change the operating mode, or get a risk-based suggestion. | `mode $ARGUMENTS` — unquoted; hint `[get\|set <mode>\|suggest] [--files a,b] [--scope project\|user] [--json]`. |

### Placeholder portability

`$ARGUMENTS` is the only argument placeholder that all four agents understand. Claude Code and
Codex also accept `$1`/`$N`-style placeholders, OpenCode accepts `$1`, and Oh My Pi accepts `$1` and
`$@`; none of those is portable across all four, so the shipped commands use `$ARGUMENTS` only.

Codex has no project-level command directory. Its commands are user-scope prompts under
`$CODEX_HOME/prompts/` only (documented as deprecated in favour of skills). `install` therefore
skips Codex when placing project-scope commands and records a warning that its workflow commands are
available as skills instead. The other command-file frontmatter keys observed in `commands/` are
`description` (required) and `argument-hint`.

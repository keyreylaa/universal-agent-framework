# Installation

`uaf install` writes shared skills, slash commands, hook wiring, and one managed context block
into directories that Claude Code, Codex CLI, OpenCode, and Oh My Pi already read. It is a
copy-in installer: nothing is published remotely, no package manager runs, and every file it
writes is recorded in an ownership manifest so `uaf uninstall` can reverse exactly that work.

## Prerequisites

- **Node.js >= 20.** `scripts/install.sh`, `scripts/install.ps1`, `scripts/uninstall.sh`, and
  `scripts/uninstall.ps1` all read `process.versions.node`, and exit **2** when `node` is missing
  from `PATH` or the major version is below 20. `package.json` declares
  `"engines": { "node": ">=20" }`.
- **No other dependency.** The framework has no runtime dependencies, no build step, and no
  service to reach. The CLI is plain ES modules under `core/`.

## Entry points

| Entry point | Invocation |
| --- | --- |
| Bootstrap (POSIX, no clone) | `curl -fsSL .../scripts/get.sh \| sh -s -- --agents claude,omp` |
| Bootstrap (Windows, no clone) | `& ([scriptblock]::Create((irm .../scripts/get.ps1))) -Agents claude,omp` |
| POSIX wrapper | `./scripts/install.sh [options]` |
| Windows wrapper | `.\scripts\install.ps1 [options]` |
| CLI directly | `node core/cli.mjs install [options]` |
| Vendored runtime inside a project | `node .uaf/framework/core/cli.mjs <command>` |
| `uaf` on `PATH` | after linking/installing the package (`"bin": { "uaf": "./core/cli.mjs" }`), `uaf install [options]` is equivalent |

Run the wrappers from a framework checkout: both compute the framework root from their own script
location.

### `scripts/get.sh` — the one-command bootstrap

```sh
curl -fsSL https://raw.githubusercontent.com/keyreylaa/universal-agent-framework/main/scripts/get.sh \
  | sh -s -- --agents claude,codex,opencode,omp
```

Run it from the project you are configuring. `sh -s --` is what forwards arguments to a piped
script; without it, `--agents` would be consumed by the local `sh`.

What it does, in order:

1. Reconnects stdin to `/dev/tty` when there is a terminal, so approval prompts still work even
   though `curl | sh` has already consumed stdin. The probe runs in a subshell, because a failed
   `exec < /dev/tty` terminates a non-interactive shell.
2. Fetches the framework into the cache at `${XDG_DATA_HOME:-$HOME/.local/share}/uaf/src`:
   `git clone --depth 1 --branch "$UAF_REF"` for a repository URL, an incremental
   `fetch` + `checkout --detach FETCH_HEAD` when the cache already exists, `curl | tar` for an
   archive URL, a recursive copy for a local directory, and a `codeload` tarball when `git` is
   absent but the source is a GitHub URL. The archive path needs `curl`, `tar`, and `gzip`, and
   says which one is missing instead of letting `tar` fail with a truncated pipe. Both fetch
   paths were exercised against the live repository: with `git` on `PATH`, and with a minimal
   `PATH` that had no `git` (the `codeload` branch), which fetched and installed successfully.
3. Verifies the fetched tree actually contains `core/cli.mjs` and that Node >= 20 is present.
4. Resolves the target: an explicit `-C`/`--cwd` in the arguments wins, then `UAF_TARGET`, then the
   current directory. The cache directory is refused as a target.
5. `exec`s `scripts/install.sh --cwd <target> "$@"`, so the plan, prompt, and manifest behaviour
   are identical to a local clone.

| Variable | Default | Meaning |
| --- | --- | --- |
| `UAF_REF` | `main` | Git ref to fetch. Pin a tag for a reproducible install. |
| `UAF_SOURCE` | the GitHub repository | Fork, tarball URL, or a local checkout path. |
| `UAF_HOME` | `${XDG_DATA_HOME:-$HOME/.local/share}/uaf` | Cache root; the tree lands in `src/`. |
| `UAF_TARGET` | the current directory | Project to configure. |

**Trust assumption, stated plainly.** This downloads and executes code, and by default it follows
the moving `main` branch. There is no published checksum for a branch, and the script does not
pretend otherwise. To pin a version, set `UAF_REF` to a tag you have inspected, or clone and run
`scripts/install.sh` yourself. The bootstrap adds no trust beyond "I agree to run this repository's
installer".

`scripts/get.ps1` is the Windows equivalent with the same environment variables, plus the
`-Agents`, `-Scope`, `-CwdPath`, `-DryRun`, `-Yes`, `-Link`, `-NoHooks`, `-NoCommands`, and
`-NoContext` parameters. It falls back to downloading and expanding the GitHub zip when `git` is
not installed.

### `scripts/install.sh`

```sh
./scripts/install.sh [--scope project|user] [--agents a,b] [--mode lite|full|ultra] [--dry-run]
                     [-C|--cwd <dir>] [--yes|-y] [--link] [--no-hooks]
                     [--no-commands] [--no-context]
```

- Accepts `--scope <v>`, `--scope=<v>`, `--agents <v>`, `--agents=<v>`, `--mode <v>`,
  `--mode=<v>`, `--dry-run`, `--yes`, `-y`, `--link`, `--no-hooks`, `--no-commands`,
  `--no-context`, `-C`/`--cwd`, `-h`, `--help`.
- An unknown argument prints `install.sh: unknown argument <arg>` and exits **2**.
- **It always prints the plan.** Without `--dry-run` it runs `install … --dry-run` first, prints a
  blank line, and then asks `Apply this plan? [y/N]`. Only after an affirmative answer does it
  re-run the CLI with `--yes`. Any other answer prints `aborted; nothing was changed.` and exits 0.
- With `--dry-run` it execs `install … --dry-run` and writes nothing.
- `--yes` skips the question; this is the only non-interactive-safe path through the wrapper.
  Without `--yes` and without a terminal, `read` reaches EOF: the script prints
  `no answer on stdin (piped input?); nothing was changed. Re-run with --yes.` and exits **2**.
  That 2 is the wrapper's own, not the CLI's refusal described below — the failed `read` is handled
  explicitly rather than left to `set -eu`, and the CLI is never invoked. Any answer other than
  `y`/`yes` prints `aborted; nothing was changed.` and exits 0.

### `scripts/install.ps1`

```powershell
.\scripts\install.ps1 [-Scope project|user] [-Agents claude,codex,opencode,omp] [-DryRun] [-Yes] [-Link]
                      [-CwdPath <dir>] [-NoHooks] [-NoCommands] [-NoContext]
```

Parameter names are PascalCase (`-Scope`, `-Agents`, `-DryRun`, `-Yes`, `-Link`, `-NoHooks`,
`-NoCommands`, `-NoContext`); `-Scope` is validated against `project|user`; `-CwdPath` forwards to the CLI's `--cwd`. There is no mode
parameter — use `-Agents`/direct CLI invocation plus `uaf mode set` if a mode is required. The
script always runs the plan (`--dry-run`) first, prints `Planned changes:`, and exits early when
`-DryRun` is set. Otherwise, unless `-Yes` is given, it asks `Apply this plan? [y/N]` and aborts
without changes on anything other than `y`/`yes`.

### CLI flags

| Flag | Effect |
| --- | --- |
| `--agents <ids>` | Comma-separated subset of `claude,codex,opencode,omp`. Default: every agent detected on this machine. An unknown id fails with `unknown agent '<id>'. Known: claude, codex, opencode, omp` (exit 2). |
| `--scope <scope>` | `project` (default; any value other than `user` is treated as `project`) or `user`. |
| `--dry-run` | Print the plan (JSON with `--json`) and touch nothing. |
| `--yes` | Apply without asking. |
| `--link` | Symlink each skill directory into the target root instead of copying it. A target that exists and is not already a symlink is skipped and reported. |
| `--no-hooks` / `--no-commands` / `--no-context` | Skip that artifact class. |
| `-C` / `--cwd <dir>` (wrappers and CLI) | Target a project other than the current directory. Without it, a wrapper invoked from the framework checkout would target the checkout, so the CLI refuses that case with exit 2 unless `--self` is passed. |
| `--mode <mode>` | `lite`, `full`, or `ultra`; substituted into the context block. Anything else falls back to `full`. |

`--json` (global) makes `install`, `status`, `doctor`, `compat`, `skills`, `index`, `search`,
`notes`, `prompt`, `secrets`, `git`, `gh`, and `mode` emit machine-readable output.

**Confirmation.** `install` prints the plan, then asks `Apply <n> action(s) to <root>? [y/N]`. It
never applies without confirmation unless `--yes` is passed. When stdin is not a terminal it does
not silently proceed: it writes `uaf: refusing to proceed without confirmation; re-run with --yes`
to stderr and exits **2**. Answering `n` at the prompt also exits 2. `--json` does not bypass the
gate. `--dry-run` returns before the gate, so a dry run is always safe.

Unattended example:

```sh
node core/cli.mjs install --agents claude,codex,opencode,omp --dry-run --json   # inspect
node core/cli.mjs install --agents claude,codex,opencode,omp --yes              # apply
```

## Scopes

`project` (the default) writes only inside the project root. `user` writes into each selected
agent's user configuration directory, with `$HOME` as the scope root. A project-scope install is
verified not to touch `$HOME` at all (`tests/integration/install.test.mjs`, `tests/integration/cli.test.mjs`).

| Artifact | `project` | `user` |
| --- | --- | --- |
| Skills | `.claude/skills/<name>/` and `.agents/skills/<name>/` | `~/.agents/skills/<name>/` and `~/.claude/skills/<name>/` |
| Commands | Each selected agent's project command directory (Codex has none) | Each selected agent's user command directory (Codex: `$CODEX_HOME/prompts/`) |
| Vendored runtime `.uaf/framework/` | yes | **no** — the runtime is project-scope only |
| `.uaf/guard-rules.json` and hook entrypoints | yes | **refused**, with the warning `hooks are installed at project scope only; user-scope hook installation is not implemented` |
| `.uaf/.gitignore` | yes (only if absent) | no |
| Context block | `AGENTS.md` and/or `CLAUDE.md` in the project | Each agent's own user context file |
| Manifest | `<project>/.uaf/install.json` | `~/.uaf/install.json` |

Agent selection is detection-based by default. An agent counts as detected when its binary is on
`PATH` (`claude`, `codex`, `opencode`, `omp`) **or** its user config directory exists. A project
directory such as `.claude/` or `.opencode/` produces a `project:` signal in `uaf doctor` but does
not by itself mark an agent as installed. When nothing is detected, `install` fails with `no agents
selected. Pass --agents claude,codex,opencode,omp or install a supported agent first.` (exit 2).

## What a project-scope install writes

Skill and command names come from `skills/**/SKILL.md` and `commands/**/*.md` in the framework
checkout (13 skills and 10 commands at the time of writing). Skills are installed for every
selected agent; commands are installed only for agents that have a directory to put them in.

```text
.claude/skills/<skill-name>/...            # one directory per skill
.agents/skills/<skill-name>/...            # byte-identical copy
.claude/commands/<command>.md              # Claude Code      (10 commands)
.opencode/command/<command>.md             # OpenCode         (10 commands)
.omp/commands/<command>.md                 # Oh My Pi         (10 commands)
.uaf/framework/core/...                    # vendored runtime (copy of core/)
.uaf/framework/package.json                # runtime manifest
.uaf/framework/templates/...               # context block and .uaf/.gitignore templates
.uaf/.gitignore                            # written only if absent
.uaf/guard-rules.json                      # shared command/write policy
.uaf/hooks/guard-core.mjs                  # guard policy module (shared by entrypoints)
.uaf/hooks/claude-guard.mjs                # Claude Code entrypoint
.uaf/hooks/codex-guard.mjs                 # Codex entrypoint
.claude/settings.json                      # PreToolUse hook entry appended under "hooks"
.codex/hooks.json                          # created only if absent
.omp/hooks/pre/uaf-guard.ts                # Oh My Pi entrypoint
.opencode/plugin/uaf-guard.ts              # OpenCode plugin
AGENTS.md and/or CLAUDE.md                 # one managed block
.uaf/install.json                          # ownership manifest
```

Installed skills: `bot-development`, `code-quality`, `code-review`, `commit`, `data-extraction`,
`dependencies`, `languages`, `project-memory`, `publish`, `readme`, `review`, `root-cause`,
`strategy`. Installed commands: `uaf-compat`, `uaf-doctor`, `uaf-index`, `uaf-mode`,
`uaf-preflight`, `uaf-publish-check`, `uaf-recall`, `uaf-remember`, `uaf-secrets`, `uaf-status`.

Two behaviours are deliberately conservative:

- `.codex/hooks.json` is **write-if-absent**. An existing file is left untouched and reported as
  `skipped` so a project's own hook configuration is never overwritten.
- `.claude/settings.json` is edited only by appending one deep-equal-tested entry under
  `hooks.PreToolUse`; unrelated keys are preserved. If the file is not valid JSON the append is
  skipped and reported as `skipped` with the reason
  `<path> is not valid JSON; left untouched (Claude Code rejects comments and trailing commas)`.

### Why two skill roots serve four agents

No single directory is read by all four agents, so the installer computes a set cover over the
locations each agent actually documents (`SKILL_LOCATIONS` in `core/emit.mjs`):

| Location | Read by |
| --- | --- |
| `.claude/skills` | Claude Code, OpenCode, Oh My Pi |
| `.agents/skills` | Codex, OpenCode, Oh My Pi |
| `.omp/skills` | Oh My Pi only |
| `.opencode/skills` | OpenCode only |

The two shared roots cover all four agents, so the native `.omp/skills` and `.opencode/skills`
directories are never written. At user scope the pair that covers all four agents is
`~/.agents/skills` plus `~/.claude/skills`, for the same reason; a smaller selection gets a smaller
cover — installing only Oh My Pi writes `~/.agents/skills` alone. Duplicated content is not a
correctness problem: the loaders de-duplicate the directories they read, and
`tests/e2e/omp-discovery.test.mjs` asserts that Oh My Pi collapses byte-identical copies instead of
namespacing them.

### Agent paths

Project scope. Only Oh My Pi is runtime-verified; the other three rows are derived from the
citations in `docs/research/` and are reported as such by `uaf compat` and `uaf doctor`.

| Agent | Project skills | Project commands | Project context | Hook wiring |
| --- | --- | --- | --- | --- |
| Claude Code | `.claude/skills` | `.claude/commands` | `CLAUDE.md` (alternate `.claude/CLAUDE.md`) | `hooks.PreToolUse` entry in `.claude/settings.json` |
| Codex CLI | `.agents/skills` | none — project-scope commands are unsupported | `AGENTS.md` | `.codex/hooks.json` |
| OpenCode | `.opencode/skills` (also reads `.claude/skills`, `.agents/skills`) | `.opencode/command` | `AGENTS.md` | `.opencode/plugin/` |
| Oh My Pi | `.omp/skills` (also reads `.claude/skills`, `.agents/skills`) | `.omp/commands` | `.omp/AGENTS.md` (also reads `AGENTS.md`, `CLAUDE.md`) | `.omp/hooks/pre/` |

Codex is reported rather than worked around: with `codex` selected at project scope, `install`
prints `codex: project-scope commands are unsupported by this agent (Codex only reads user-scope
$CODEX_HOME/prompts/); its workflow commands are available as skills instead`.

User scope. The user root of each agent is configurable through the environment:

| Agent | User root | User skills | User commands | User context | Env override |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `~/.claude` | `~/.claude/skills` | `~/.claude/commands` | `~/.claude/CLAUDE.md` | `CLAUDE_CONFIG_DIR` |
| Codex CLI | `~/.codex` | `~/.agents/skills` | `$CODEX_HOME/prompts` | `$CODEX_HOME/AGENTS.md` | `CODEX_HOME` |
| OpenCode | `~/.config/opencode` | `<root>/skills` | `<root>/command` | `<root>/AGENTS.md` | `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME` |
| Oh My Pi | `~/.omp/agent` | `<root>/skills` | `<root>/commands` | `<root>/AGENTS.md` | `PI_CODING_AGENT_DIR`, `OMP_PROFILE`/`PI_PROFILE` |

## The managed context block

The block is rendered from `templates/context-block.md` with `{{mode}}` and `{{modeSummary}}`
substituted, and wrapped in two markers:

```markdown
<!-- uaf:begin v1 -->
<!-- universal-agent-framework: content between these markers is generated; edit the framework sources instead. -->
...generated body...
<!-- uaf:end -->
```

- **Append, never overwrite.** If both markers are present the region between them is replaced
  wholesale. If they are not, the block is appended after the existing content, separated by a
  blank line. Existing project instructions above the block are untouched — verified by
  `tests/integration/install.test.mjs`, which prepends `# House rules` and `Never deploy on Friday.`
  to `AGENTS.md` and asserts both survive.
- **Idempotent reinstall.** Re-running install leaves exactly one block; the same test asserts a
  single `uaf:begin v1` occurrence after a second run.
- **Which file.** `AGENTS.md` is written when Codex, OpenCode, or Oh My Pi is selected, or when
  Claude Code is the only selected agent and no `CLAUDE.md` exists. `CLAUDE.md` (or
  `.claude/CLAUDE.md` if that is the existing file) is written when Claude Code is selected and a
  `CLAUDE.md` already exists, because Claude Code ignores `AGENTS.md` while a `CLAUDE.md` is
  present. At user scope each selected agent gets the block in its own user context file.
- **Hand edits inside the block are drift.** The manifest stores a hash of the whole file, so
  `uaf status` reports the file as `modified` after any edit inside the block. A reinstall
  overwrites the block with freshly generated text, and uninstall removes the entire marked region
  — edits inside the markers are not preserved. Put project-specific guidance outside the block.
- The installer deliberately does not create `.omp/AGENTS.md`; writing it would shadow a
  repository-root `AGENTS.md` at the same depth, and it warns about that choice.

## Ownership, drift, and reinstall

Every mutation is recorded in `<scopeRoot>/.uaf/install.json`, which is what makes uninstall
exact. The `cmdInstall` flow assigns `scope` and `frameworkVersion`, then `saveManifest` derives
`agents` from the entries and refreshes `updatedAt`.

```json
{
  "version": 1,
  "scopeRoot": "/path/to/project",
  "scope": "project",
  "frameworkVersion": "0.1.0",
  "createdAt": "…",
  "updatedAt": "…",
  "agents": ["claude", "codex", "omp", "opencode"],
  "entries": [
    {
      "type": "copy",
      "agent": "claude",
      "target": "/path/to/project/.claude/skills/code-quality",
      "source": "/framework/skills/engineering/code-quality",
      "kind": "skill",
      "skill": "code-quality",
      "command": null,
      "hash": "…",
      "previousHash": null,
      "replaced": false,
      "installedAt": "…"
    }
  ]
}
```

Entry types are `copy`, `link`, `block`, `json-array-append`, and `write-if-absent`. Entries are
keyed by `type|target`, so a reinstall updates an existing entry in place instead of appending a
duplicate — `tests/integration/install.test.mjs` asserts the entry count is identical before and
after a second run and that drift is empty.

`uaf status` compares each recorded hash with the file on disk and reports drift as `modified` or
`missing`; it exits **1** when any drift exists. `uaf doctor` warns with
`<n> installed artifact(s) changed since install; run \`uaf status\` for the list.`

To update an installed copy, re-run install from the newer checkout:

```sh
node core/cli.mjs install --agents claude,codex,opencode,omp --yes
node core/cli.mjs status
```

Since `install` overwrites skill, command, runtime, and non-symlink hook files, local edits to
installed files are lost on reinstall. Drift is reported before that happens, but keep project
additions in your own files rather than inside the installed artifact set.

## Uninstall

```sh
node core/cli.mjs uninstall [--scope project|user] [--purge] [--yes]
./scripts/uninstall.sh  [--scope project|user] [--purge] [--yes]
.\scripts\uninstall.ps1 [-Scope project|user] [-Purge] [-Yes]
```

- Confirmation is required. `uninstall` prints what it owns and what it will keep, then asks
  `Uninstall from <scopeRoot>? [y/N]`. A non-interactive run without `--yes` is refused with the
  same message as install and exits **2**; the install survives a refused uninstall
  (`tests/security/adversarial.test.mjs`).
- The wrapper scripts ask their own question before invoking the CLI and do **not** forward the
  yes flag to it (`uninstall.sh` consumes `--yes`/`-y` without passing it on; `uninstall.ps1` uses
  `-Yes` only for its own prompt). Their `--yes` therefore does not make removal unattended: use
  `node core/cli.mjs uninstall --yes` for that. On an interactive terminal the CLI asks a second
  time after the wrapper's prompt.
- At EOF — no `--yes` and no terminal — `uninstall.sh` prints `no answer on stdin (piped input?);
  nothing was changed. Re-run the CLI with --yes.` and exits **2**, again before the CLI runs. The
  wording differs from `install.sh`, which ends `Re-run with --yes.`; the two scripts were fixed
  separately.
- With no manifest at the scope root it prints `nothing to uninstall: no manifest at <scopeRoot>`
  and exits 0; a second run is safe and reports `removed: []`.
- Removal is manifest-driven and hash-checked:
  - `copy` and `write-if-absent` entries are deleted only when the content still matches the hash
    recorded at install.
  - `link` entries are deleted only while they are still symlinks.
  - `block` entries have the marked region removed; the file is deleted if the framework created it
    and nothing else remains.
  - `json-array-append` entries have the recorded value removed by deep equality; if the framework
    created the file and it becomes empty, the file is deleted, otherwise the unrelated keys stay.
  - `<scopeRoot>/.uaf/guard-rules.json` and `<scopeRoot>/.uaf/index.lock` are removed regardless of
    the manifest, empty directories below the scope root are pruned, and `.uaf/install.json` is
    deleted last.
- **Preserved:** anything whose content changed since install, printed with one of `already absent`,
  `content changed since install; left in place`, `target is no longer a symlink; left in place`,
  `managed block not found; left in place`, `not valid JSON; left in place`, or
  `value no longer present (edited by hand?); left in place`. Also preserved: `.uaf/config.json`
  (the chosen mode), `.uaf/index.json`, `.uaf/memory/`, and every file the framework never owned —
  including user content in `AGENTS.md` outside the managed block.
- `--purge` additionally deletes `.uaf/index.json`, `.uaf/memory`, and `.uaf/cache`. Without it,
  uninstall prints `kept .uaf/index.json and .uaf/memory (pass --purge to delete them)`.

## Version control

Install writes `.uaf/.gitignore` (only if absent) so machine-local state stays out of commits:

```gitignore
install.json
framework/
hooks/
guard-rules.json
index.json
index.lock
cache/
```

Deliberately still under version control: `.uaf/config.json` (the project's mode and agent
selection) and `.uaf/memory/` (notes recorded with `uaf remember`). A repository that tracks
`.uaf/config.json` therefore shares its mode across the team, and one that ignores it does not.

## Verifying the install

| Command | What it answers |
| --- | --- |
| `uaf doctor` | Node/platform, framework root, project root, resolved mode and its origin, per-agent detection with the signal, whether each adapter is runtime-verified or docs-derived, manifest size, index freshness, and any warnings. Read-only; exits 0. |
| `uaf status` | The manifest at the scope root and every drifted entry (`modified` / `missing`). Exits **1** when drift exists. |
| `uaf compat` | The capability matrix generated from `core/agents.mjs`, including which shared skill roots are used. |
| `uaf skills` | The framework's authored skills and commands with line/file counts, per-skill token cost, the always-on listing budget, and any frontmatter error. Exits **1** if any entry is invalid. Runs against the framework checkout, not the project. |
| The agent's own listing | Oh My Pi: `omp read skill://<name>` returns the installed `SKILL.md` and `/skill:<name>` activates it — verified in `tests/e2e/omp-discovery.test.mjs`. For the other three, use the agent's own skill picker (for example Codex's `/skills`); the CLI cannot verify agent-side indexing for them. |

Restart the agent session after installing so it re-scans the skill directories — `install` prints
this as its closing line.

## Confidence

Behaviour described here as verified is exercised by the repository's test suite:
`tests/integration/install.test.mjs` (plan versus applied targets, exact project-scope artifact set,
managed-block append/idempotency, Claude settings merge and invalid-JSON skip, Codex `hooks.json`
preservation, install idempotency, drift reporting, uninstall and `--purge` semantics, user-scope
isolation), `tests/integration/cli.test.mjs` (no writes outside the project, vendored runtime
self-containment, `status`/`doctor`/`compat`), and `tests/security/adversarial.test.mjs` (refusal
to install or uninstall without confirmation, refusal to install a skill with invalid frontmatter).

Documentation-derived, not executed here: the wrapper scripts' prompts and exit codes, the
per-agent user-scope paths for Claude Code, Codex, and OpenCode (their binaries are absent from the
development environment), the effect of the `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_CONFIG_DIR`,
`XDG_CONFIG_HOME`, `PI_CODING_AGENT_DIR`, and `OMP_PROFILE`/`PI_PROFILE` overrides, and the fact
that user scope writes no runtime or hooks (read from `core/emit.mjs`; the test suite asserts only
that user scope leaves the project untouched).

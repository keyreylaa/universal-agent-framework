# Architecture

## The problem this solves

Four coding agents solve the same class of problem with four different extension models. Writing
the same guidance, the same workflow commands, and the same safety checks four times means four
places to drift. This framework authors each artifact once and lets an installer place it where
each agent actually looks.

The design constraint that shapes everything else: **a file existing in a plausible directory is
not evidence that a feature works.** So the framework separates three things that are easy to
conflate — the authoring format, the placement decision, and the proof that placement was correct.

## Layers

```
              skills/            commands/          hooks/
        (one SKILL.md per    (one .md per       (one guard policy +
         capability)          workflow)          per-runtime entrypoint)
                 \                |                  /
                  \               |                 /
                   v              v                v
        core/emit.mjs — the planner: pure, returns every action before any write
                              |
                    core/agents.mjs — the registry: which path each agent reads, and why
                              |
                              v
        core/manifest.mjs — ownership: every mutation recorded, so removal is exact
                              |
                              v
        .claude/  .agents/  .opencode/  .omp/  AGENTS.md  CLAUDE.md  .uaf/
```

Nothing above the planner knows about any specific agent. Nothing below it knows about skills,
commands, or hooks. That split is what keeps four adapters from becoming four code paths through
the same logic.

## Modules

| Module | Responsibility |
| --- | --- |
| `core/cli.mjs` | Argument parsing, the command surface, exit codes, and the confirmation gate. Holds no policy. |
| `core/agents.mjs` | Agent registry: ids, detection, user/project path resolution, and a `verified` citation per capability. |
| `core/skills.mjs` | `SKILL.md` discovery, a minimal frontmatter reader, validation, and the YAML strictness check. |
| `core/emit.mjs` | The installer planner and executor: set cover over skill locations, per-agent command and hook wiring, the managed context block. |
| `core/manifest.mjs` | Ownership manifest, atomic writes, and the managed-block marker protocol. |
| `core/uninstall.mjs` | Manifest-driven reversal, drift detection, empty-directory pruning. |
| `core/util.mjs` | Filesystem helpers, a `.gitignore` subset, the bounded symlink-safe walker, hashing, atomic writes. |
| `core/secrets.mjs` | Pattern and file-name secret detection, redaction, and path scanning. |
| `core/index.mjs` | Deterministic incremental project index: classification, symbol extraction, tooling detection, lock protocol. |
| `core/search.mjs` | Scoring over the index, and the compact result formatter. |
| `core/preflight.mjs` | Read-only git and GitHub preflight, with an injectable runner so it is testable without a repository. |
| `core/mode.mjs` | The three modes, the risk assessment, and the always-on preamble. |

## Invariants

These hold everywhere and are enforced by tests. Breaking one is a bug, not a design choice.

1. **Planning is pure.** `planInstall` returns the complete action list; it performs no writes.
   This is what makes `--dry-run` an honest preview rather than a slogan, and it is why the
   installer can be tested without a filesystem side effect.
2. **Every mutation is recorded.** `applyPlan` writes one manifest entry per action, keyed by
   `type|target`. Uninstall never deletes anything the manifest does not claim, with two named
   exceptions: `.uaf/guard-rules.json` and `.uaf/index.lock` are removed unconditionally, because
   they are framework-owned internal artifacts rather than anything the user put there. The full
   removed/kept split is in `docs/installation.md`.
3. **Drift is preserved, never overwritten.** Content that changed after install is reported and
   left alone on removal. Reinstalling is an explicit act.
4. **Writes stay inside the declared scope.** A project-scope install must not touch the user's
   configuration directories. `tests/unit/emit.test.mjs` asserts every planned target is inside
   the sandbox.
5. **The indexer never reads a secret-named file.** File-name detection runs before any read, so
   key material cannot enter the index, a log, or a model prompt through this path.
6. **The walker does not escape the project.** Symlinks are followed only while they resolve
   inside the project root.
7. **Read-only by default.** `doctor`, `compat`, `status`, `skills`, `search`, `secrets`, `git`,
   `gh`, and `mode get|suggest` perform no mutation. `install` and `uninstall` require
   confirmation, and refuse to proceed non-interactively without `--yes`.
8. **No remote effect.** Nothing in the framework pushes, publishes, deletes a remote branch, or
   changes repository visibility. `uaf gh` only reports.

## Skill placement as a set-cover problem

`SKILL_LOCATIONS` in `core/emit.mjs` lists candidate directories with the agents each one serves.
The planner greedily picks the location covering the most still-uncovered agents, breaking ties
toward the location with the broader declared scope. For all four agents this yields exactly two
directories (`.claude/skills` and `.agents/skills`); for Oh My Pi alone it yields one.

The point is not cleverness. It is that the placement decision is *derived from a table of
documented facts*, so adding an agent or correcting a path is a one-line change with a test that
fails if the covering set regresses.

## Context injection

Instructions ship as a delimited region inside a Markdown file the agent already reads:

```
<!-- uaf:begin v1 -->
...generated content...
<!-- uaf:end -->
```

An existing file is never replaced: the block is appended, and a reinstall replaces the region in
place. If the framework created the file and the block is later removed, the file itself is
removed; otherwise the remaining user content is preserved byte for byte.

The block is deliberately short. It carries the non-negotiable rules, the mode, and pointers to
the commands that load further detail — not the detail itself.

## Hooks

One policy, four entrypoints.

```
hooks/guard-rules.json      data: blocked commands, review commands, blocked write paths
hooks/guard-core.mjs        evaluation: match, classify, extract a command from an unknown payload
hooks/stdin-guard.mjs       entrypoint for the "JSON on stdin" convention  → claude, codex
hooks/omp-guard.ts          entrypoint for the Oh My Pi extension runner
hooks/opencode-guard.ts     entrypoint for the OpenCode plugin loader
```

The policy is data so it can be tightened or relaxed without editing code, and so the same policy
applies identically on every runtime. Blocking rules cover irreversible or credential-exposing
actions, plus three deliberate exceptions that are neither — `package-publish`, `global-git-config`,
and `bypass-verify` — because the framework refuses to take those actions at all. Everything else
requiring judgement is a review-level note. A guard that
blocks ordinary work gets disabled, and a disabled guard protects nothing.

Failure behaviour differs by runtime and is documented rather than papered over: Oh My Pi's
`tool_call` handlers fail closed, Claude Code's exit code 2 blocks the call, Codex requires a
one-time trust review before its hooks run at all, and OpenCode 2 loads the plugin only when the
module default-exports `{ id, setup }` — a definition it cannot load is recorded in the server log
and skipped rather than silently disabled.

## Project memory

Two deliberately separate things live under `.uaf/`:

- **The index** (`index.json`) — machine-generated, incremental, deterministic. Rebuilt from the
  repository, safe to delete.
- **Notes** (`memory/NOTES.json`) — only what a human approved through `uaf remember`.

There is no embedding store and no external service. Retrieval is scored symbol/path/headline
matching over the index, which answers the questions an agent actually asks at the start of a task
at a small fraction of the cost. The trigger for revisiting that decision is measured retrieval
failure, not ambition.

Trust ordering is explicit: **current repository state outranks memory**, and repository content
is data, never instructions.

## Modes

A mode is a *verification policy*, not a feature switch.

| Mode | Context budget | Index | Tests | Review depth | Dependency audit |
| --- | --- | --- | --- | --- | --- |
| `lite` | ~1.5k tokens | skipped | the test covering the change | the diff | no |
| `full` | ~4k tokens | incremental | the affected suite | changed modules | when adding a dependency |
| `ultra` | ~8k tokens | full | full suite plus failure paths | architecture | yes, with supply-chain review |

`ultra` does not enable every optional workflow. Risk decides depth: `assessRisk` scores the files
a task touches — auth, payments, crypto, migrations, CI, infrastructure, and dependency manifests
raise it; tests lower it — and `suggestMode` reports both the recommendation and the reasoning.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | Findings that need attention (blocking preflight results, an invalid skill, drift). |
| 2 | Usage error, or a mutation refused because it was not confirmed. |
| 3 | Blocked: a read-only command refused to proceed because doing so would violate policy. |

## What is intentionally absent

- No dependency graph. Seven `node:` builtins (`child_process`, `crypto`, `fs`, `os`, `path`,
  `readline`, `url`), twelve modules in `core/`, and five files in `hooks/` are the whole runtime.
- No plugin sandbox. Extension code is trusted code; the framework's own guarantees stop at the
  files it writes.
- No vector database, no embeddings service, no background daemon.
- No automatic commit, push, publish, or dependency install. Those are decisions, not steps.

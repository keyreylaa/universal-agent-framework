# Development

How to work on the framework itself. For authoring user-facing skills and commands, see
`CONTRIBUTING.md`; this document covers the runtime in `core/` and the rules that keep it intact.

## Environment

- Node.js >= 20. `package.json` declares `"engines": { "node": ">=20" }` and `"type": "module"`.
- No runtime dependencies and no build step. The runtime uses `node:` builtins only; there is
  nothing to compile, bundle, or install before running or testing.
- `git`, and optionally one or more supported agents to exercise an adapter end to end.

```sh
npm test          # unit, integration, and security suites
npm run test:e2e  # end-to-end; skips itself when no agent is installed
```

Adding a dependency requires the justification described in
`skills/engineering/dependencies/SKILL.md` and should be raised as an issue first.

## Module map

One line per module, derived from each file's own header comment. `docs/architecture.md` describes
how they fit together.

| Module | Responsibility |
| --- | --- |
| `core/cli.mjs` | The command surface: argument parsing, the `COMMANDS` table, exit codes, the confirmation gate. Read-only by default, `--json` for machine-readable output, destructive operations require `--yes`, and no command ever publishes anything remotely. |
| `core/agents.mjs` | The agent capability registry: ids, detection, user/project path resolution, and a per-capability citation; every path is backed by a citation in `docs/research/<agent>.md`. |
| `core/emit.mjs` | Installation planner and executor. The planner is pure: it returns the complete list of mutations before anything touches disk, which is what makes `--dry-run` an honest preview. |
| `core/manifest.mjs` | The ownership manifest: every mutation the framework makes is recorded so uninstall can remove exactly what was created; a hand-edited entry is detected by hash and reported instead of deleted. |
| `core/uninstall.mjs` | Reversal of an install plan, driven entirely by the ownership manifest: nothing is deleted unless the manifest claims it and the on-disk content still matches what was written. |
| `core/index.mjs` | Deterministic, dependency-free project index: classification, symbol extraction, tooling detection, and the lock protocol. Deliberately not embeddings. |
| `core/search.mjs` | Retrieval over the project index. Deterministic scoring, no embeddings; symbol matches outrank path matches. |
| `core/secrets.mjs` | Secret detection used by git/GitHub preflight, the memory indexer, and the always-on hook. Pattern matching only: it never proves a repository is clean. |
| `core/preflight.mjs` | Git and GitHub preflight. Read-only by design: the framework reports, the human decides. |
| `core/mode.mjs` | Operational modes lite/full/ultra. A mode is a verification policy, not a feature switch. |
| `core/skills.mjs` | `SKILL.md` discovery, frontmatter parsing, and validation, intentionally stricter than any single agent's loader. |
| `core/util.mjs` | Shared filesystem, hashing, and output helpers; no third-party dependencies. |

## Adding an agent adapter

1. Read the corresponding `docs/research/<agent>.md` and confirm the behaviour is cited. If it is
   not documented there, add a citation before changing code.
2. Add or update the entry in `AGENTS` in `core/agents.mjs`. Each entry declares `id`, `label`,
   `bin` (binaries that indicate installation), `research`, `userRoot`, `projectRoots`, and the
   `skills` / `commands` / `context` / `hooks` / `permissions` capabilities, plus `notes` and
   `runtimeVerified`. Register function-valued fields (`user`, `context.user`, `hooks.dir`) where a
   path depends on the environment, and string project paths where it does not.
   `resolvePaths` derives the concrete set — `skillsProject`, `commandsProject`, `contextProject`,
   and so on — from the entry; a `null` project path means the agent does not support that
   capability at project scope. `AGENT_IDS` is derived from the registry, so adding an entry is
   enough for detection, `compat`, and the installer to see it.
3. Add the matching row to `docs/compatibility.md`, using the same runtime-verified / docs-derived
   distinction as the rest of the table.
4. Add or update a test in `tests/unit/emit.test.mjs`. The existing tests are the model: *every
   agent resolves a coherent path set* iterates `AGENT_IDS`, and *Codex has no project command
   directory, and that is reported rather than invented* asserts a documented absence rather than
   skipping it.
5. If the behaviour cannot be verified against a running agent, say so in the entry's `notes` and
   keep `runtimeVerified` as `false`. Do not claim compatibility because a file was written to a
   plausible directory.

`tests/e2e/omp-discovery.test.mjs` is the only test that exercises an agent's own discovery code,
and only Oh My Pi has a runtime-verified adapter — see `docs/compatibility.md`.

## Adding a skill or command

`CONTRIBUTING.md` is the source of truth for authoring: the skill directory layout and allowed
frontmatter keys, the one-line description requirement, frontmatter strictness, the command
frontmatter, and the `$ARGUMENTS` convention. Do not duplicate those rules here. After editing, run
`node core/cli.mjs skills` to validate and to see the always-on token cost.

## Invariants

These hold everywhere and are enforced by tests. Breaking one is a bug, not a design choice.

1. **The installer plan is pure.** `planInstall` returns the complete action list and performs no
   writes. Nothing is written until `applyPlan` runs. This is what makes `--dry-run` honest and the
   installer testable without a filesystem side effect.
2. **Every mutation is recorded in the manifest.** `applyPlan` writes one manifest entry per action,
   keyed by `type|target`. Uninstall never deletes anything the manifest does not claim.
3. **Uninstall preserves drift.** Content that changed after install is reported and left alone;
   reinstalling is an explicit act.
4. **Uninstall writes nothing outside the manifest plus explicit internal artifacts.** Beyond the
   manifest entries it only removes `.uaf/guard-rules.json` and `.uaf/index.lock`, prunes
   now-empty directories, and — only with `--purge` — deletes `.uaf/index.json`, `.uaf/memory`, and
   `.uaf/cache`.
5. **The indexer never reads a secret-named file.** File-name detection runs before any read, so key
   material cannot enter the index, a log, or a model prompt through that path.
6. **Read-only by default.** `doctor`, `compat`, `status`, `skills`, `search`, `secrets`, `git`,
   `gh`, and `mode get|suggest` perform no mutation. `install` and `uninstall` require confirmation
   and refuse to proceed non-interactively without `--yes`.
7. **No remote effect.** Nothing pushes, publishes, deletes a remote branch, or changes repository
   visibility. `uaf gh` only reports.

## Generated and install-produced files

There is no code generation in this repository: no build step, no transpile, no bundling. What a run
of `install` produces is a placement, not a source artifact:

- `.uaf/framework/` is a **copy** produced by `install`, not a source directory. It holds
  `.uaf/framework/core/`, `.uaf/framework/package.json`, and `.uaf/framework/templates/`, vendored
  so the shipped commands and hooks can run without a global install. Edit `core/`, not
  `.uaf/framework/core/`; a reinstall overwrites the copy.
- `.uaf/install.json` is the ownership manifest. `.uaf/guard-rules.json`, `.uaf/hooks/*`, and
  `.uaf/.gitignore` are written by install. `.uaf/config.json` and `.uaf/memory/` are kept under
  version control on purpose.
- The managed context region inside `AGENTS.md` / `CLAUDE.md` is delimited by
  `<!-- uaf:begin v1 -->` and `<!-- uaf:end -->` and is regenerated on reinstall; surrounding user
  content is preserved.

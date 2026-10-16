# Changelog

Notable changes to the universal agent framework. The format follows [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-10-16

Initial release. Only Oh My Pi could be exercised end to end in the development environment; the
Claude Code, Codex CLI, and OpenCode adapters are derived from official documentation, and
`uaf compat` reports that distinction rather than implying parity.

### Added

- **Runtime** (`core/`, Node.js >= 20, no dependencies, no build step): the `uaf` CLI with
  `doctor`, `compat`, `install`, `uninstall`, `status`, `index`, `search`, `remember`, `notes`,
  `prompt`, `skills`, `secrets`, `git`, `gh`, and `mode`.
- **Installer**: a pure planner plus a manifest-recording executor. Shared skill roots are chosen
  by set cover over the locations each agent documents, so all four agents are served by two
  directories. Supports `--dry-run`, `--link`, `--scope project|user`, and per-artifact opt-out.
- **Ownership manifest**: every mutation recorded by `type|target` with a content hash. Uninstall
  reverses exactly those entries, preserves anything edited by hand, and prunes directories it
  emptied. Non-interactive mutations require `--yes`.
- **Managed context block**: a delimited region appended to `AGENTS.md` and/or `CLAUDE.md`, with
  mode substitution, idempotent reinstall, and drift reporting.
- **Vendored runtime**: `install` copies the runtime into `.uaf/framework/` so the shipped
  commands work without a global install.
- **Project index**: deterministic, incremental, atomic, with a lock protocol for interrupted
  runs, bounded symbol extraction for 16 languages, tooling and command detection, and
  secret-file exclusion **before** any read.
- **Retrieval**: symbol-first scoring over the index with kind and language filters and a bounded
  output budget. No embeddings and no external service.
- **Secret detection**: 16 credential patterns plus file-name conventions (`*.env`, `*.key`,
  `.aws/credentials`, and similar), placeholder false-positive suppression, redacted previews, and
  a documented limitation that a clean scan proves nothing.
- **Git preflight**: branch and status inspection, local-vs-global identity reporting that never
  invents an identity, staged-blob secret scanning, artifact and `.gitignore` checks.
- **GitHub preflight**: remote and repository verification, divergence detection, outgoing-commit
  secret scanning, real CI run status, inactive workflow detection, and explicit reporting that a
  workflow file is not evidence CI works.
- **Hook guard**: one JSON policy, four native entrypoints (stdin JSON for Claude Code and Codex,
  an Oh My Pi extension, an OpenCode plugin). Blocks only irreversible or credential-exposing
  commands; everything judgement-dependent is a review note. Reason-level details are in
  `docs/security.md`.
- **Three modes**: `lite`, `full`, `ultra`, plus risk-based `uaf mode suggest` scoring the files a
  task touches rather than the size of the repository.
- **Skills**: 13 authored skills — code quality, dependency decisions, language references for
  TypeScript, Python, Go, Rust, Java, C++, SQL, and shell, root-cause debugging, testing strategy,
  security review, code review, Git commits, GitHub publishing, documentation, project memory,
  Discord bot development, and data extraction.
- **Commands**: 10 workflow commands using `$ARGUMENTS`, the only placeholder all four agents
  understand.
- **Documentation**: architecture, compatibility matrix, installation, skills, commands, memory,
  security, testing, development, troubleshooting, and per-agent research notes with citations.
- **Bootstrap installers**: `scripts/get.sh` (`curl … | sh -s -- …`) and `scripts/get.ps1` fetch the
  framework into a cache and hand over to the normal installer, with no clone required. Configurable
  through `UAF_REF`, `UAF_SOURCE`, `UAF_HOME`, and `UAF_TARGET`; works without `git` via a `codeload`
  tarball; refuses to target its own cache.
- **Bootstrapping**: `get.sh` checks for `curl`, `tar`, and `gzip` before an archive fetch and names
  the missing one, instead of surfacing `tar`'s truncated-pipe error. The no-`git` `codeload`
  fallback was exercised against the live repository with a minimal `PATH`.
- **Portable test entry point**: `tests/run.mjs` expands the suite directories and passes explicit
  file paths to `node --test`. The previous script relied on glob expansion, which only arrived in
  Node 21 — on Node 20 the quoted pattern became one literal path, so the run reported nothing
  found and looked like a pass.
- **Pipe-safe output**: the CLI now exits through `process.exitCode` instead of `process.exit()`.
  Piped stdout is written asynchronously, so exiting discarded whatever had not flushed. The pipe
  capacity is platform-dependent, and these figures are observations rather than documented
  constants: macOS CI cut `uaf compat --json` mid-string at byte 8154 (8188 in a second case), and
  on Linux a 392,471-byte output arrived as 328,896 bytes — 63,575 bytes lost. A regression test
  asserts that pipe output and file output have identical lengths, and fails without the fix
  (328,896 bytes versus 392,471). The hook entrypoint had the same exit in its blocking path,
  where a dropped payload would hide the block itself; it sets `process.exitCode = 2` for the same
  reason. The guard's decision JSON is 293 bytes as measured here, so that half is hardening rather
  than a reproduced truncation.
- **Tests**: unit, integration, security, and end-to-end suites. The end-to-end suite installs
  the skill set and asserts that Oh My Pi's own resolver returns an installed skill, and that
  duplicate copies across two shared roots collapse instead of being namespaced.

### Fixed during development

Recorded because each was a real defect found by running the code against a real agent, not by
reading it:

- Command frontmatter used unquoted `argument-hint` values containing flow brackets. Oh My Pi's
  YAML parser rejected the files at startup. Fixed by quoting the values, and by adding a
  strictness check (`frontmatterIssues`) that fails the build on ambiguous frontmatter, since the
  framework's own reader is deliberately forgiving and had masked the problem.
- Two skill `description` values contained an unquoted `": "` sequence, which YAML reads as a
  nested mapping. Fixed, and now caught by the same check.
- Directory-ignore patterns ending in `/**` compiled to a regex that matched nothing, because a
  trailing `**` collapsed to an optional group instead of "everything below".
- `dir/` ignore patterns did not match descendants of the directory.
- The indexer recorded a secret-skip for `.env.local` but not for the equally common
  `something.env`, leaving a credential-bearing file eligible for indexing.
- The indexer's file walk followed symlinks out of the project, so a committed link to `/etc`
  could pull outside files into the index.
- `--force` reported byte-identical files as changed.
- `stats.indexed` was declared and never set, so `uaf index` reported a misleading count.
- The GitHub preflight overwrote the repository slug with the parsed repository metadata, which
  silently skipped the CI checks.
- Risk scoring matched only files whose *basename* began with `auth`/`payment`/`migration`, so
  files inside `src/auth/` or `db/migrations/` were not treated as high risk.
- The context-block action recorded `created` after the write rather than before, so uninstall
  left an otherwise-empty file behind.
- Uninstall printed a human message instead of JSON when no manifest was present.
- Uninstall left the agent directory tree behind as empty folders after removing their contents.
- `scripts/install.sh`, run from the framework checkout, installed into the checkout itself. The
  wrappers now take a target directory (`-C`/`--cwd`, `-CwdPath`) and the CLI refuses to install
  into its own checkout unless `--self` is passed.
- Config keys `agents` and `index.exclude` were documented by the loader but never read; both are
  now honoured.
- `uaf prompt` printed the context template without substituting the mode placeholders.
- Two test fixtures contained credential-shaped literals, so the repository failed its own secret
  scan. Both are now assembled at runtime.
- The first CI run failed in three distinct ways that local Linux runs could not surface, all in
  the test harness rather than the product: temp directories were compared un-canonicalised, so
  macOS's `/var` symlink made install and uninstall appear to disagree; the sandbox overrode
  `HOME` only, while Node reads `USERPROFILE` on Windows and the per-agent override variables
  bypass the home directory entirely; and expectations hard-coded POSIX path separators, which
  Windows does not produce. The harness now returns canonicalised sandbox paths, sets every
  variable `core/agents.mjs` consults, and builds expectations with `path.resolve`/`path.join`.
  One wrapper test that invoked a `.sh` file directly is now POSIX-only and runs via `sh`.
- The first CI run failed on every platform: a test asserted that each agent's user path sits under
  the `home` it passed in, ignoring the documented `XDG_CONFIG_HOME` override that GitHub runners
  set. Reproduced locally with `XDG_CONFIG_HOME` set, then fixed, and two tests now pin the
  override precedence. `actions/checkout` and `actions/setup-node` moved to v5, since runners no
  longer provide the Node 20 runtime those actions targeted.

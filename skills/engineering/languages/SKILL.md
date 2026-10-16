---
name: languages
description: Detects which language and toolchain a repository actually uses from its manifests, lockfiles, and CI config, then loads exactly one matching reference file covering that language's tooling, error handling, concurrency, testing, and anti-patterns. Use before writing or reviewing code in a repository whose language, build tool, test runner, or formatter has not already been confirmed in this session, and when a change spans more than one language.
license: MIT
metadata:
  activation: contextual
  agents: claude, codex, opencode, omp
---

## Purpose

Language guidance is kept in per-language reference files instead of dozens of near-empty skills, so coverage can grow without bloating every task's context. This skill detects the repository's real language and toolchain, matches it, and then loads only the reference that applies. Detection comes first: loading a reference before knowing the toolchain produces advice for the wrong runtime.

## When this activates

Activate when:
- You are about to write, refactor, or review source files in a repository whose language or tooling you have not confirmed in this session.
- A task names a language but the repository may target a different version, module system, or build tool.
- A change spans more than one language (a service plus its migrations, a C++ core plus a shell harness) and you need the guidance for the second language.

Do not activate for documentation-only, config-only, or data-only changes, and do not re-run detection inside the same session once the toolchain for the files in question is already established. Do not load a reference just because the repository contains that language somewhere.

## Prerequisites

- Read access to the repository root and to each workspace or package root inside it.
- Read access to the directory containing this `SKILL.md`, so that `references/<language>.md` can be resolved relative to it.
- The repository's own scripts and CI config, which define the commands that count as correct.
- If the skill directory is not resolvable in the current agent, say so and fall back to the repository's conventions instead of guessing a path.

## Procedure

1. Enumerate the candidate manifests at the repository root and at each workspace root. The files that matter:
   - JavaScript/TypeScript: `package.json` plus its lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`/`bun.lockb`), `tsconfig.json`.
   - Python: `pyproject.toml`, `requirements.txt`/`requirements-*.txt`, `uv.lock`, `poetry.lock`, `Pipfile`, `setup.cfg`, `setup.py`, `.python-version`.
   - Go: `go.mod`, `go.sum`, `vendor/`.
   - Rust: `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, workspace members.
   - Java/JVM: `pom.xml`, `build.gradle`/`build.gradle.kts`, `settings.gradle`, `gradlew`.
   - Ruby: `Gemfile`, `Gemfile.lock`, `*.gemspec`.
   - PHP: `composer.json`, `composer.lock`.
2. Read each manifest you found and extract: language or runtime version constraint, package/build tool, declared scripts or tasks, test framework, linter and formatter.
3. Confirm the toolchain from secondary evidence instead of assuming: which lockfile exists, which wrapper script exists, which versions the CI workflow installs, which dotfiles are present (`.nvmrc`, `.python-version`, `rust-toolchain.toml`, `toolchains` config, `.clang-format`).
4. Determine the language of the specific files you are about to change, which may differ from the repository's dominant language in a polyglot or monorepo layout. A migration directory, a build script, or a fixture may be in a second language.
5. Match the existing toolchain. Use the commands the manifest scripts or CI already run; do not introduce a second formatter, linter, test runner, or package manager for the language you are editing.
6. Load exactly one reference: resolve `references/<language>.md` relative to the directory containing this `SKILL.md` and read it. In the framework source the same file is `skills/engineering/languages/references/<language>.md`. Available references: `typescript.md`, `python.md`, `go.md`, `rust.md`, `sql.md`, `shell.md`, `cpp.md`, `java.md`.
7. Load a second reference only when the change genuinely spans a second language, and load it when you reach that part of the work rather than up front.
8. If the detected language has no reference file, follow the repository's own conventions by reading existing code of the same kind, and consult that language's official documentation for anything the codebase does not demonstrate. Do not invent conventions, flags, or APIs. State plainly that the language is not covered by this skill.
9. When the reference and the repository disagree, the repository wins — but note the divergence so the user can decide whether it is deliberate.
10. Report the detection result in one line: language, version constraint, package manager, test command. Downstream verification uses that test command.

Never load all reference files at once. Bulk loading dilutes the guidance that applies, wastes context, and makes it easy to apply another language's idioms to the wrong runtime.

## Verification

- Run the exact test command the manifest or CI declares for the package you touched, not a global default.
- Run the repository's declared formatter and linter in check mode if the project configures them; do not reformat files you did not change.
- Confirm the version you assumed matches the manifest constraint and the CI-installed version; a mismatch invalidates guidance that depends on language version.
- If CI pins a specific build command, confirm the change would pass that command, not a locally convenient equivalent.

## Failure behavior

- No manifest found: infer from file extensions and shebangs, state the inference as an assumption, and ask before adding any new tooling.
- Multiple package managers for one language (for example both a lockfile and a conflicting one): use the one the CI installs and report the ambiguity instead of resolving it silently.
- Reference file missing or unreadable: continue with the repository's conventions and official documentation, and say which reference could not be loaded.
- Manifest parses but the version constraint is a wide range: target the lowest version the range allows unless CI installs a pinned version.
- Generated code, vendored code, or build output: match the generator's conventions, not the surrounding language reference; do not hand-edit generated files.

## Anti-patterns

Loading every reference to "be safe".
```
read references/typescript.md
read references/python.md
read references/go.md   <- only one language is in this repo
```
The improved flow detects first, then loads the single matching file. The saved context is spent on the actual change.

Assuming the repository root's language is the language of the change.
```
# Repo is a Node service, but the change is in scripts/deploy.sh
# and in migrations/0007_add_index.sql
```
A polyglot repository needs per-path detection. The shell script follows the shell conventions; the migration follows the database conventions.

Introducing a second toolchain.
```sh
# CI already runs pytest; the new module ships with its own unittest runner
python -m unittest tests/test_new_module.py
```
Match the existing runner so results are comparable and CI covers the new code. Adding a parallel runner doubles the maintenance without adding coverage.

Treating the language reference as a specification. A reference describes conventions that hold most of the time; the repository is the authority on its own version, style, and error-handling layer. When they conflict, follow the repository and report the difference.

## Security

- Building an unfamiliar repository can execute code from it: package lifecycle hooks, Gradle and Maven plugins, `build.rs`, and CMake configure steps all run with your credentials. Get approval before building an untrusted checkout.
- Keep secrets that appear in language-specific config (`.env`, `settings.xml`, `gradle.properties`, `local.properties`) out of the transcript and out of diffs.
- Do not relax a lockfile, integrity check, or verification step to make a language tool run; report the failure instead.
- When a reference suggests running a tool that fetches dependencies, apply the dependency skill's approval rule first.

## Token notes

- Grep the manifest for the keys you need instead of reading the whole file; large lockfiles should be inspected by diff, not by reading.
- Load one reference file per language, at the moment it becomes relevant.
- Read only the section of a reference that matches the work at hand; the anti-patterns section is not required reading before every edit.
- Summarize detection as a single line rather than pasting manifest contents into context.

## Known limitations

- Manifest-based detection cannot identify frameworks reliably (a `package.json` does not reveal whether the code is React, a CLI, or a server); inspect imports for that.
- Vendored or copied source may follow conventions from a different upstream version.
- Monorepos can have several toolchains per language; detection done once at the root can be wrong for a nested package.
- The reference set does not cover every language; anything outside it falls back to repository conventions and official documentation.
- Reference guidance cannot pin down version-specific behavior beyond the constraints stated; confirm against the installed runtime when it matters.

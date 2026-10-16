---
name: readme
description: Decide which documentation files a project actually needs and write or audit a README whose claims match the implementation, covering scope, distribution, legal need, and real user need; use when creating a README, choosing which docs to write, or reviewing docs for unverified commands, fake badges, empty claims, or marketing exaggeration.
license: MIT
metadata:
  activation: contextual
  agents: claude, codex, opencode, omp
---

## Purpose

Decide which documents a repository actually needs, and produce a README whose every claim can be traced to the code, the manifest, or a verified endpoint. Most repositories need fewer documents than their authors assume, and accuracy matters more than volume. Apply this skill before creating documentation and when auditing documentation that already exists.

## When this activates

Triggers:

- The user asks for a README, installation guide, architecture doc, configuration reference, troubleshooting section, changelog, contributing guide, or code of conduct.
- The user asks which documentation a repository should have, or asks for a docs review or audit.
- You are editing a doc that contains commands, badges, install steps, compatibility claims, or feature lists that must match the implementation.
- A change alters setup, configuration, the public API, or compatibility, so existing docs are now wrong.

Does not trigger for:

- Editing code comments or inline docstrings only.
- Answering a direct question about a file the user named; read the file.
- Generating release notes verbatim from a git range the user supplied.

## Prerequisites

- Read access to the repository: the manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, and so on), the test-runner config, CI config, the license file, and the directory layout.
- The project's own toolchain to run documented commands. When a runtime, service, or network is unavailable, mark the affected example `untested` instead of guessing its output.
- Network access only to confirm badge endpoints; writing itself needs none.

## Procedure

1. Establish what the project is and how it is distributed. Read the manifest, license, CI workflows, and layout. Distribution decides the legal and operational docs: a published library needs installation, compatibility, and API docs; an application needs configuration and deployment; a single-file internal script needs a short usage section and nothing more.
2. Decide which documents are justified, treating each as a separate yes/no with a stated reason:
   - README — almost always yes; it is the entry point.
   - Installation and development setup — when running the project is not obvious from the manifest.
   - Configuration reference — when the project reads user-supplied configuration.
   - Usage examples — when the public surface is more than one command or call.
   - API docs or CLI reference — for libraries with a public API, or CLIs with more than a couple of flags.
   - Architecture — when a newcomer must understand several interacting components.
   - Testing docs — when the test command is not the manifest default, or needs fixtures, services, or environment.
   - Deployment and migration — for services, and for anything with a persistent data format that changes.
   - Troubleshooting — when there are known failure modes worth naming.
   - Security policy, contributing, code of conduct — when the project accepts external reports or contributions, or a host requires them.
   - Changelog — when the project makes versioned releases; otherwise git history is the changelog.
   - License — whenever the code is shared or published under terms.
   Not every repository needs every document. Writing architecture, migration, or code-of-conduct docs for a one-file utility adds maintenance cost and dilutes the documents that matter. Omit by decision, not by oversight.
3. Follow the README standard for any README you write or edit. Include, in roughly this order, and omit what genuinely does not apply:
   - Project name and a one-line tagline.
   - Purpose and value: the problem solved and who it is for, in two to four sentences.
   - Feature summary: what exists today.
   - Installation: exact commands including prerequisites.
   - Quick-start: the shortest path from install to a working result.
   - Usage examples: realistic, copy-pasteable, covering the common cases.
   - Configuration reference: keys, defaults, and their meaning.
   - Compatibility requirements: runtime versions, platforms, and dependencies that constrain use.
   - Testing instructions: how to run the tests.
   - Security considerations: what the user must do or be careful about.
   - Contributing: how to propose changes.
   - License: matching the `LICENSE` file.
   - Badges only when each badge links to a real, working endpoint (CI run, package registry, coverage service).
4. Keep the forbidden list out of every README and docs file. Remove these from drafts and from existing files:
   - Emoji spam.
   - Marketing exaggeration ("the fastest", "world-class") with nothing to measure it against.
   - Empty feature claims ("blazing fast", "enterprise-grade") that define nothing.
   - Repeated explanations of the same thing in multiple sections.
   - Fake testimonials or invented statistics.
   - Unverified badges.
   - Decorative sections with no content (empty Roadmap, FAQ, or Contributors stubs).
   - Any claim of production readiness without evidence (real deployments, users, or explicit user confirmation).
5. Verify every command and code example where practical. Run the install, quick-start, and test commands in the target environment; execute library examples or state that you could not. Label any example you did not execute as `untested` in the doc or in your report; never present an unrun command as verified.
6. Cross-check the docs against the implementation: defaults, flag names, config keys, environment variables, file paths, and version constraints must match the code and manifest. When doc and code disagree, the code wins; fix the doc.
7. Replace every claim with evidence or remove it: link the CI workflow for a passing badge, the test that proves a behavior, the license file for the license name.
8. Extend sections rather than reordering them. Stable structure keeps existing links and readers' expectations valid.

## Verification

- Run the documented install, quick-start, and test commands in a clean checkout and confirm they behave as written.
- Run the repository's own docs tooling if it exists (markdown link checker, linter, prose linter); otherwise check internal links and code fences by hand.
- Open every badge URL, or confirm its CI or registry endpoint exists; delete any badge whose status you cannot confirm.
- Diff documented configuration keys and CLI flags against the code (search the parser or manifest). Every documented item must exist, and every user-facing item should be documented.
- Confirm the license named in the README is the same as the one in `LICENSE`.

## Failure behavior

- If a documented command fails when run, do not rewrite the doc to match a broken command. Report the failure: either the command is wrong or the code is broken, and the user decides.
- If a toolchain or network is unavailable, mark the affected examples `untested` and name which ones; never invent expected output.
- If a badge endpoint is unreachable, remove the badge or mark it unverified; never leave a badge implying a status you could not confirm.
- If the user asks for a document the analysis found unnecessary, state the trade-off once, briefly, then write what they asked. Do not refuse.
- If you cannot tell whether a claim is true, remove the claim.

## Anti-patterns

Badge with no real endpoint:

```md
![Build](https://img.shields.io/badge/build-passing-brightgreen)
```

This asserts a status that nothing produces, so it can never go stale in a way the reader notices. Improved, linking a workflow that must exist:

```md
[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)
```

The improved version is falsifiable: if `.github/workflows/ci.yml` is absent, the badge is removed.

Unverified install instructions:

```text
Install section, written but never executed
npm install -g mytool   # copied from a blog post, never run
```

Improved: run it in a clean shell, then document the observed result, or mark the section `(untested)`.

Empty claim versus a measurable one:

```md
- Blazing-fast, production-ready
```

```md
- Single-pass parser; handles 50 MB inputs (see benchmarks/parse.md)
```

The second tells an evaluator what to check and where the evidence lives.

## Security

- Never paste real tokens, internal hostnames, or private URLs into examples; use obvious placeholders.
- Before committing docs containing sample configuration or `.env` snippets, scan the changed files for credentials and confirm no secret was copied into an example.
- Do not document a way to disable a security control (auth bypass, debug endpoint) without an explicit scope warning next to it.

## Token notes

- Read the section range you are editing, not the whole README or docs tree.
- Use focused search over the repository to locate the source of a documented flag, default, or path instead of reading whole files.
- When auditing many files, report findings as a table of path, claim, and verdict rather than quoting the files.

## Known limitations

- An audit covers only what this checkout can reach; behavior defined in hosted services or private infrastructure cannot be verified here.
- A reachable badge URL proves the endpoint exists, not that the reported status is current.
- "Matches the implementation" is checked for the files present; generated or vendored code may diverge from the docs without the repo noticing.
- Tone and language judgments are subjective and are not covered by the verification steps.

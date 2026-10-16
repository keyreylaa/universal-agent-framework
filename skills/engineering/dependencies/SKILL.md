---
name: dependencies
description: Runs a three-outcome decision procedure (no dependency, reuse an existing dependency, or add a vetted package) before any third-party code enters the project, and lists the evidence required to justify each outcome. Use when a task implies installing a package, when a capability might already exist in the repo or the standard library, when a candidate package must be vetted for maintenance, license, footprint, vulnerabilities, or runtime compatibility, or when reviewing a dependency or lockfile change.
license: MIT
metadata:
  activation: contextual
  agents: claude, codex, opencode, omp
---

## Purpose

Every added package is a permanent maintenance obligation: upgrades, advisories, license review, build time, and transitive risk. This skill forces a decision before that obligation is taken, and gives exactly three allowed outcomes: NO DEPENDENCY, REUSE, or ADD DEPENDENCY. It also defines the evidence required to justify ADD DEPENDENCY and the approvals required before anything is installed.

## When this activates

Activate when:
- A task hints at installing a package ("just use a library for this", "add a retry helper", "parse CSV") or names an ecosystem install of any kind.
- You are about to write code for a capability that libraries commonly provide (date/time math, retries, argument parsing, HTTP clients, validation, scheduling).
- You are reviewing a manifest/lockfile diff that adds, bumps, or removes a package.
- A build fails because a dependency is missing, and the temptation is to install one.

Do not activate when the user has already named the exact package and explicitly approved installing it — in that case only the authorization and recording rules below apply. Do not activate for documentation-only or config-only changes that touch no manifests.

## Prerequisites

- Read access to the project's manifests and lockfiles, e.g. `package.json` plus `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`, `pyproject.toml`/`requirements.txt`/`uv.lock`, `go.mod`/`go.sum`, `Cargo.toml`/`Cargo.lock`, `pom.xml`/`build.gradle`, `Gemfile`/`Gemfile.lock`, `composer.json`/`composer.lock`.
- Registry and advisory metadata for candidate packages (maintenance, license, transitive deps, known vulnerabilities). If the network is unavailable, say so and mark the verdict unverified instead of guessing.
- Whatever audit command the project already uses, discoverable from manifest scripts or CI config.
- Explicit user approval before installing anything. Absent approval, stop at the verdict and hand it back.

## Procedure

1. State the required capability in one sentence, including constraints: input size, throughput, threading, platform support, offline behavior.
2. Search the repository for that capability first. Grep for the domain term, read the manifests for packages already present, and check whether a helper already exists but is unused.
3. Check the standard library and runtime. If the platform ships the behavior safely (date formatting, UUIDs, JSON, hashing, HTTP, globbing, temp files), that is NO DEPENDENCY.
4. Outcome NO DEPENDENCY: implement the smallest correct version, scoped to the need, with tests. Do not generalize into a mini-framework.
5. Outcome REUSE: pick an existing dependency only when it is already in the manifest and lockfile, is used elsewhere in the project, is at a version in range, and actually exposes the needed API. Evidence to collect: manifest entry, lockfile entry, at least one existing call site, and the export/signature you will call. Verify the API against the installed source or its type definitions, not from memory.
6. Outcome ADD DEPENDENCY: allowed only when the capability is substantial, peripheral to the product's core value, and a maintained package exists. Collect and record this evidence for the candidate:
   - Maintenance signal: date of the last release, recent commit activity, whether the repository is archived or marked deprecated, number of distinct maintainers, responsiveness to issues and security reports.
   - License: the exact identifier from the package metadata or `LICENSE` file, and compatibility with the project's license and distribution model.
   - Transitive footprint: how many packages it pulls in, using the ecosystem's dependency-tree command or by diffing the lockfile after a dry run.
   - Known vulnerabilities: query the ecosystem's advisory database, or the project's configured audit command, against the version you would pin.
   - Runtime compatibility: required language/runtime version versus the project's pinned version, supported OS and CPU architectures, module system (ESM/CJS, Python version, Rust edition, JDK release), and any platform-specific native build.
   - Install cost: native compilation, binaries or model files downloaded at install time, private registry or credentials, added CI time.
   - Bundle or runtime size where relevant: frontend bundle impact, container image growth, memory footprint for a long-running service.
   - Lifecycle scripts: any pre-install/post-install style hook in the package that executes code during installation.
7. Record the verdict in one short block: outcome, one-line reason, the evidence above, and the alternatives considered (other packages, vendoring, in-house implementation) with why each was rejected.
8. Ask for explicit user approval for the install, naming the package, the version, and the install command. Approval for one package is not approval for others, and it is not approval to run lifecycle scripts.
9. After approval, install with the package manager the lockfile already implies, pin per repository convention, and commit the manifest and lockfile together.
10. Persist the rationale with `uaf remember "<package> added for <capability>; alternatives <X>, <Y> rejected because <reason>"`, and add a code comment at the call site only where the choice is non-obvious.

Rules that override convenience:
- Never hand-roll cryptography, authentication protocols, or parsers to avoid a dependency. Use a vetted, maintained implementation instead.
- Never install a package for something the runtime already does safely.
- No install, and no execution of package lifecycle scripts, without explicit user approval.

## Verification

- Run the project's own declared checks from its manifests, Makefile, or CI config (its test, lint, typecheck, and audit scripts) rather than ad-hoc commands.
- Confirm the lockfile diff contains only the intended package and its resolved transitive set; unexpected entries mean the wrong resolution or a scope creep.
- Confirm the changed code path runs, and that any NO DEPENDENCY path you replaced is actually gone rather than duplicated.
- Re-run the audit and confirm no new advisory is introduced for the pinned version.
- Report the verdict block, not just "it works".

## Failure behavior

- Registry or advisory database unreachable: do not install. Mark maintenance/license/integrity checks unverified, prefer NO DEPENDENCY or REUSE, and report the gap.
- License missing or ambiguous: treat as incompatible until the user resolves it.
- Audit command absent: say the package's vulnerability status is unverified; do not claim it is safe.
- Version resolution conflict or out-of-range peer requirement: do not force the resolver. Report the conflict and offer alternatives.
- Candidate needs a heavy native toolchain in CI, or its transitive set is disproportionate to the benefit: escalate the trade-off instead of deciding silently.
- Lockfile churn unrelated to the change: stop and report; it usually means the wrong package manager or an unpinned range.

## Anti-patterns

Hand-rolling security-sensitive code to dodge a dependency.
```ts
// Poor: timing-unsafe comparison, no expiry check, algorithm taken from the token
function verifyToken(token: string, secret: string): boolean {
  const [h, p, sig] = token.split(".");
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return sig === expected;
}
```
The improved version uses a maintained library that validates the algorithm against an allowlist, enforces `exp`/`nbf`, and compares in constant time. Auth and crypto are exactly where an invented implementation loses to a maintained one.

Installing a package for a language primitive.
```js
import leftPad from "left-pad";
const id = leftPad(String(n), 8, "0");
```
```js
const id = String(n).padStart(8, "0");
```
Same output, one less supply-chain edge, no lockfile change.

Trusting a one-line import without checking what it drags in. A single named import from a kitchen-sink utility library can pull hundreds of modules or a native build into the bundle or image. If you must depend, depend on the smallest maintained unit, and check the dependency tree.

Installing before evaluating.
```sh
# Poor: the decision is made by the install
npm install some-date-lib && git add -A
```
The improved flow produces a verdict first, gets approval, then installs and commits only the manifest and lockfile.

Ignoring install-time code execution. Package lifecycle hooks run arbitrary code during installation, with the developer's credentials and network. Read them before approving, or install with lifecycle scripts disabled if the package manager supports that, then verify the package still works.

## Security

- Commit the lockfile and rely on its integrity hashes; never resolve dependencies from an unreviewed registry or a URL in a manifest.
- Confirm the package name, scope, and publisher against the upstream repository to avoid typosquats; check the publish history for a recently transferred package.
- Treat install-time lifecycle scripts as code execution subject to approval, not a formality.
- Evaluate advisories for the version you are pinning, not for the latest release.
- Keep registry credentials and tokens out of committed files and out of the transcript.

## Token notes

- Read the dependency tree from the lockfile and the manifest, not by walking installed package sources.
- Ask the audit tool for a summary instead of pasting advisory JSON into context.
- Read only the exported signature and the relevant documentation section for the API you call; skip READMEs and changelogs.
- Keep the verdict block to a few lines and reuse it instead of re-deriving the reasoning later.

## Known limitations

- Registry metadata lags reality; a healthy-looking package can be unmaintained by the time you pick it up.
- Advisory databases differ in coverage, so absence of advisories is not evidence of safety.
- License compatibility for unusual or custom licenses cannot be decided mechanically here.
- Bundle and runtime size estimates vary with bundler, tree-shaking, and flags; treat them as approximations and state the measurement method.
- Offline or air-gapped environments make maintenance, license, and advisory checks unverifiable; the verdict then rests on unverified data and must say so.

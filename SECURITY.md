# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Report privately — do not open a public issue for a vulnerability. Use GitHub's private
vulnerability reporting for this repository, or contact the maintainers listed in the repository
metadata.

Include:

- the affected command, file, or adapter;
- the observed behaviour and why it is a security problem;
- the smallest reproduction you have;
- the affected version and platform;
- whether you believe any credential was exposed, and if so, whether it was rotated.

**Do not include real credentials, tokens, private keys, or customer data in a report.** Redact
them. If a real credential must be referenced, describe its shape and location instead.

## What to expect

- Acknowledgement within a few days.
- An assessment of severity and scope, including whether the issue is in this framework or in an
  agent it configures.
- A fix, or a clear statement that the behaviour is by design with the reasoning, plus a
  documentation change if the risk was not previously stated.
- Credit in the changelog unless you ask otherwise.

## Scope

In scope:

- the runtime in `core/`, including path resolution, the installer, the ownership manifest, and
  uninstall;
- the hook guard policy and its entrypoints;
- the project indexer, including its exclusion and secret-handling behaviour;
- anything that writes outside the declared install scope, or deletes content the manifest does
  not own;
- the shipped skills and commands, where they give unsafe or wrong guidance;
- the documentation, where it overstates a guarantee.

Out of scope:

- vulnerabilities in Claude Code, Codex CLI, OpenCode, or Oh My Pi themselves — report those to
  the respective vendor;
- the fact that a pattern-based credential scanner does not detect every credential. This is
  documented in `docs/security.md` and is a known limitation, not a vulnerability;
- the hook guard being bypassable by obfuscation. It is a guard against the obvious catastrophic
  case and is documented as such;
- the behaviour of code you install as an extension. Extension code is trusted code.

## Standing commitments

- No credential is read, stored, or transmitted by the framework, and no command of its own makes
  a network request.
- Project-scope operations never write to user configuration directories.
- Nothing is pushed, published, released, or deleted remotely. `uaf gh` is read-only.
- Global Git configuration is never modified, and `git config --global` is on the blocked list.
- Uninstall removes only what the ownership manifest claims and only when the content is
  unchanged; hand-edited files are preserved and reported.
- A clean `uaf secrets` run is never described as proof of security.

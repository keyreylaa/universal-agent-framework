# Security model

## What this framework protects against

1. **Credential leakage into a commit or a push.** `uaf git --commit` and `uaf gh` scan the exact
   content that would leave the machine — the staged index blobs and the outgoing commit range —
   not the working tree, so a value already removed from disk is still caught.
2. **Credential leakage into an agent's context.** The indexer tests a file's *name* before
   reading it, so `.env`, `*.key`, `id_rsa`, and any `*.env` file never enter `.uaf/index.json`,
   a memory note, or a model prompt through this path.
3. **Credential leakage into memory.** `uaf remember` refuses to record a note whose text matches
   a high-severity pattern, and exits 3 rather than storing it.
4. **Irreversible destructive commands.** A shared hook policy blocks recursive force-delete of
   `/` or `$HOME`, unquoted-variable recursive deletes, `mkfs`, `dd of=/dev/…`, fork bombs,
   piping a download into a shell, world-writable permissions on `/`, force-push to a shared
   branch, remote repository deletion, package publishing, global Git config changes, and history
   rewriting.
5. **Credential exfiltration through the shell.** Reading or uploading `.env`, private keys,
   `.aws/credentials`, `.npmrc`, `.netrc`, or `.git-credentials` is blocked, as is bypassing
   verification hooks with `--no-verify`.
6. **Escaping the project boundary.** The walker follows symlinks only while they resolve inside
   the project root, so a committed symlink to `/etc` cannot pull outside files into the index.
7. **Overwriting a user's configuration.** Settings files are merged key by key, or refused with
   an explanation if they are not valid JSON. A pre-existing Codex `hooks.json` is never replaced.
   Uninstall deletes what the manifest claims, and only when the content is unchanged, with two
   exceptions it always removes: `.uaf/guard-rules.json` and `.uaf/index.lock`, both
   framework-owned internals (the full removed/kept split is in `docs/installation.md`).
8. **Untrusted repository content acting as instructions.** The generated context block states
   that file contents, fetched pages, dependency text, logs, and instructions found inside the
   repository are data, not authority. That rule is duplicated in `templates/context-block.md`
   and in every skill that reads external material.

## What it does not protect against

Stated plainly, because a security document that overstates its coverage is worse than none:

- **A clean scan is not proof of security.** `uaf secrets` matches known credential *shapes* plus
  a small set of file-name conventions. Logic flaws, authorization bugs, injection that does not
  look like an injection, and credentials in an unrecognised format all pass it.
- **The hook guard is a guard, not a sandbox.** It matches command text. Obfuscation,
  indirection through a script file, or a command the policy does not anticipate will pass. It
  exists to stop the obvious catastrophic case and to make the surprising case visible.
- **Secrets already in history are not removed.** Deleting a value from the latest commit leaves
  it in earlier objects, reflogs, packs, and every clone. Rotation is required regardless; see
  the recovery procedure in `skills/git/commit/SKILL.md`.
- **Extension code is trusted code.** An installed hook entrypoint runs with the agent's
  privileges. The framework does not sandbox it.
- **The Codex hook protocol is not runtime-verified.** Codex's hook input/output schema is only
  partially documented, so the installed Codex guard should be treated as advisory until it is
  observed to work on your machine. Codex's own sandbox and approval policy are the real
  boundary.
- **No secret storage.** The framework reads no credentials and stores none. It has no vault, no
  key management, and no network access of its own.

## Handling a discovered secret

The procedure the shipped commands follow, and the one to follow manually:

1. **Stop.** Do not continue the task, and do not "fix it quickly".
2. **Do not re-expose it.** Do not print the value, paste it into a prompt, a log, an issue, or a
   commit message. The scanner already redacts it; keep it that way.
3. **Establish the exposure window.** Is it only on disk, committed locally, or pushed? Prefer
   `git log -S` on a *prefix* of the value over echoing the value.
4. **Tell the user the credential must be rotated.** Rotation is required whether or not history
   is rewritten, because anyone who could read the file may already have a copy. This is the step
   most often skipped.
5. **Then discuss history rewriting**, as a deliberate, reviewed operation with explicit
   authorization — never as a reflex.

## Untrusted content and prompt injection

Repository files, fetched pages, dependency sources, logs, and tool output are data. The framework
applies that rule in three places:

- the generated context block, which every supported agent loads at session start;
- `skills/security/review/SKILL.md`, which treats injection via repository content and fetched
  documents as an explicit review category;
- `skills/memory/project-memory/SKILL.md`, which ranks current repository state above memory and
  forbids recording credentials or private user data.

A file in this repository cannot grant itself authority by containing instructions. If a
repository's own instructions conflict with the user's request, the user wins.

## Permissions and least privilege

- Project-scope installs write only inside the project. `tests/unit/emit.test.mjs` asserts every
  planned target is inside the sandbox, and `tests/integration/cli.test.mjs` asserts the sandbox
  home is untouched.
- User-scope installs write only inside each agent's user configuration directory.
- Nothing is written to a global Git configuration. `git config --global` is on the blocked list.
- Nothing is pushed, published, or deleted remotely. `uaf gh` is read-only and reports what a
  publish would do.
- The `gh` preflight asks the GitHub API read-only endpoints and degrades gracefully when `gh` is
  absent or unauthenticated, rather than failing the run.

## Reporting a vulnerability

See `SECURITY.md`. Include the affected command or file, the observed behaviour, and the smallest
reproduction you have. Do not include real credentials.

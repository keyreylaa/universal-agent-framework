---
name: commit
description: Runs the pre-commit procedure for Git work, reviewing branch, staged and unstaged changes, untracked files, secrets, .gitignore, and generated artifacts before writing a message that explains the change and why, and defining identity confirmation and secret-in-history recovery. Use before any git commit, when staging files, when a commit mixes concerns, or when a credential may already be in history.
license: MIT
metadata:
  activation: contextual
  agents: claude, codex, opencode, omp
---

## Purpose

A commit is a permanent, reviewable statement about a change. This skill runs the checks that belong before the commit so the commit contains exactly the intended work, carries an honest message, and leaks nothing. It also fixes how the author identity is established and what to do when a credential has already reached history.

## When this activates

Activate when the user asks to commit, stage, or save changes; when a task ends with modified files in a repository; when `uaf git --commit` reports findings that need interpretation; or when a secret is found in a tracked, staged, or already-pushed file.

Do not activate for read-only history inspection (`git log`, `git show`, `git blame`), for working-tree operations like `git stash` or `git restore` on uncommitted work, or when the user only wants an existing diff explained.

## Prerequisites

- A Git repository and a working `git` binary, confirmed with `git rev-parse --is-inside-work-tree`.
- The project's own check entry points, read from its package scripts, Makefile, or CI config. Never substitute a generic command for the project's runner.
- `uaf` for the automated preflight. If it is unavailable, run the same checks manually with `git` and the project tooling; say that the preflight was not run.

## Procedure

1. **Confirm repository and branch.** Run `git rev-parse --is-inside-work-tree`, `git rev-parse --show-toplevel`, and `git branch --show-current`. An empty result or `HEAD` means detached HEAD: a commit made there is unreachable from any branch. Create or switch to a branch first.
2. **Read status in full.** `git status --porcelain=v1` lists staged, unstaged, and untracked entries. The commit will contain only the staged set, so note the three groups separately.
3. **Review staged and unstaged changes separately.** Run `git diff --staged` and `git diff`. Reviewing only one hides the other: an earlier `git add` may already sit in the index, and a partially staged file splits one change across two commits.
4. **Inspect untracked files.** List them and open every one you did not create. Untracked credential files, dumps, and scratch scripts are the most common accidental leak.
5. **Scan for secrets before staging.** Run `uaf secrets` over the repository or the specific paths and read the findings. Also flag values you noticed while reviewing: private keys, tokens, connection strings, and high-entropy literals. Never echo a suspected value into the transcript, even to explain it.
6. **Review `.gitignore`.** Confirm it covers credential files (`.env*`), build output (`dist/`, `build/`, `target/`), dependency trees (`node_modules/`), editor state (`.idea/`, `.vscode/`), OS metadata (`.DS_Store`), and machine-local config. If a credential-bearing file is untracked and unignored, add the ignore entry in this same commit.
7. **Confirm generated artifacts and local config are not staged.** Check the staged list for build output, unrelated lockfile churn, machine-specific settings, caches, databases, and absolute local paths. Unstage anything that does not belong with `git restore --staged <path>` and say why.
8. **Run the checks the change requires.** Use the project's own commands: test runner, linter, type check, format check. Run the tests that cover the changed code, not a single smoke command as a proxy. Report what actually ran and its real result.
9. **Confirm the staged set matches the intended task.** `git diff --staged --stat`, then the full `git diff --staged`. Every staged file must belong to this change. If the change mixes unrelated concerns, split it into separate commits with explicit staging instead of one vague message.
10. **Establish the identity deliberately.** Inspect `git config --local user.name`, `git config --local user.email`, then the `--global` equivalents for the same keys. State which one applies: a repository-local value wins; a value inherited only from global config belongs to every project on the machine and may be wrong here. Before the framework's first commit in a repository, ask the user to confirm the author name and email, and set them with `git config --local user.name "<name>"` and `git config --local user.email "<email>"`. Never invent an identity and never modify global configuration without explicit authorization; prefer repository-local config.
11. **Stage explicitly.** Add each reviewed file by path, for example `git add src/parser.ts tests/parser.test.ts`. Neither `git add .` nor `git add -A` is a default: both pick up whatever else changed in the tree since the review, including files you never inspected.
12. **Re-inspect the staged diff, then commit.** Run `git diff --staged` again immediately before `git commit`, because the index is not a snapshot of your earlier review. Do not pass `--no-verify`, `--no-gpg-sign`, or any flag that disables a hook or a signature requirement. Do not create an empty commit unless the user explicitly asked for one.
13. **Write the message.** Subject: what changed, imperative mood, roughly 72 characters, no trailing period. Body: why the change was made, constraints or alternatives rejected, and any migration or follow-up a reader needs. If the only honest message is "various changes", the commit should have been split.
14. **Run the automated preflight.** `uaf git --commit` checks for a detached HEAD, the identity scope, staged versus unstaged files, untracked and staged credential-bearing filenames, high-severity secret patterns in the index blobs that would actually be committed, staged build artifacts, a missing tracked `.gitignore`, and whether the repository has any commits yet. Resolve errors before committing; treat review-level findings as decisions, not noise.

### Recovery when a secret has already entered history

Say this plainly: removing the value from the latest commit is insufficient. It stays in the object store, is reachable by SHA through reflogs and packs, and is served to anyone who clones, forks, or views the repository.

Options, in order of preference:

- **Rewrite history** with a reviewed plan: `git filter-repo` (or `filter-branch` when filter-repo is unavailable) over the affected paths, then `git push --force-with-lease` on branches the team has agreed to rewrite. Rewriting shared history invalidates every existing clone and open pull request, so it requires explicit authorization and coordination with everyone who has the branch.
- **Rotate and accept** when the value was already public or mirrored elsewhere: revoke the credential at its source, issue a replacement, and record the exposure.

Rotation is required either way. A history rewrite removes the value from the repository; it does not make an already-leaked credential safe.

## Verification

- After committing, run `git show --stat HEAD` and compare it to the staged diff you reviewed; they must match exactly.
- Run `git status --porcelain` and confirm there is nothing left staged that was meant to be in this commit.
- Run `git log -1 --format='%an <%ae> %s'` and confirm the author matches the identity the user confirmed and the subject matches the intended change.
- Re-run `uaf git --commit` after staging and before committing; it should report no errors for the intended set.
- Ground every test claim in the command you ran and its observed exit status. If a check was not run, say so.

## Failure behavior

- A pre-commit hook rejects the commit: fix the underlying problem. Never re-run with `--no-verify`; if the hook itself is wrong, raise that as a separate change with the user.
- HEAD is detached: create a branch at the current commit before committing.
- No identity configured, or identity inherited only from global config: ask the user to confirm the name and email rather than proceeding.
- A secret is found in staged content: unstage the file, tell the user to rotate the credential, and apply the recovery procedure above. Do not commit and clean up later.
- Tests or lint fail: report the real failure and stop. Do not commit partially verified work or describe the failure as pre-existing without checking.
- The intended scope is ambiguous: ask which files belong, rather than staging everything and letting the user trim afterwards.
- `uaf` is missing: run the manual checks and state clearly that the preflight was skipped.

## Anti-patterns

Staging everything and reviewing afterwards:

```bash
git add .            # picks up .env, dist/, and a colleague's half-finished edit
git commit -m "updates"
```

Stage from a reviewed list, and re-read the index before committing:

```bash
git add src/parser.ts tests/parser.test.ts
git diff --staged
git commit -m "parser: reject unterminated block comments

Previously the lexer consumed to EOF, turning a syntax error into a
silent truncated parse. Reported by the fuzz corpus."
```

The explicit form keeps the commit equal to what was reviewed, and the message records the failure mode so the next reader does not reintroduce it.

Forcing a failing hook through:

```bash
git commit --no-verify -m "wip"
```

The hook is the cheapest reviewer available. Fix the lint error, the missing test, or the secret it caught, then commit normally.

Rewriting a shared branch to tidy a message:

```bash
git push --force origin main    # invalidates every clone and open PR
```

Amending or rewriting shared history requires explicit authorization from the user, and coordinated agreement from anyone holding the branch. Local unpushed commits are a different case.

## Security

- The index is what gets published. Scan the exactly-staged content, not only the working tree; `uaf git --commit` reads the index blobs for this reason.
- Credential files (`.env`, `id_rsa`, `.aws/credentials`, `.netrc`, `.npmrc`, `.git-credentials`) must never be staged, and must appear in `.gitignore`.
- Do not print suspected secret values in the transcript, commit message, or notes; a value repeated in output is a second exposure.
- Do not edit `.git/config` by hand to change remotes or identity; use `git config --local` so the change is reviewable and reversible.
- Signed-commit and hook requirements exist for a reason; disabling them converts a review gate into an unreviewed publish step.

## Token notes

- Prefer `git status --porcelain` and `git diff --stat` before any full diff; read the full diff only for the paths in scope.
- `uaf git --commit --json` returns a compact structured summary that is cheaper to reason over than pasting raw status output.
- For a large diff, review it file by file and keep only the relevant hunks in context; do not re-read a diff you have already reviewed.
- Summarize test output as the command plus the failure lines, not the full log.

## Known limitations

- `uaf secrets` and any pattern scan produce false negatives; a clean scan is not evidence that no credential is present.
- The tooling cannot know which of several plausible identities is the correct author; only the user can confirm that.
- Coordination with clones, forks, and mirrors outside this repository cannot be verified from here, so history-rewrite safety depends on the user's confirmation.
- Generated, minified, or binary diffs are effectively unreviewable; their safety depends on regenerating them from reviewed sources.

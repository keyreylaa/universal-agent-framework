---
name: publish
description: Runs the pre-push and repository-creation checks before publishing to GitHub, verifying remote and destination, branch, working tree, secret scan, build and test results, real CI run status rather than workflow files, branch protection, divergence and history-rewrite risk, and explicit user authorization. Use before git push, gh repo create, adding a remote, opening a release, or changing repository visibility.
license: MIT
metadata:
  activation: contextual
  agents: claude, codex, opencode, omp
---

## Purpose

Publishing is the point where local work becomes visible to other people and cannot be quietly withdrawn. This skill verifies what would leave the machine, where it would land, and whether the user actually authorized it. It also defines how to create a repository without silently choosing defaults on the user's behalf.

## When this activates

Activate before `git push`, before creating a repository or a remote, before `gh release create`, before changing visibility, branch protection, or deleting a remote branch, and when the user asks to share, publish, or open a repository.

Do not activate for local commits (the git commit skill covers those), for read-only inspection (`gh repo view`, `gh run list`, `git fetch`), or for pulling and fetching, which do not publish anything.

## Prerequisites

- A Git repository with at least one commit, and a configured remote (usually `origin`).
- `gh` authenticated when the task touches GitHub state. Check with `gh auth status`; if it is missing or unauthenticated, fall back to `git` only and state plainly which checks could not run.
- The project's build and test commands, taken from its own scripts and CI configuration.
- `uaf gh` for the automated preflight.

## Procedure

1. **Verify the repository and remote.** Run `git rev-parse --is-inside-work-tree`, `git remote -v`, and `git remote get-url origin`. Read the URL carefully: a typo in the owner or repository name publishes to the wrong place, and a URL for a repository you do not control is an immediate stop.
2. **Verify the active branch.** `git branch --show-current`. On detached HEAD there is nothing to push to a branch. Confirm the branch name matches the destination branch you intend to update.
3. **Verify the working tree.** `git status --porcelain=v1`. Note staged, unstaged, and untracked entries. Nothing unstaged travels in a push, but an untracked credential file signals a leak that is one `git add` away.
4. **Verify staged and committed changes.** `git diff --staged` for anything about to be committed on top, and `git log --oneline @{u}..HEAD` (or `origin/<branch>..HEAD`) for the exact commits that would leave the machine. Review both; the push carries the commits, not the index.
5. **Scan for secrets in what would be published.** Run `uaf secrets` and read the findings. Then scan the outgoing range specifically, because a secret already committed but not yet pushed is still recoverable, while one that is pushed is not. If a credential is in the outgoing commits, stop; the git commit skill's history-recovery procedure applies, and rotation is required regardless.
6. **Confirm the intended destination.** State the owner, repository, and branch you are about to write to. Check visibility with `gh repo view --json visibility` when `gh` is available; a public destination changes the exposure of everything in step 5.
7. **Run the project's build and test commands.** Use the project's own entry points. Record the real commands and their real results; a push of untested code is a decision the user must make knowingly, not a default.
8. **Check CI configuration and actual run status.** List workflows with `gh workflow list` and recent runs with `gh run list --limit 5 --json workflowName,status,conclusion,headBranch`. A workflow YAML file in the repository is not evidence that CI works: it may be disabled, misconfigured, never triggered, or failing on the default branch. Only run status and conclusions count as evidence. If recent runs fail, resolve or explicitly surface the failures before pushing. If no workflows exist, evaluate whether automated checks are warranted for this project and ask the user before adding any; do not silently install a large pipeline. Never describe a workflow, test, or run result that you did not observe.
9. **Check branch protection where accessible.** Use `gh api repos/<owner>/<repo>/branches/<branch>/protection` (or the rules endpoint) to see whether the destination requires reviews, status checks, or rejects force-pushes. If the call fails because of permissions or plan limits, say the check could not be made rather than assuming the branch is unprotected.
10. **Confirm no unrelated changes will be published.** Compare `origin/<branch>..HEAD` against the intended task. Commits belonging to someone else's work in progress, or unrelated local experiments, must not ride along; rebase or split them out first.
11. **Check whether the destination branch diverged.** Run `git fetch <remote>` and compare with `git rev-list --left-right --count <remote>/<branch>...HEAD`. Behind means someone else pushed: reconcile by rebasing or merging, never by force. Ahead and behind both non-zero is a divergence that will either be rejected or require a history rewrite. A rejected push is recoverable; a force-push to a shared branch is not, because it invalidates other people's clones and open pull requests.
12. **Assess conflict and history-rewrite risk.** If the local branch was rebased, amended, or filtered after it was last pushed, the push is a rewrite. Ask for explicit authorization before any `--force`, and use `--force-with-lease` rather than `--force` so a concurrent push is not silently discarded. Never rewrite a protected or shared branch without the user's agreement and coordination with other holders.
13. **Confirm authorization.** Publication is a consequential action: state exactly what will be pushed, to which repository and branch, and get the user's confirmation before running it. The same applies to `gh release create`, deleting a remote branch, changing visibility, and editing branch protection. Absent an explicit instruction in this session, do not push.
14. **Publish, then verify the result.** After a push, run `git fetch` and `git rev-list --left-right --count` again to confirm the remote branch now points at the intended commit, or `gh run list` to confirm CI started for the pushed commit. After creating a repository or changing visibility, re-read it with `gh repo view`. Verify after each important operation rather than assuming it worked.
15. **Run the automated preflight.** `uaf gh` resolves the remote to an owner and repository, checks authentication and that the repository is readable, warns when the destination is public, compares the branch against its upstream for divergence, scans the outgoing commit content for secrets, and lists workflows and recent run conclusions. It also checks `uaf git --commit` conditions when a commit precedes the push. Treat its errors as blocking and its review findings as decisions for the user.

### Creating a repository

Creating a repository is a publication decision in itself, because visibility is chosen before anything is reviewed. Confirm all of the following with the user first, and never default to public:

- **Name**, exactly as it will appear in the URL.
- **Description**, the one-line summary shown on the repository page.
- **Topics**, the discovery tags.
- **License**, including the choice to have none, which the user should make deliberately.
- **Visibility**, private, internal, or public, confirmed explicitly. Private is the safe default when the user has not chosen.

Prefer `gh repo create` with explicit flags over an interactive prompt so the plan is visible before it runs. Creating a repository is not installing CI: if the project needs workflows, that is a separate decision from step 8.

## Verification

- After a push, `git rev-list --left-right --count <remote>/<branch>...HEAD` should report `0 0`, or the expected remaining difference.
- `gh run list --limit 3 --json workflowName,status,conclusion` should show the run triggered by the pushed commit, with the conclusion you are claiming.
- `gh repo view --json nameWithOwner,visibility,defaultBranchRef` should match the destination and visibility you told the user about.
- `uaf gh` should report no errors for the intended publication.
- Every claim about a test, build, workflow, or run must correspond to output you observed in this session.

## Failure behavior

- Push rejected as non-fast-forward: fetch, inspect the divergence, and reconcile. Do not escalate to `--force` on your own.
- Push rejected by branch protection: report exactly which rule blocked it and stop; the fix is a pull request or an authorized settings change, not a bypass.
- `gh` missing or unauthenticated: do not attempt to install or re-authenticate silently. Report which checks were skipped and continue with `git`-only verification, or ask the user to authenticate.
- The repository does not exist: ask whether to create it, and collect name, description, topics, license, and visibility before doing so. Do not create anything preemptively.
- A secret is found in the outgoing range: stop the push and apply the history-recovery procedure. Rewriting unpushed history is local and safe; rewriting pushed history is not.
- CI runs are failing: report the failing workflow and run URL, and let the user decide whether to push anyway. Do not describe a failing run as a flake without evidence.
- The destination branch or owner is ambiguous: ask. There is no safe default for "which repository did you mean".

## Anti-patterns

Treating a workflow file as proof of a working pipeline:

```
.github/workflows/ci.yml exists  ->  "CI is green"
```

Read the runs instead:

```bash
gh run list --limit 5 --json workflowName,status,conclusion,headBranch
```

A committed workflow can be disabled, never triggered, scoped to the wrong branch, or failing since the day it was added. Only the run's conclusion is evidence, and only for the commit it ran against.

Forcing a diverged branch to make the push succeed:

```bash
git push --force origin main
```

Someone else's commits disappear from the branch but remain in every clone that already fetched them, and their next pull produces conflicts nobody can explain. Fetch, rebase or merge, and push again. Reserve force-with-lease for a feature branch that only you own, after asking.

Creating the repository first and filling in metadata later:

```bash
gh repo create my-project --public --source=. --push
```

This publishes the code before the user has chosen a name, description, or visibility, and public is not recoverable once mirrors or caches have copied it. Confirm every field first, choose private when the user has not decided, then create and push deliberately.

Reporting a verification step as done because the plan was to do it: "I pushed and CI passed" without a push or a run observation. State what you actually ran and saw.

## Security

- The outgoing commits are the publication boundary: scan the diff between the remote-tracking branch and HEAD, not just the working tree.
- A public repository makes every committed value world-readable and mirrored; verify visibility before publishing content that includes anything internal.
- Never print, paste, or transmit credential values while investigating a leak; report the file, the location, and the type, not the value.
- Force-pushes, branch deletion, visibility changes, and releases are irreversible or remote; treat each as requiring explicit authorization.
- Authentication tokens for `gh` and Git must never be passed on the command line or written into repository files, where they land in shell history and commits.

## Token notes

- Use `uaf gh --json` for a compact structured preflight instead of pasting raw `git status`, `git log`, and `gh` output.
- Review the outgoing range with `git log --oneline` and `--stat` first; read full diffs only for paths whose content matters.
- `gh run list --limit 5` and `gh workflow list` are cheap; `gh run view` logs are not, so fetch only the failing steps.
- Summarize test and build output as the command plus the failing lines rather than the full log.

## Known limitations

- Branch protection and some repository settings are only readable with sufficient permissions; on restricted or free plans these checks may be unavailable, and the skill must say so rather than infer protection.
- Repository-level caches, mirrors, and third-party forks cannot be enumerated from here; deleting or rewriting published content is never complete.
- Secret scanning is pattern-based and produces false negatives; a clean result is not proof that nothing sensitive is being published.
- `gh` behavior and the availability of individual API endpoints vary by version and plan; verify against `gh <command> --help` and the actual response rather than assumed flags.

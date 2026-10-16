---
description: Run the git commit preflight — secrets, identity, staged set, and artifacts — before creating a commit.
argument-hint: '[--json]'
---

# Commit preflight

```sh
UAF="$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs"
node "$UAF" git --commit $ARGUMENTS
```

This is read-only. It inspects the index blobs — the exact content that would be committed — not the
working tree, so it catches a staged secret that was already removed from disk.

Handle the result as follows:

- **Error findings** block the commit. Fix them, or explain to the user precisely why the finding is
  wrong and let them decide. Never proceed past a credential finding.
- **`no-identity` or `global-only-identity`**: never invent an author. Ask the user to confirm the name
  and email, explain whether it is configured locally or globally, and prefer repository-local config.
- **`nothing-staged`**: stage the intended files explicitly. Do not fall back to `git add .`.
- **`diverged` or `staged-artifact`**: stop and ask. Do not force, and do not clean up user work.

Then stage deliberately, re-read the staged diff, and only then commit with a message that says what
changed and why. Never use `--no-verify` to get past a hook.

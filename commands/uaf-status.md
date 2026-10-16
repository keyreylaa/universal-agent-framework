---
description: Show what the framework has installed in this project and whether any installed file has drifted.
argument-hint: '[--scope project|user] [--json]'
---

# Install status

```sh
UAF="$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs"
node "$UAF" status $ARGUMENTS
```

Report:

- which agents the install targets, when it happened, and how many artifacts the manifest owns;
- any drift, meaning a file changed on disk after install. Drift is not an error — the user may have
  edited it deliberately. Uninstall preserves modified files rather than deleting them, so explain
  that and ask whether to keep or reinstall.
- if nothing is installed, say so and point at `uaf doctor` rather than guessing.

Do not reinstall over drift without asking. Reinstalling overwrites the changed file.

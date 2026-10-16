---
description: Run the framework's environment diagnostic and report agent detection, install state, and mode.
argument-hint: '[--json]'
---

# Framework doctor

Run the diagnostic:

```sh
UAF="$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs"
node "$UAF" doctor $ARGUMENTS
```

If a `uaf` binary is on `PATH`, `uaf doctor` is equivalent.

Then report, in this order:

1. Which of the four target agents are detected on this machine, and which adapter paths are
   documentation-derived rather than verified against a running agent.
2. Whether an install manifest exists, how many artifacts it owns, and whether any artifact has
   drifted (modified by hand after install).
3. The resolved operating mode and where it came from.
4. Whether the project index exists and when it was generated.
5. Any warnings, verbatim.

Do not treat a detected binary as evidence that its adapter paths are correct — say explicitly
which agents are unverified. If the index is missing, offer `uaf index`; do not run it unasked.

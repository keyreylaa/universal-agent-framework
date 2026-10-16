---
description: Check the GitHub destination, divergence, CI status, and outgoing commits before publishing.
argument-hint: '[--remote origin] [--json]'
---

# Publish check

```sh
UAF="$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs"
node "$UAF" gh $ARGUMENTS
```

Read-only. Nothing is pushed. It verifies the remote, whether the destination repository exists and
is public, how far the branch has diverged, whether anything in the outgoing commits matches a
credential pattern, and the real status of CI runs.

Then:

- A workflow file is not evidence that CI works. Report the actual run conclusions, or say that no
  run information was available.
- If there is no CI, say so and ask whether basic automated tests are warranted. Do not install a
  large pipeline unasked.
- A public destination, a diverged branch, or a credential match in outgoing commits all require the
  user's decision before anything is published.
- If the repository does not exist, ask before creating it, and confirm name, description, topics,
  license, and visibility. Never default to public.

Pushing, releasing, deleting branches, and changing visibility are consequential. Get explicit
authorization, then verify the result afterwards.

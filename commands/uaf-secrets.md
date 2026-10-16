---
description: Scan files or the repository for credential patterns before sharing, committing, or publishing.
argument-hint: '[paths...] [--json]'
---

# Secret scan

```sh
UAF="$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs"
node "$UAF" secrets $ARGUMENTS
```

This is a pattern scan over known credential shapes plus file-name detection. It is one input to a
security review, not the review.

When it reports a finding:

1. Stop the task. Do not continue past a credential finding.
2. Do not print the value again, and do not paste it into the conversation, a log, or a file. The
   scan already redacts it; keep it that way.
3. Determine the exposure window: is it committed and pushed, or only on disk? Check with
   `git log -S` on the value's prefix only if that does not re-expose the value.
4. Tell the user the credential must be rotated. Rotation is required whether or not history is
   rewritten, because anyone who could read the file may already have it.
5. Only then discuss history rewriting, with a reviewed plan and explicit authorization.

A clean scan does not mean the code is free of secrets or vulnerabilities. Say that plainly rather
than reporting "no secrets found". `.env.example` and `*.pub` files are exempt by design.

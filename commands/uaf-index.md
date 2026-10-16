---
description: Build or refresh the project index so later searches do not re-read the whole repository.
argument-hint: '[--force] [--json]'
---

# Index the project

```sh
UAF="$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs"
node "$UAF" index $ARGUMENTS
```

The index is deterministic and incremental: unchanged files are reused by size and mtime, and only
content that actually changed is re-hashed and re-parsed. Secret-named files, binary files, build
output, vendored dependencies, and anything `.gitignore` excludes are skipped.

Report:

- how many files were indexed versus scanned, and the added/changed/removed counts;
- the detected languages, test tooling, lint tooling, CI workflows, and build/test commands;
- which files were skipped and why (secrets, binary, too large).

Do not use `--force` unless the index is known to be wrong; a forced rebuild of a large repository
is expensive and is rarely the fix. If the output shows zero test tooling, say so plainly — an
unverified project has no safety net and that should shape the plan.

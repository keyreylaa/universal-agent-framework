---
description: Find where something is implemented using the project index instead of reading files one by one.
argument-hint: '<query terms>'
---

# Recall a location

```sh
UAF="$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs"
node "$UAF" search "$ARGUMENTS"
```

Use this before opening files. It scores symbol names above path matches, so `retry` finds the
function before it finds a directory that happens to be named after it.

Then:

1. Read only the files the search actually points at, and only the relevant ranges.
2. If the search returns nothing, refine the query rather than assuming the code does not exist.
   Try a domain term, a likely symbol name, an error string, or a config key.
3. If the index is missing or clearly stale, run `uaf index` first.
4. If a result changes your plan, cite the file and line you relied on.

Do not paste large search output into the conversation; report the handful of locations that matter.

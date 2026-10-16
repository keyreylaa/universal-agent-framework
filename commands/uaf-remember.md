---
description: Record a durable project decision, convention, constraint, or known bug in project memory.
argument-hint: '"<note text>" [--kind decision|convention|bug|constraint|preference|question] [--id key]'
---

# Remember

```sh
UAF="$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs"
node "$UAF" remember "$ARGUMENTS"
```

Record only what is durable and was established deliberately. Good candidates:

- a decision and its reason ("chose X over Y because Z");
- a convention that is not obvious from the code;
- a constraint from outside the repository (a platform limit, a contractual requirement);
- a known bug that is deliberately not fixed yet, with its trigger;
- an unresolved question with the evidence gathered so far.

Do not record: secrets or credentials (the command refuses these), guesses, transient task state,
or anything already stated in the repository's own documentation.

After recording, confirm what was stored and under which id. Memory is a hint: when it disagrees
with the current repository, the repository wins, and the stale note should be corrected or removed.

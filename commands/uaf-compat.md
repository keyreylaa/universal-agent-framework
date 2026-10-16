---
description: Show the cross-agent capability matrix — what each agent supports natively and which paths this framework writes.
argument-hint: '[--json]'
---

# Compatibility matrix

```sh
UAF="$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs"
node "$UAF" compat $ARGUMENTS
```

Use this when a workflow behaves differently per agent, or when asked whether something is supported.

Key distinctions the matrix preserves:

- **Runtime-verified** means the adapter was exercised against a running agent in this environment.
  Everything else is derived from the agent's official documentation (see `docs/research/`), and must
  be described that way. Never claim compatibility merely because a file was written to a plausible
  directory.
- **Shared locations** are the reason one write can reach several agents: `.claude/skills` and
  `.agents/skills` are read by more than one agent, and `AGENTS.md`/`CLAUDE.md` are read by several.
- **Unsupported is reported, not faked.** Codex has no project-level command directory, and no agent
  exposes a feature-identical hook surface. Say what is missing and what the closest reliable
  alternative is, rather than implying parity.

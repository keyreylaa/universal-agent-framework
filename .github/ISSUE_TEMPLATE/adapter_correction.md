---
name: Adapter correction
about: A documented path or capability for one of the four agents is wrong or out of date
title: ""
labels: adapter
---

## Which agent

- [ ] Claude Code
- [ ] OpenAI Codex CLI
- [ ] OpenCode
- [ ] Oh My Pi

## What the framework currently assumes

<!-- Quote the relevant row from `uaf compat`, or the entry in core/agents.mjs. -->

## What the agent actually does

<!--
Cite the official documentation URL or the source file. An undocumented behaviour is fine to
report, but say so — the registry records confidence, and an unverified claim must stay marked
as such.
-->

Source:

## How you verified it

<!--
"Path corrected in a running agent, observed X" is what we need. A file existing in a directory
is not evidence the agent reads it.
-->

| | |
| --- | --- |
| Agent version (`<agent> --version`) | |
| Operating system | |
| Reproduced how | |

## Is this a capability the framework should implement differently?

<!-- For example: a hook mechanism we currently mark unsupported, or a path that changed. -->

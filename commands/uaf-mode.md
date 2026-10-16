---
description: Inspect or change the operating mode (lite, full, ultra) and get a risk-based suggestion.
argument-hint: '[get|set <mode>|suggest] [--files a,b] [--scope project|user] [--json]'
---

# Operating mode

```sh
UAF="$(git rev-parse --show-toplevel)/.uaf/framework/core/cli.mjs"
node "$UAF" mode $ARGUMENTS
```

Modes set verification depth, not feature count:

| Mode | Intended for | Tests | Review depth | Dependency audit |
| --- | --- | --- | --- | --- |
| `lite` | a small, well-scoped change in a small or familiar project | the test covering the change | the diff | no |
| `full` | ordinary development (default) | the affected suite | changed modules | on adding a dependency |
| `ultra` | complex, risky, or release-critical work | full suite plus failure paths | architecture | yes, with supply-chain review |

Rules:

- Do not escalate a mode to look thorough. `suggest` derives depth from the files and the index:
  auth, payments, crypto, migrations, CI, infrastructure, and dependency manifests raise it; adding
  a test lowers it. Present the reasoning, not just the verdict.
- `lite` never means skipping verification of the change itself.
- `ultra` does not mean enabling every optional workflow; it means more verification where the
  assessed risk justifies it.
- A mode change is a project decision: `set` writes to `.uaf/config.json` (project) or `~/.uaf/config.json`
  (user). Say which one you are changing.

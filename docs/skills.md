# Skills

A skill is one directory holding a `SKILL.md`: YAML frontmatter with `name` and
`description`, then Markdown instructions. The format is vendor-neutral — the same
file is read by Claude Code, Codex CLI, OpenCode, and Oh My Pi — and this
repository's loader validates it more strictly than any single agent so that a
skill which installs here is portable everywhere (see `core/skills.mjs`).

Skills are the framework's unit of transferable judgment. Each one is written to be
read as a procedure, not as reference prose: purpose, when it activates, what it
needs, an ordered procedure, verification, failure behavior, anti-patterns, and a
token note. The shipped set is small on purpose, and a skill whose scope could be
confused with another's says so — most carry an explicit "do not activate for" list,
and the rest state their exclusions in the description.

## Authoring layout

```
skills/
  <category>/
    <name>/
      SKILL.md
      references/          # optional; loaded on demand, never all at once
        <topic>.md
```

- `<category>` groups related skills and is not part of the install path. It is the
  first directory level under `skills/`; a skill placed directly at
  `skills/<name>/SKILL.md` is labelled with the category `general`, and both layouts
  are discovered (`discoverSourceSkills` in `core/emit.mjs`).
- `<name>` must equal the frontmatter `name` exactly, match
  `^[a-z0-9]+(?:-[a-z0-9]+)*$`, and be 64 characters or fewer. The directory name
  is what agents resolve: `skill://root-cause`, `/root-cause`, `$root-cause`.
- Nothing else registers a skill. Discovery is a directory walk, so adding a skill
  means adding a directory; `uaf install` copies every *valid* skill into each
  resolved install location and reports every invalid one as a warning
  (`planInstall` in `core/emit.mjs`).

### Frontmatter keys

| Key | Status here | Notes |
| --- | --- | --- |
| `name` | required | Must match the directory name. |
| `description` | required, single line, ≤ 1024 chars | The only text agents select on. See below. |
| `license` | used | All shipped skills carry `MIT`. |
| `metadata` | used | A nested mapping; the shipped skills set `activation` and `agents`. |
| `allowed-tools`, `allowed_tools`, `argument-hint`, `model`, `version`, `globs`, `alwaysApply`, `hide`, `disable-model-invocation` | allowed | Read from agent documentation; none of the shipped skills use them. |

Any key outside that set is a warning, not an error: the value is preserved and the
loaders ignore it (`KNOWN_KEYS` in `core/skills.mjs`).

Validation runs on every load and fails the skill (excluding it from install) when
the name is malformed or does not match the directory, when `description` is missing
or longer than 1024 characters, when the body is empty, or when a frontmatter value
would be rejected or reinterpreted by a strict YAML parser — a tab, an unquoted
`: `, an unquoted ` #`, unquoted flow brackets, or a leading YAML indicator
character (`loadSkill`, `frontmatterIssues`). The reference-target test for this is
`tests/unit/skills.test.mjs`.

### The description is the interface

Each shipped `description` is one line that names the procedure and ends with the
situations that should trigger it. That is not stylistic. All four agents build
their selection surface from `name` plus `description` and nothing else:

| Agent | What the model sees | Source |
| --- | --- | --- |
| Claude Code | Per-turn listing of `name`, `description`, `when_to_use`; description and `when_to_use` are truncated at 1,536 chars. | `docs/research/claude-code.md` |
| Codex CLI | `name`, `description`, and the skill path; full `SKILL.md` read only when selected. | `docs/research/codex.md` |
| OpenCode | `name` and `description` inside the `skill` tool's `<available_skills>` listing. | `docs/research/opencode.md` |
| Oh My Pi | Skill metadata in the system prompt. | `docs/compatibility.md` |

A vague or absent description makes a correct skill unreachable, and a description
that does not state its triggers makes the agent invoke it on the wrong task. The
1024-character ceiling enforced here is OpenCode's documented limit; the others
truncate later, so a description that passes local validation survives every
loader intact.

### Support files

Extra material belongs in a `references/` subdirectory next to `SKILL.md` and is
read on demand, one file at a time, by path relative to `SKILL.md`. The whole skill
directory is copied on install (`copyDirOrFile` recurses), so references travel with
the skill. Only `skills/engineering/languages/` currently ships references — eight
language files — and its `SKILL.md` states the rule explicitly: resolve
`references/<language>.md`, load exactly one, and never load all of them.

## Activation per agent

Two confidence levels are used below because only one agent could be exercised in
this environment. The distinction is stated rather than smoothed over.

| | Claude Code | Codex CLI | OpenCode | Oh My Pi |
| --- | --- | --- | --- | --- |
| Verification | docs-derived | docs-derived | docs-derived | **runtime-verified** |
| Model-invoked | Yes — description match | Yes — description match | Yes — the `skill` tool | Yes — metadata in the system prompt |
| User-invoked | `/skill-name` | `$skill` mention; `/skills` picker | `/name`, only when the skill opts in via `metadata` | `/skill:<name>` |
| Suppress model invocation | `disable-model-invocation: true` | `skills.config` entry with `enabled = false` | `metadata` opt-out (`opencode/autoinvoke`) | `hide: true` |

Every shipped skill is reachable by model invocation on all four agents: the agent
selects it from `name` plus `description`. Explicit user invocation works everywhere
except OpenCode, which exposes `/name` only for skills that opt in through
`metadata` — the shipped skills do not set that key, so on OpenCode they are reached
through the `skill` tool.

Verification status:

- **Oh My Pi is the only adapter that was exercised here.** Its own `skill://`
  resolver was used to read an installed skill after a real install:
  `tests/e2e/omp-discovery.test.mjs` installs the skill set, then calls
  `omp read skill://code-quality` and asserts the output identifies the skill file
  and contains the skill's body; a second test asserts that byte-identical copies in
  two shared skill roots collapse into one listing instead of being namespaced.
  Claude Code, Codex, and OpenCode were not present to confirm any of this.
- **The other three rows are documentation-derived.** They come from
  `docs/research/claude-code.md`, `docs/research/codex.md`, and
  `docs/research/opencode.md`, and the same claims appear as the capability matrix in
  `docs/compatibility.md`, where they are labelled docs-derived. `uaf compat` prints
  them and `uaf doctor` reports which adapters are verified on the current machine.
- `metadata.activation` and `metadata.agents` in each `SKILL.md` are authoring
  annotations for humans and for this documentation. No code in `core/` branches on
  them; an agent that ignores `metadata` still sees and selects the skill. They are
  not an activation switch, and setting them to another value would change nothing
  about when a skill loads.

### Where skills are installed

The installer does not copy a skill four times. It computes a set cover over the
locations each agent reads (`SKILL_LOCATIONS`, `planSkillTargets` in
`core/emit.mjs`):

| Location | Read by | Note |
| --- | --- | --- |
| `.claude/skills` | Claude Code, OpenCode, Oh My Pi | OpenCode and Oh My Pi both read Claude's directory. |
| `.agents/skills` | Codex, OpenCode, Oh My Pi | Codex's only documented repository skill path. |
| `.omp/skills` | Oh My Pi | Native, highest precedence. Not needed when a shared root is written. |
| `.opencode/skills` | OpenCode | Native. Not needed when a shared root is written. |

No single location covers all four agents, so the minimum is two. At user scope the
pair is `~/.agents/skills` plus `~/.claude/skills`. `--link` symlinks skill
directories instead of copying them. Rationale and the deduplication guarantee are in
`docs/compatibility.md`.

## Inventory

Thirteen skills ship today, one category each. The activation column is the
`metadata.activation` value read from each file; the token column is that skill's
share of the always-on listing, measured in the run below.

| Skill | Category | Activation | Purpose |
| --- | --- | --- | --- |
| `root-cause` | debugging | contextual | Orders debugging from reliable reproduction through evidence-based narrowing to one falsifiable hypothesis, the smallest justified fix, and a regression test. |
| `strategy` | testing | contextual | Finds the project's existing runner and conventions first, then chooses the right kind of test: unit, integration, contract, end-to-end, regression, security, failure-path, or performance. |
| `code-review` | review | contextual | Reviews a change against its stated intent and the repository's contracts, and reports findings by severity with `file:line`, a failure scenario, and a concrete change. |
| `review` | security | contextual | Evidence-based security pass over secret handling, history risk, injection, traversal, deserialization, SSRF, authn vs authz, supply chain, and log leakage. |
| `code-quality` | engineering | contextual | Naming, flat control flow, abstraction only after real callers exist, boundary-only validation, preserved error context, no unrequested options. |
| `dependencies` | engineering | contextual | Forces a three-outcome decision — no dependency, reuse, or add a vetted package — before third-party code enters the project. |
| `languages` | engineering | contextual | Detects the repository's real language and toolchain from manifests and CI, then loads exactly one matching reference file. |
| `commit` | git | contextual | Pre-commit procedure: branch, staged and unstaged changes, untracked files, secrets, `.gitignore`, generated artifacts, then an honest message. |
| `publish` | github | contextual | Pre-push and repository-creation checks: destination, divergence, real CI run status, protection, history-rewrite risk, and explicit authorization. |
| `readme` | documentation | contextual | Decides which documents a project actually needs and keeps every claim traceable to code, manifest, or verified endpoint. |
| `project-memory` | memory | contextual | Uses the `uaf` index, `uaf search`, and user-approved notes, with current repository state always winning over remembered hints. |
| `data-extraction` | scraping | contextual | Chooses the cheapest adequate retrieval method for a web target and produces validated, deduplicated output. |
| `bot-development` | discord | contextual | Builds and maintains discord.js and discord.py bots: intents, slash commands, interactions, permissions, rate limits, sharding, shutdown, tokens. |

All thirteen declare the same activation class and the same intended agents, so no
skill is installed always-on and none is restricted to a subset of the four.

## Worked example

Task: a CI test fails roughly one run in ten with `SQLITE_BUSY: database is locked`,
and it never fails locally.

1. **Recognise the class of work.** The failure is a defect whose cause is not
   obvious, so it belongs to `root-cause` and not to `strategy` (no new behaviour to
   pin) or `code-quality` (no code written yet). The always-on listing is what makes
   that decision possible — the agent has `root-cause` plus its description in
   context before reading any file. In a checkout of this framework, or in a project
   where it is vendored under `.uaf/framework`, the same listing prints locally:

   ```sh
   node core/cli.mjs skills
   ```

2. **Locate the code the skill will operate on, before loading it.** `uaf search`
   queries the project index — symbols, paths, and headlines, scored
   deterministically with code and tests weighted above config and docs. It does not
   search the skill set; the skill set is selected from the listing in step 1.

   ```sh
   uaf index                     # only needed once, or when the index may be stale
   uaf search "job queue batch" --kind code --limit 10
   ```

   `root-cause`'s own token notes say the same thing: use `uaf search "<symbol or
   error text>"` instead of reading whole files.

3. **Load the skill through the agent's own mechanism.** On Oh My Pi, whose resolver
   is the one verified in this repository:

   ```sh
   omp read skill://root-cause
   ```

   That returns the skill file with its body, and the procedure is now in context.
   The equivalent on the other agents, per `docs/compatibility.md`: a `/root-cause`
   message in Claude Code, a `$root-cause` mention in Codex CLI, or a
   `skill({ name: "root-cause" })` tool call in OpenCode. On all four the description
   match can also load it without an explicit invocation.

4. **Run the procedure.** Reproduce and *measure* the flake (the skill rejects "it
   sometimes fails": record, for example, 4 failures in 40 CI runs, all on the
   parallel runner). List three to six candidate causes. Eliminate them with one
   discriminating experiment at a time — history bisection, input bisection,
   instrumentation, or a differential run — and state after each which candidate it
   removed. Commit to one falsifiable hypothesis, make the smallest fix at the cause,
   add a regression test that fails before the fix and passes after it, then re-run
   the step-1 reproduction.

5. **Report in the skill's terms.** Cause, evidence chain, fix, regression test, the
   exact commands run with their results, and what could not be run and why. A
   durable conclusion goes into project memory with `uaf remember` so the next
   session does not repeat the investigation.

## Token economics

Observed on this checkout, 2026-10-16:

```
$ node core/cli.mjs skills
13 skills, 10 commands
always-on listing cost: ~1465 tokens (name + description only)
```

The same total appears in the installer's own budget line, from
`node core/cli.mjs install --dry-run` for all four agents:

```
skills: 13 (146.6 KiB on disk, ~1465 tok of always-on listing)
```

Two things are worth reading carefully in those numbers.

**Only name and description are always-on.** The `~1465` figure is
`estimateTokens("<name> <description>")` summed over the thirteen skills
(`core/skills.mjs` estimates four characters per token; `cmdSkills` in
`core/cli.mjs` does the sum). Bodies do not ship with it: a `SKILL.md` is read when
the skill is selected — in Claude Code, the rendered file enters the conversation as
one message and stays for the rest of the session instead of being re-read. On disk
the whole set is 146.6 KiB of `SKILL.md` files —
150,096 bytes, the exact figure `install --dry-run` reports; the eight language
reference files are additional bytes that are not counted in that line, because they
only enter context when a skill explicitly reads them.

Per-skill listing cost, from the same run:

| Skill | Lines | Files | Listing cost |
| --- | --- | --- | --- |
| `bot-development` | 268 | 1 | ~137 tok |
| `code-quality` | 150 | 1 | ~136 tok |
| `code-review` | 131 | 1 | ~130 tok |
| `commit` | 123 | 1 | ~103 tok |
| `data-extraction` | 150 | 1 | ~81 tok |
| `dependencies` | 122 | 1 | ~130 tok |
| `languages` | 106 | 9 | ~115 tok |
| `project-memory` | 109 | 1 | ~104 tok |
| `publish` | 122 | 1 | ~106 tok |
| `readme` | 143 | 1 | ~87 tok |
| `review` | 118 | 1 | ~137 tok |
| `root-cause` | 112 | 1 | ~91 tok |
| `strategy` | 124 | 1 | ~108 tok |

Bodies are deliberately of similar size (roughly 100–270 lines), which keeps the
listing cheap and the loaded cost predictable. The budget discipline at the agent
end is different per agent and worth knowing before authoring a long skill: Claude
Code's skill listing defaults to 1% of the context window and drops descriptions of
least-used skills when over budget; Codex caps the skill listing at
`skills.max_context_tokens` (default 2% of the window, hard ceiling 10000); OpenCode
puts the listing in the `skill` tool description; Oh My Pi carries skill metadata in
its system prompt (`docs/research/*.md`, `docs/compatibility.md`).

**Progressive disclosure applies to references too.** A `references/` file is loaded
only when the procedure calls for it, and exactly one is loaded per need. The
`languages` skill is the shipped example: it detects the repository's language, loads
the single matching `references/<language>.md`, and loads a second only when the
change genuinely spans a second language, at the point that part of the work starts.
Its anti-patterns section names loading every reference "to be safe" as the failure
mode, with the context cost as the reason. Nine files exist under `languages/` and a
session should normally read two of them: the skill and one reference.

`uaf skills` also validates while it lists. A skill with malformed frontmatter is
marked `✗` with its errors, and the command exits `1` (findings) rather than `0`; the
same skill is excluded from what `install` copies. Exit codes generally: `0` ok, `1`
findings, `2` usage, `3` blocked. `--json` returns the same rows as structured data,
including `description`, `bytes`, `lines`, `files`, and `listingTokens` per skill and
the summed `listingTokens`.

## What is deliberately not shipped

**No empty language stubs.** There is no `python-idioms` skill, no `go-testing`
skill, and no near-empty placeholder per language. Breadth is handled by one skill
plus per-language reference files: `skills/engineering/languages/SKILL.md` detects
the toolchain from manifests, lockfiles, and CI configuration, then resolves exactly
one reference relative to its own directory. It ships eight:
`typescript.md`, `python.md`, `go.md`, `rust.md`, `sql.md`, `shell.md`, `cpp.md`,
`java.md`. A ninth language costs one file, and it costs nothing until a session
detects that language.

**What to do for an uncovered language.** The skill answers this in its procedure,
and the answer is not "improvise". Detection enumerates more than eight ecosystems —
it looks for `Gemfile`/`*.gemspec` (Ruby) and `composer.json` (PHP) among others — but
the reference list is the eight above, so a Ruby or PHP repository lands in the
uncovered branch:

- Follow the repository's own conventions by reading existing code of the same kind.
- Consult that language's official documentation for anything the codebase does not
  demonstrate, and do not invent conventions, flags, or APIs.
- State plainly that the language is not covered by the skill.

The skill behaves the same way when the reference file is missing or unreadable:
continue with repository conventions, say which reference could not be loaded. If the
repository and a reference disagree, the repository wins and the divergence is
reported rather than silently resolved. If the language is one the project will keep
using, adding a reference file is the fix — the coverage grows per file, not per
skill.

**No per-framework restatements.** A skill is written once, for all four agents. It
does not carry per-agent branches, repeated adapter instructions, or a variant per
tool: agent-specific paths, flags, and loading mechanisms live in `core/agents.mjs`,
in `docs/compatibility.md`, and in the adapters, and each skill's `metadata.agents`
records the intended targets. The consequence for authors is that a skill must be
written against the vendor-neutral `SKILL.md` format only, and that anything it needs
from the host — how a skill is loaded, how a command is run — is stated as a
requirement ("read access to the directory containing this `SKILL.md`") with a
fallback, rather than assumed.

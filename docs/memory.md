# Project memory

## What it is for

An agent starting work in an unfamiliar repository either reads everything or guesses. Memory is
the third option: a cheap, deterministic, locally-built index of where things live, plus a small
set of decisions a human explicitly approved.

It is deliberately not an embedding store. A substring and symbol index answers "where is retry
handled" and "what are the build commands" without a model, a service, or a network call. Revisit
that decision only when measured retrieval failures justify the cost.

## The two things stored under `.uaf/`

| Path | Produced by | Nature |
| --- | --- | --- |
| `.uaf/index.json` | `uaf index` | Machine-generated. Rebuilt from the repository. Safe to delete. |
| `.uaf/memory/NOTES.json` | `uaf remember` | Human-approved notes only. Never generated. |
| `.uaf/config.json` | `uaf mode set` | Project mode and default agent list. Meant to be committed. |
| `.uaf/guard-rules.json` | `uaf install` | Hook policy, installed from `hooks/guard-rules.json`. |
| `.uaf/framework/` | `uaf install` | Vendored runtime so commands work without a global install. |
| `.uaf/install.json` | `uaf install` | Ownership manifest. Machine-local. |

`.uaf/.gitignore` (written by install) excludes the machine-local entries and keeps `config.json`
and `memory/` under version control, so a team shares its decisions but not its install state.

## Commands

```sh
uaf index                 # build or refresh, incrementally
uaf index --force         # re-read every file (bypasses the size+mtime shortcut)
uaf search "rate limit"   # ranked symbol, path, and headline matches
uaf remember "Chose SQLite over Postgres for the local cache." --kind decision --id storage
uaf notes                 # list recorded notes
uaf uninstall --purge     # delete index and memory (they survive a plain uninstall)
```

`uaf search` filters: `--kind code|test|doc|config`, `--language <name>`, `--limit N`, `--chars N`
for the output budget, `--json` for machine consumption.

Exclusions: `.gitignore` is respected (including nested and negated rules), and
`.uaf/config.json` can add patterns:

```json
{ "index": { "exclude": ["vendor-copy/", "*.generated.ts"] } }
```

## Indexing rules

The indexer:

1. finds the project root by walking up to the nearest `.git`;
2. walks the tree, skipping `.git`, `node_modules`, build output, editor state, and caches;
3. skips any file whose *name* marks it as credential-bearing, before reading it;
4. skips binary files and files above 512 KiB;
5. records path, size, mtime, SHA-256, line count, kind, language, bounded symbol list, and a
   truncated headline;
6. reuses unchanged entries by size and mtime, then confirms with a hash, so a touched but
   identical file is not reported as a change;
7. drops deleted files and reports them;
8. writes atomically through a temporary file plus rename.

**Interrupted runs.** A lock file records the process that is indexing. A leftover lock means the
previous run did not finish; because the index is only replaced by an atomic rename, the previous
index is still consistent, and the next run simply rebuilds. Nothing is lost and no manual repair
is required.

## Retrieval

Scoring prefers a symbol-name match over a path match, so a query for `retry` finds
`retryWithBackoff` rather than a directory that happens to be named after it. Kind weighting keeps
implementation ahead of documentation, and a file's headline breaks ties.

`--chars` bounds the rendered output, so a broad query cannot flood the model's context.

## Trust model

- **Memory is a hint.** Current repository state outranks it. When they disagree, the repository
  is right and the stale note should be corrected or removed.
- **Only user-approved notes are authoritative.** `uaf remember` requires an explicit action.
  Nothing else under `.uaf/` should be treated as a decision.
- **Repository content is data.** Text retrieved from the index — including anything that looks
  like instructions — cannot override the user's request or the framework's rules.
- **No credentials.** Notes that match a high-severity secret pattern are refused (exit code 3),
  and secret-named files are never indexed.

## Known limitations

- Retrieval is lexical. A query using a word that appears nowhere in a path, symbol name, or
  headline will not find a file whose content matches semantically.
- Symbol extraction is heuristic per language and capped at 60 symbols per file. It captures
  top-level declarations well in TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, PHP,
  Ruby, C/C++, shell, PowerShell, SQL, Dart, and Elixir; it captures nothing for a language it
  does not know.
- The index reflects the filesystem, including uncommitted work. It is not a Git view of history.
- There is no semantic search, no cross-repository index, and no team-shared generated memory.
  Shared knowledge travels through `memory/NOTES.json` and `config.json`, which are committed.
- `uaf remember` does not verify that a note is true. It records what a human approved.

# Testing

The framework ships its own tests under `tests/`. They use the Node test runner
(`node --test`) and `node:assert/strict`; there is no test dependency and no build step.

## Suites

| Suite | Path | Files | What it covers |
| --- | --- | --- | --- |
| `unit/` | `tests/unit/` | `emit.test.mjs`, `index.test.mjs`, `preflight.test.mjs`, `secrets.test.mjs`, `skills.test.mjs` | The pure modules in isolation: path resolution and set cover, index building and search scoring, preflight with an injected runner, secret patterns, frontmatter parsing and validation. |
| `integration/` | `tests/integration/` | `cli.test.mjs`, `install.test.mjs` | The CLI as a real subprocess and the installer end to end: exit codes, JSON shapes, install/uninstall round trips, drift, context-block behaviour. |
| `security/` | `tests/security/` | `adversarial.test.mjs` | Untrusted repository content, path escapes, and the failure modes a "we wrote the file, so it must work" mindset misses. |
| `e2e/` | `tests/e2e/` | `omp-discovery.test.mjs` | A real agent's own discovery code: it installs the skill set and asks Oh My Pi's `skill://` resolver to return it. |

## npm scripts

```sh
npm test          # unit + integration + security
npm run test:e2e  # end-to-end only
npm run test:all  # npm test, then npm run test:e2e
```

`npm test` runs:

```sh
node --test "tests/unit/*.test.mjs" "tests/integration/*.test.mjs" "tests/security/*.test.mjs"
```

`npm run test:e2e` runs `node --test "tests/e2e/*.test.mjs"`.

## Test helper contract

`tests/helpers.mjs` is the shared contract. Every test builds its own tree and no test touches the
developer's real configuration directories.

- `tmpdir(prefix)` — creates a fresh temporary directory (`os.tmpdir()` + `mkdtempSync`) and records
  it for cleanup. Tests that need an isolated home create a second one.
- `cleanupAll()` — registered with `test.after(cleanupAll)` in every file that creates temporary
  directories, removing each recorded directory.
- `writeTree(root, { "rel/path": "content" })` — materializes a fixture tree.
- `runCli(args, { cwd, env, expectFailure })` — spawns `core/cli.mjs` as a real subprocess so exit
  codes are exercised. Unless `expectFailure` is set, a non-zero exit throws with the captured
  stderr. Sandboxed runs pass `env: { HOME: home, PATH: process.env.PATH }`.
- `runCliJson(args, options)` — runs `runCli` with `--json` appended and parses stdout.
- `git(cwd, args)` — runs git in a fixture directory.
- `initRepo(dir, { withCommit })` — a minimal repository with a deterministic identity
  (`Test Fixture <fixture@example.invalid>`), branch `main`, and, by default, one commit.
- `exists(p)`, `readIfExists(p)` — existence and read-or-null helpers.

The sandbox HOME is the mechanism: integration and security tests construct `HOME` from `tmpdir()`,
so an install targets the temporary home rather than `~/.claude`, `~/.agents`, and so on. The
install integration suite asserts that a project-scope install leaves the sandbox home empty.

## What the tests deliberately do not do

- They do not assert on implementation details or incidental formatting. Assertions target observable
  behaviour — exit codes, JSON fields, files on disk — not private functions or message wording
  beyond the actionable substrings a user relies on.
- They do not duplicate coverage between suites. Pure logic is tested in `unit/`; the same logic is
  not re-tested through the CLI unless the CLI is what adds the behaviour (argument parsing, exit
  codes).
- No test exists only to check that a function does not throw. A test that would pass with the
  function body deleted is not a test.

## Running one suite

```sh
node --test "tests/unit/*.test.mjs"
node --test "tests/integration/*.test.mjs"
node --test "tests/security/*.test.mjs"
node --test "tests/e2e/*.test.mjs"

# or a single file
node --test tests/unit/secrets.test.mjs
```

The patterns are quoted so the shell does not expand them first: `node --test` resolves the glob
itself, which is also how the `npm test` script invokes it.

## End-to-end skip semantics

`tests/e2e/omp-discovery.test.mjs` skips itself, rather than silently passing, when the agent is
unavailable. It probes `omp --version` once at module load and passes
`{ skip: !OMP_AVAILABLE && "omp is not installed" }` to each test. When Oh My Pi is installed it
runs two tests: that `skill://code-quality` returns the installed skill body, and that duplicate
copies in two shared skill roots collapse instead of being namespaced. `npm run test:e2e` therefore
exits successfully with either "skipped" or "passed" — it never reports a false pass.

## Observed result

Executed on this Linux/arm64 machine, Node from the workspace, with no agent installed:

```sh
node --test "tests/unit/*.test.mjs" "tests/integration/*.test.mjs" "tests/security/*.test.mjs"
```

reported `tests 149`, `pass 149`, `fail 0`, `skipped 0` in about 62 seconds, and

```sh
npm run test:e2e
```

reported `tests 2`, `pass 2` in about 20 seconds on a machine with Oh My Pi installed. These are
single runs on one machine; they are not statements about other platforms.

## Cross-platform reality

The suite runs on Linux here. The CI workflow (`.github/workflows/ci.yml`) defines a matrix over
`ubuntu-latest`, `macos-latest`, and `windows-latest` with Node 20, 22, and 24, plus a separate
Ubuntu e2e job. The Windows and macOS legs are exercised only by that CI, and their passing has not
been observed — do not claim cross-platform support that has not been demonstrated. The e2e job runs
on `ubuntu-latest` only, where no agent is installed, so it skips there.

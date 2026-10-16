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
node tests/run.mjs tests/unit tests/integration tests/security
```

`npm run test:e2e` runs `node tests/run.mjs tests/e2e`.

Both go through `tests/run.mjs`, a dependency-free launcher. Node 20 cannot expand globs for
`node --test` (glob support arrived in Node 21), so a quoted pattern like `"tests/unit/*.test.mjs"`
became one literal path that the runner could not find — a run that reported zero tests instead of
failing. The launcher expands each named suite directory itself, sorts the `*.test.mjs` files, and
spawns `node --test` with explicit paths. A suite directory that does not exist, or that holds no
test files, is a hard error with a non-zero exit rather than a silent pass.

## Test helper contract

`tests/helpers.mjs` is the shared contract. Every test builds its own tree and no test touches the
developer's real configuration directories.

- `tmpdir(prefix)` — creates a fresh temporary directory and returns its **canonical** path
  (`realpathSync`, not the path `mkdtempSync` returned). macOS's `/var` is a symlink to
  `/private/var`, and `process.cwd()` inside a child reports the canonical form, so an
  un-canonicalised expectation made a correct install look wrong.
- `sandboxEnv(home)` — the environment for every CLI subprocess in a sandbox. It sets `HOME` **and**
  `USERPROFILE` (Node reads the latter on Windows), plus the per-agent overrides that
  `core/agents.mjs` consults ahead of any home-derived root: `PI_CODING_AGENT_DIR`,
  `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_CONFIG_DIR`, and `XDG_CONFIG_HOME`. Without all of
  them a sandbox is not hermetic, and detection finds the developer's real configuration.
- `sandbox(prefix)` — the pair most tests want: a disposable project directory plus a disposable
  home, with `env` already built. Project-scope installs are asserted to leave that home empty.
- `cleanupAll()` — registered with `test.after(cleanupAll)` in every file that creates temporary
  directories, removing each recorded directory.
- `writeTree(root, { "rel/path": "content" })` — materializes a fixture tree.
- `runCli(args, { cwd, env, expectFailure })` — spawns `core/cli.mjs` as a real subprocess so exit
  codes are exercised. Unless `expectFailure` is set, a non-zero exit throws with the captured stderr.
- `runCliJson(args, options)` — runs `runCli` with `--json` appended and parses stdout.
- `git(cwd, args)` — runs git in a fixture directory.
- `initRepo(dir, { withCommit })` — a minimal repository with a deterministic identity
  (`Test Fixture <fixture@example.invalid>`), branch `main`, and, by default, one commit.
- `exists(p)`, `readIfExists(p)` — existence and read-or-null helpers.

Expectations are built with `path.resolve`/`path.join` from the same inputs the code receives, never
from hard-coded POSIX strings: `resolvePaths` correctly uses the platform `path` module, so a
Windows assertion written against `/repo/.claude/skills` fails for a reason that has nothing to do
with the behaviour under test.

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
node tests/run.mjs tests/unit
node tests/run.mjs tests/integration
node tests/run.mjs tests/security
node tests/run.mjs tests/e2e

# any combination, or a single file directly
node tests/run.mjs tests/unit tests/security
node --test tests/unit/secrets.test.mjs
```

Suite directories are named relative to the repository root; the launcher resolves them to explicit
absolute paths before spawning `node --test`.

## End-to-end skip semantics

`tests/e2e/omp-discovery.test.mjs` skips itself, rather than silently passing, when the agent is
unavailable. It probes `omp --version` once at module load and passes
`{ skip: !OMP_AVAILABLE && "omp is not installed" }` to each test. When Oh My Pi is installed it
runs two tests: that `skill://code-quality` returns the installed skill body, and that duplicate
copies in two shared skill roots collapse instead of being namespaced. `npm run test:e2e` therefore
exits successfully with either "skipped" or "passed" — it never reports a false pass.

## Observed result

Executed on this Linux/arm64 machine (Node 24.22.0) with Oh My Pi installed:

```sh
npm test
```

reported `tests 154`, `pass 154`, `fail 0`, `skipped 0` — 92 in `unit/`, 48 in `integration/`,
14 in `security/` — in about 67 seconds, and

```sh
npm run test:e2e
```

reported `tests 2`, `pass 2`, `fail 0`, `skipped 0` in about 18–25 seconds — Oh My Pi is installed
here, so the two e2e tests ran rather than skipping. The launcher itself was checked directly:
`node tests/run.mjs tests/unit` reported `tests 92`, `pass 92`, `fail 0` and exited `0`, while
`node tests/run.mjs tests/does-not-exist` printed `tests/run.mjs: suite directory not found:
tests/does-not-exist` and exited `2`. These are single runs on one machine; they are not statements
about other platforms, and the timings move by tens of seconds with machine load — the counts are
the stable part.

## Cross-platform reality

The suite runs on Linux here. The CI workflow (`.github/workflows/ci.yml`) defines a matrix over
`ubuntu-latest`, `macos-latest`, and `windows-latest` with Node 20, 22, and 24, plus a separate
Ubuntu e2e job that skips itself because no agent is installed on a runner.

The first CI run failed on every platform. The cause was a test, not the product: it asserted that
each agent user path sits under the `home` it was passed, while `resolvePaths` legitimately honours
`XDG_CONFIG_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_CONFIG_DIR`, and
`PI_CODING_AGENT_DIR` — and GitHub runners set `XDG_CONFIG_HOME`. The failure was reproduced
locally by running the suite with `XDG_CONFIG_HOME` set (148 passed, 1 failed, matching CI), then
fixed by passing an explicit environment to that assertion and adding two tests that pin the
override behaviour; that run passed 151/151, the total the suite had at the time. The pipe-safety
test added afterwards (`JSON output is complete when stdout is a pipe, not just when it is a file`)
is the 152nd.

What is observed now: CI runs 38872156800 (`0f147ac`) and 38873018231 (`0d8647f`) report all nine
matrix legs — `ubuntu-latest`, `macos-latest`, and `windows-latest` with Node 20, 22, and 24 — and
the e2e job as success. The macOS and Windows legs have never been executed on this machine, so CI
is the only evidence for them; every local figure in this document is Linux-only. The earlier
failures were real, they are recorded above and in the CHANGELOG, and they are why the harness
carries a canonicalising `tmpdir()`, a fully overridden `sandboxEnv()`, and its own suite launcher.
CI run conclusions are visible with `node core/cli.mjs gh`, which reports real run status rather
than the presence of a workflow file.

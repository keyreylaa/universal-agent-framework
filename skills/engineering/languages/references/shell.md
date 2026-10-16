# Shell

Covers POSIX `sh`, Bash, and the small scripts that glue builds, CI, and operations together.

## Tooling to discover in the repo

- Shebangs and file modes: `#!/usr/bin/env bash`, `#!/bin/sh`, `#!/usr/bin/env -S bash -e`, and bashisms in a `sh`-declared script.
- Whether the existing scripts set `set -euo pipefail`; match the established strictness rather than introducing a new one.
- Static analysis: a `.shellcheckrc` or a CI step running `shellcheck`; formatting via `shfmt` and its config.
- The interpreter version CI uses. macOS ships an older Bash, so a "works here" script may fail in CI or vice versa.
- Test harness: `bats` tests, a `tests/` directory of scripts, or CI steps that exercise the script end to end.
- Where scripts are invoked from: `Makefile`, `Dockerfile` `RUN`/`ENTRYPOINT`, CI workflow steps, hooks. That decides the working directory and available environment variables.

## Error handling

- Start with `set -euo pipefail` in Bash scripts unless the repo's style omits it deliberately. `-e` stops on failure, `-u` catches unset variables, `-o pipefail` catches failures in the middle of a pipeline.
- `set -e` has holes: a command in a condition or a function used as a condition does not trigger exit. Add explicit checks (`cmd || exit 1`) where correctness depends on it.
- Guard required inputs up front: `: "${TARGET_DIR:?set TARGET_DIR}"` fails fast with a clear message instead of expanding to an empty string.
- Clean up with `trap cleanup EXIT`, and combine with `ERR`/`INT`/`TERM` traps only when the behavior is understood; a trap that always exits 0 hides failures.
- Check that commands exist before using them: `command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }`.
- Write error messages to stderr, exit non-zero, and use meaningful exit codes when the caller branches on them.
- Prefer explicit `if ! cmd; then ... fi` over inspecting `$?` after unrelated commands.

## Concurrency and portability

- Run independent steps in the background and collect with `wait`; capture each background job's exit status, since `wait` reports only one.
- Serialize access to shared resources with `flock` on systems that provide it, or a lock directory created with `mkdir` as the portable fallback.
- Handle signals when long-running: install traps so a terminated script removes temp files and child processes.
- Stay POSIX when the shebang says `sh`: no arrays, no `[[ ]]`, no `local`, no `pipefail`.
- Avoid GNU-only flags when the target is not Linux; `sed -i`, `readlink -f`, and `date -d` differ across platforms.
- Prefer machine-readable output from tools (porcelain, zero-delimited, JSON) over parsed human text, and test for an empty result explicitly.

## Testing

- If the repo has a test harness, extend it; if not, cover the script with a test that runs it end to end on a temporary directory and asserts exit status and output.
- Run `shellcheck` with the repo's configuration; fix or explicitly suppress findings with a comment stating why.
- Verify the failure paths, not only the happy path: missing argument, missing tool, unwritable target, command that exits non-zero.
- Run the script with `bash -n script.sh` (or `sh -n`) for a syntax check before executing it.
- Never run a destructive script against real paths in a test; use `mktemp -d` targets.

## Anti-patterns

Parsing `ls`.
```sh
for f in $(ls *.log); do gzip "$f"; done
```
Filenames with spaces split, and the subshell hides failures. Improved: `for f in *.log; do gzip "$f"; done`.

Unquoted expansions.
```sh
rm -rf $BUILD_DIR/$TARGET
```
An unset or empty variable turns this into `rm -rf /`. Improved: `rm -rf "${BUILD_DIR:?}/${TARGET:?}"`, plus `shellcheck` clean.

Reading a file line by line unsafely.
```sh
while read line; do process "$line"; done < file.txt
```
Backslashes are eaten and leading whitespace stripped. Improved: `while IFS= read -r line; do ...; done < file.txt`, or NUL-delimited `find -print0` piped into `while IFS= read -r -d '' path`.

Ignoring a failing command inside a pipeline.
```sh
curl -fsSL "$url" | tar -xz -C "$dst"
```
Without `pipefail`, only `tar`'s status is seen, so a failed download silently extracts garbage. Improved: set `-o pipefail` (Bash) or check the download separately.

Assuming the working directory.
```sh
cd "$(dirname "$0")"
rm -rf output
```
If the `cd` fails, `output` is deleted wherever the caller happened to be. Improved: check the `cd` result explicitly, then operate on paths derived from it.

#!/usr/bin/env sh
# Remove exactly what scripts/install.sh created.
#
# Usage: scripts/uninstall.sh [-C|--cwd <dir>] [--scope project|user] [--purge] [--yes]
#
# Files modified by hand after installation are preserved and reported, never deleted.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FRAMEWORK_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
CLI="$FRAMEWORK_ROOT/core/cli.mjs"

if ! command -v node >/dev/null 2>&1; then
  printf 'uninstall.sh: Node.js is required but was not found on PATH.\n' >&2
  exit 2
fi

SCOPE=project
PURGE=""
TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --scope) SCOPE=$2; shift 2 ;;
    --scope=*) SCOPE=${1#*=}; shift ;;
    --purge) PURGE="--purge"; shift ;;
    -C|--cwd) TARGET=$2; shift 2 ;;
    --cwd=*) TARGET=${1#*=}; shift ;;
    --yes|-y) shift ;;
    -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'uninstall.sh: unknown argument %s\n' "$1" >&2; exit 2 ;;
  esac
done

printf 'This removes framework-owned skills, commands, hooks, the vendored runtime, and the\n'
printf 'managed context block for scope "%s". Hand-modified files are kept.\n' "$SCOPE"
printf 'Project index and memory under .uaf/ are kept unless --purge is given.\n\n'
printf 'Continue? [y/N] '
if ! read -r reply; then
  printf '\nno answer on stdin (piped input?); nothing was changed. Re-run the CLI with --yes.\n'
  exit 2
fi
case "$reply" in
  y|Y|yes|YES) ;;
  *) printf 'aborted; nothing was changed.\n'; exit 0 ;;
esac

if [ -n "$TARGET" ]; then
  set -- --cwd "$TARGET"
else
  set --
fi

# shellcheck disable=SC2086
exec node "$CLI" uninstall --scope "$SCOPE" $PURGE "$@"

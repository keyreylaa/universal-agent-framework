#!/usr/bin/env sh
# Install the universal agent framework into a project or a user home.
#
# Usage: scripts/install.sh [-C|--cwd <dir>] [--scope project|user] [--agents a,b] [--dry-run]
#                           [--yes] [--link] [--no-hooks] [--no-commands] [--no-context]
#
# The only prerequisite is Node.js >= 20, which every supported agent already ships with.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FRAMEWORK_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
CLI="$FRAMEWORK_ROOT/core/cli.mjs"

if ! command -v node >/dev/null 2>&1; then
  printf 'install.sh: Node.js is required (>= 20) but was not found on PATH.\n' >&2
  exit 2
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  printf 'install.sh: Node.js >= 20 is required; found %s.\n' "$(node --version)" >&2
  exit 2
fi

SCOPE=project
AGENTS=
MODE=
TARGET=
DRY_RUN=0
ASSUME_YES=0
# Space-separated switches without spaces in their values, so word splitting is safe.
SWITCHES=

while [ $# -gt 0 ]; do
  case "$1" in
    --scope) SCOPE=$2; shift 2 ;;
    --scope=*) SCOPE=${1#*=}; shift ;;
    --agents) AGENTS=$2; shift 2 ;;
    --agents=*) AGENTS=${1#*=}; shift ;;
    --mode) MODE=$2; shift 2 ;;
    --mode=*) MODE=${1#*=}; shift ;;
    -C|--cwd) TARGET=$2; shift 2 ;;
    --cwd=*) TARGET=${1#*=}; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --link|--no-hooks|--no-commands|--no-context) SWITCHES="$SWITCHES $1"; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'install.sh: unknown argument %s\n' "$1" >&2; exit 2 ;;
  esac
done

# shellcheck disable=SC2086
build_args() {
  set -- install --scope "$SCOPE" $SWITCHES
  if [ -n "$AGENTS" ]; then set -- "$@" --agents "$AGENTS"; fi
  if [ -n "$MODE" ]; then set -- "$@" --mode "$MODE"; fi
  if [ -n "$TARGET" ]; then set -- "$@" --cwd "$TARGET"; fi
  printf '%s\n' "$@"
}

if [ "$DRY_RUN" -eq 1 ]; then
  # shellcheck disable=SC2046
  exec node "$CLI" $(build_args) --dry-run
fi

# Always show the plan before applying it.
# shellcheck disable=SC2046
node "$CLI" $(build_args) --dry-run
printf '\n'

if [ "$ASSUME_YES" -ne 1 ]; then
  printf 'Apply this plan? [y/N] '
  # Under `curl | sh` stdin is the downloaded script's pipe and is already at EOF,
  # so a failed read must abort rather than fall through under `set -e`.
  if ! read -r reply; then
    printf '\nno answer on stdin (piped input?); nothing was changed. Re-run with --yes.\n'
    exit 2
  fi
  case "$reply" in
    y|Y|yes|YES) ;;
    *) printf 'aborted; nothing was changed.\n'; exit 0 ;;
  esac
fi

# shellcheck disable=SC2046
exec node "$CLI" $(build_args) --yes

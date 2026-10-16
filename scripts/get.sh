#!/usr/bin/env sh
# Bootstrap installer. One command, no clone required.
#
#   curl -fsSL https://raw.githubusercontent.com/keyreylaa/universal-agent-framework/main/scripts/get.sh | sh -s -- --agents claude,omp
#
# It fetches the framework into a cache directory, then hands over to the real
# installer in scripts/install.sh. Nothing is written to the target project until
# the installer prints its plan and you approve it (`--yes` skips the prompt).
#
# Environment:
#   UAF_REF      git ref to fetch            (default: main; pin a tag for reproducibility)
#   UAF_SOURCE   repository URL or local dir (default: the GitHub repository)
#   UAF_HOME     install cache               (default: ${XDG_DATA_HOME:-$HOME/.local/share}/uaf)
#   UAF_TARGET   directory to configure      (default: the current directory)
#
# Trust: this script downloads and executes code. By default it follows a moving
# ref. To review before running, or to fix a version, set UAF_REF to a tag you have
# inspected. There is no published checksum for a moving branch, and none is claimed.

set -eu

REPO_URL_DEFAULT="https://github.com/keyreylaa/universal-agent-framework.git"
UAF_SOURCE=${UAF_SOURCE:-$REPO_URL_DEFAULT}
UAF_REF=${UAF_REF:-main}
UAF_HOME=${UAF_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/uaf}
UAF_TARGET=${UAF_TARGET:-}

die() {
  printf 'get.sh: %s\n' "$1" >&2
  exit "${2:-2}"
}

# Prompts need a real terminal: under `curl | sh`, stdin is an exhausted pipe.
# Probe in a subshell first, because a failed `exec < /dev/tty` kills the shell.
if [ ! -t 0 ] && (exec < /dev/tty) 2>/dev/null; then
  exec < /dev/tty
fi

WORKDIR=$UAF_HOME/src
mkdir -p "$UAF_HOME"

fetch_with_git() {
  if [ -d "$WORKDIR/.git" ]; then
    git -C "$WORKDIR" fetch --quiet --depth 1 origin "$UAF_REF"
    git -C "$WORKDIR" checkout --quiet --detach FETCH_HEAD
  else
    rm -rf "$WORKDIR"
    git clone --quiet --depth 1 --branch "$UAF_REF" "$UAF_SOURCE" "$WORKDIR"
  fi
}

fetch_from_directory() {
  # Local source: copy the tree so the cache layout matches the remote case.
  rm -rf "$WORKDIR"
  mkdir -p "$WORKDIR"
  (cd "$UAF_SOURCE" && tar -cf - --exclude='.git' --exclude='.uaf' .) | (cd "$WORKDIR" && tar -xf -)
}

fetch_from_archive() {
  archive_url=$1
  # Check both tools up front: without this, tar reports a confusing
  # "gzip: Cannot exec: No such file or directory" and a truncated pipe.
  command -v curl >/dev/null 2>&1 || die "curl is required to fetch an archive but was not found on PATH"
  command -v tar >/dev/null 2>&1 || die "tar is required to unpack the framework archive but was not found on PATH"
  command -v gzip >/dev/null 2>&1 || die "gzip is required to unpack the .tar.gz archive but was not found on PATH; install it, or install git and re-run so the repository can be cloned instead"
  rm -rf "$WORKDIR"
  mkdir -p "$WORKDIR"
  curl -fsSL "$archive_url" | tar -xz -C "$WORKDIR" --strip-components=1
}

fetch_from_github_archive() {
  # Fallback when git is unavailable: codeload serves the same tree as a tarball.
  owner_repo=${UAF_SOURCE#*://github.com/}
  owner_repo=${owner_repo%.git}
  owner_repo=${owner_repo%/}
  fetch_from_archive "https://codeload.github.com/${owner_repo}/tar.gz/${UAF_REF}"
}

case "$UAF_SOURCE" in
  git@*)
    command -v git >/dev/null 2>&1 || die "git is required to fetch $UAF_SOURCE but was not found on PATH"
    printf 'fetching %s @ %s\n' "$UAF_SOURCE" "$UAF_REF"
    fetch_with_git
    ;;
  *://*)
    case "$UAF_SOURCE" in
      *.tar.gz|*.tgz|*.tar)
        printf 'fetching archive %s\n' "$UAF_SOURCE"
        fetch_from_archive "$UAF_SOURCE"
        ;;
      *)
        if command -v git >/dev/null 2>&1; then
          printf 'fetching %s @ %s\n' "$UAF_SOURCE" "$UAF_REF"
          fetch_with_git
        elif [ "${UAF_SOURCE#*://github.com/}" != "$UAF_SOURCE" ]; then
          printf 'git unavailable; fetching the GitHub archive for %s @ %s\n' "$UAF_SOURCE" "$UAF_REF"
          fetch_from_github_archive
        else
          die "git is required to fetch $UAF_SOURCE but was not found on PATH; set UAF_SOURCE to a .tar.gz URL instead"
        fi
        ;;
    esac
    ;;
  *)
    [ -d "$UAF_SOURCE" ] || die "UAF_SOURCE is neither a directory nor a URL: $UAF_SOURCE"
    printf 'using local source %s\n' "$UAF_SOURCE"
    fetch_from_directory
    ;;
esac

[ -f "$WORKDIR/core/cli.mjs" ] || die "fetched tree does not look like this framework (no core/cli.mjs): $WORKDIR"

if ! command -v node >/dev/null 2>&1; then
  die "Node.js >= 20 is required but was not found on PATH. Install Node, then re-run."
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js >= 20 is required; found $(node --version)"

if [ -d "$WORKDIR/.git" ]; then
  printf 'framework at %s (commit %s)\n' "$WORKDIR" "$(git -C "$WORKDIR" rev-parse --short HEAD)"
else
  printf 'framework at %s\n' "$WORKDIR"
fi

# Target: an explicit -C/--cwd wins, then UAF_TARGET, then the directory the user ran
# the command from. Never the fetch cache, which is not a project.
TARGET=$UAF_TARGET
prev=""
for arg in "$@"; do
  case "$prev" in
    -C|--cwd) TARGET=$arg ;;
  esac
  case "$arg" in
    --cwd=*) TARGET=${arg#*=} ;;
  esac
  prev=$arg
done
if [ -z "$TARGET" ]; then
  TARGET=$(pwd)
fi
case "$TARGET" in
  "$WORKDIR"|"$WORKDIR"/*) die "target resolves to the framework cache, which is not a project; run from your project or pass --cwd <dir>" ;;
esac

printf 'target project: %s\n\n' "$TARGET"
exec sh "$WORKDIR/scripts/install.sh" --cwd "$TARGET" "$@"

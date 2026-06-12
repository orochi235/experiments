#!/usr/bin/env bash
# Freeze a build of the speech-balloons app from a git ref into
# public/<version>/, so it deploys at /experiments/speech-balloons/<version>/
# alongside the live app (and serves at /<version>/ on the dev server).
#
# Usage: scripts/snapshot.sh <version> [ref] [--force]
#   version   v<N>, e.g. v1
#   ref       git ref to build (default: main)
#   --force   overwrite an existing public/<version>/

set -euo pipefail

usage() { echo "usage: $(basename "$0") <version> [ref] [--force]" >&2; exit 2; }

VERSION="${1:-}"
[[ -n "$VERSION" ]] || usage
shift
REF="main"
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -*) usage ;;
    *) REF="$arg" ;;
  esac
done

[[ "$VERSION" =~ ^v[0-9]+$ ]] \
  || { echo "error: version must match v<number>, got '$VERSION'" >&2; exit 2; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$APP_DIR" rev-parse --show-toplevel)"
DEST="$APP_DIR/public/$VERSION"

if [[ -e "$DEST" && $FORCE -ne 1 ]]; then
  echo "error: ${DEST} already exists; pass --force to overwrite" >&2
  exit 1
fi

git -C "$REPO_ROOT" rev-parse --verify --quiet "${REF}^{commit}" >/dev/null \
  || { echo "error: unknown git ref '$REF'" >&2; exit 2; }

# The worktree must sit directly beside the repo root (in ~/src): refs after
# the labkit port resolve ../../labkit and ../../weasel relative to the
# checkout, so only a true sibling checkout finds them.
WORKTREE="$(dirname "$REPO_ROOT")/.speech-balloons-snapshot-$VERSION-$$"
[[ ! -e "$WORKTREE" ]] || { echo "error: $WORKTREE already exists" >&2; exit 1; }
cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$WORKTREE"
}
trap cleanup EXIT

git -C "$REPO_ROOT" worktree add --detach "$WORKTREE" "$REF"

cd "$WORKTREE/speech-balloons"
# NODE_ENV must be unset during install or npm ci skips devDependencies
# (vite lives there).
env -u NODE_ENV npm ci
# Relative base makes the frozen build location-independent: it works at
# /experiments/speech-balloons/<version>/ on Pages AND /<version>/ on the
# dev server. The CLI flag overrides the base hardcoded in vite.config.
# vite is invoked directly (not `npm run build`) so the flag applies.
NODE_ENV=production npx vite build --base=./

# public/ is copied verbatim into dist/, so a ref that already contains
# earlier snapshots would nest them inside this one; strip them.
rm -rf dist/v[0-9]*

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R dist/. "$DEST/"

echo
echo "Snapshot of '$REF' installed at ${DEST#"$REPO_ROOT"/}"
echo "Review it, then: git add '${DEST#"$REPO_ROOT"/}' && git commit"

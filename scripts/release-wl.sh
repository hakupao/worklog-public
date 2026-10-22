#!/usr/bin/env bash
# Build the Go `wl` release assets and publish them as a GitHub release (plan Task 14).
#
#   scripts/release-wl.sh <tag> [--prerelease] [--dry-run]
#
# <tag> looks like wl-v0.1.0-rc1 and must already be on HEAD and on origin:
#   git tag wl-v0.1.0-rc1 && git push origin wl-v0.1.0-rc1
# HEAD must be clean and contained in origin/main (Win11 runs the scripts and runbook from main). The assets are built from a detached
# worktree of HEAD in a temp dir (never into <repo>/bin, which the Mac's launchd runs), so untracked
# files cannot mark the build as modified. Assets (names that update-wl.ps1 and the Win11 runbook use):
#   wl-darwin-arm64  wl-windows-amd64.exe  SHA256SUMS
# --dry-run runs every check and the build, prints the gh command, and publishes nothing
# (it keeps the assets and prints where they are).
set -euo pipefail

usage() { echo "usage: $0 <tag> [--prerelease] [--dry-run]   (tag: wl-vX.Y.Z or wl-vX.Y.Z-rcN)" >&2; exit 2; }

TAG="" PRERELEASE="" DRY_RUN=""
for arg in "$@"; do
  case "$arg" in
    --prerelease) PRERELEASE="--prerelease" ;;
    --dry-run) DRY_RUN=1 ;;
    -*) usage ;;
    *) [ -z "$TAG" ] || usage; TAG="$arg" ;;
  esac
done
[ -n "$TAG" ] || usage
[[ "$TAG" =~ ^wl-v[0-9]+\.[0-9]+\.[0-9]+(-rc[0-9]+)?$ ]] || { echo "error: tag must look like wl-v0.1.0 or wl-v0.1.0-rc1: $TAG" >&2; exit 2; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

git fetch --quiet --prune origin
DESCRIBE="$(git describe --tags --match 'wl-v*' --dirty 2>/dev/null || true)"
if [ "$DESCRIBE" != "$TAG" ]; then
  echo "error: git describe --dirty says '${DESCRIBE:-<no wl-v tag>}', expected exactly '$TAG' (tag must be on HEAD, tree clean)" >&2
  exit 1
fi
SHA="$(git rev-parse HEAD)"
if ! git merge-base --is-ancestor "$SHA" origin/main 2>/dev/null; then
  echo "error: HEAD $SHA is not on origin/main; merge and push main first" >&2
  exit 1
fi
# An annotated tag also lists its peeled commit ("refs/tags/<tag>^{}"); that line wins.
REMOTE_TAG="$(git ls-remote --tags origin | awk -v t="refs/tags/$TAG" '$2 == t && !c {c = $1} $2 == t "^{}" {p = $1} END {print (p ? p : c)}')"
if [ "$REMOTE_TAG" != "$SHA" ]; then
  echo "error: tag $TAG on origin is '${REMOTE_TAG:-missing}', expected $SHA; run: git push origin $TAG" >&2
  exit 1
fi

WORK="$(mktemp -d)"
DIST="$WORK/dist"
cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$WORK/src" 2>/dev/null || true
  [ -n "$DRY_RUN" ] && [ -d "$DIST" ] && return
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$DIST"
git worktree add --quiet --detach "$WORK/src" "$SHA"

MK=(make -s -C "$WORK/src/collector" BIN="$DIST" VERSION="$TAG")
GOOS=darwin GOARCH=arm64 "${MK[@]}" build
mv "$DIST/wl" "$DIST/wl-darwin-arm64"
"${MK[@]}" build-windows

(cd "$DIST" && shasum -a 256 wl-darwin-arm64 wl-windows-amd64.exe > SHA256SUMS)
cat "$DIST/SHA256SUMS"

GH=(gh release create "$TAG" --verify-tag --target "$SHA" --title "$TAG" $PRERELEASE
  --notes "Go wl collector $TAG built from $SHA. Verify downloads against SHA256SUMS."
  "$DIST/wl-darwin-arm64" "$DIST/wl-windows-amd64.exe" "$DIST/SHA256SUMS")
if [ -n "$DRY_RUN" ]; then
  echo "dry run: assets in $DIST; would run:"
  printf ' %q' "${GH[@]}"; echo
  exit 0
fi
"${GH[@]}"

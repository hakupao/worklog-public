#!/usr/bin/env bash
# Exercise scripts/release-wl.sh's argument and repository checks in a throwaway repo with a bare
# "origin" and a stub collector/Makefile (no Go toolchain, no gh, nothing published): every refusal
# exits non-zero before building, and a clean, tagged, pushed HEAD passes --dry-run with all three assets.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TAG=wl-v0.1.0-rc1

git init -q --bare "$WORK/origin.git"
FAKE="$WORK/repo"
git init -q -b main "$FAKE"
mkdir -p "$FAKE/scripts" "$FAKE/collector"
cp "$REPO_ROOT/scripts/release-wl.sh" "$FAKE/scripts/"
cat > "$FAKE/collector/Makefile" <<'EOF'
build:
	echo "$(VERSION) $(GOOS)" > $(BIN)/wl
build-windows:
	echo "$(VERSION)" > $(BIN)/wl-windows-amd64.exe
EOF
G=(git -C "$FAKE" -c user.name=t -c user.email=t@example.com)
"${G[@]}" add -A && "${G[@]}" commit -qm init
"${G[@]}" commit -qm second --allow-empty
"${G[@]}" remote add origin "$WORK/origin.git"

fail=0
expect() { # $1 = expected exit code, $2 = expected stderr/stdout fragment, rest = args
  local want="$1" frag="$2"; shift 2
  local got=0 out
  out="$(bash "$FAKE/scripts/release-wl.sh" "$@" 2>&1)" || got=$?
  if [ "$got" = "$want" ] && [[ "$out" == *"$frag"* ]]; then
    echo "PASS exit=$got ${*:-<no args>}: $frag"
  else
    echo "FAIL ${*:-<no args>}: want exit=$want with '$frag', got exit=$got:"; echo "$out" | sed 's/^/    /'; fail=1
  fi
  LAST_OUT="$out"
}

expect 2 "usage:"
expect 2 "usage:" "$TAG" extra
expect 2 "usage:" "$TAG" --bogus
expect 2 "tag must look like" v0.1.0
expect 1 "<no wl-v tag>" "$TAG" --dry-run
"${G[@]}" tag -a "$TAG" -m "$TAG"
echo dirty >> "$FAKE/collector/Makefile"
expect 1 "$TAG-dirty" "$TAG" --dry-run
"${G[@]}" checkout -q -- collector/Makefile
expect 1 "is not on origin/main" "$TAG" --dry-run
"${G[@]}" push -q origin HEAD:refs/heads/side
expect 1 "is not on origin/main" "$TAG" --dry-run
"${G[@]}" push -q origin main
expect 1 "on origin is 'missing'" "$TAG" --dry-run
OLD="$("${G[@]}" rev-parse HEAD~1)"
"${G[@]}" push -q origin "$OLD:refs/tags/$TAG"
expect 1 "on origin is '$OLD'" "$TAG" --dry-run
"${G[@]}" push -q -f origin "$TAG"
expect 0 "gh release create $TAG --verify-tag" "$TAG" --prerelease --dry-run

# The passing dry run: three assets with the published names, versioned by the tag, nothing in <repo>/bin,
# no leftover worktree, and --prerelease passed through.
DIST="$(printf '%s\n' "$LAST_OUT" | sed -n 's/^dry run: assets in \(.*\); would run:$/\1/p')"
check() { if eval "$1"; then echo "PASS $2"; else echo "FAIL $2"; fail=1; fi; }
check '[ -n "$DIST" ] && [ "$(cd "$DIST" && LC_ALL=C ls | tr "\n" " ")" = "SHA256SUMS wl-darwin-arm64 wl-windows-amd64.exe " ]' "three assets"
check '(cd "$DIST" && shasum -a 256 -c SHA256SUMS >/dev/null) && [ "$(wc -l < "$DIST/SHA256SUMS")" -eq 2 ]' "SHA256SUMS covers the two binaries"
check '[ "$(cat "$DIST/wl-darwin-arm64")" = "$TAG darwin" ]' "darwin asset built with VERSION=tag GOOS=darwin"
check '[ ! -e "$FAKE/bin" ]' "nothing written to <repo>/bin"
check '[ "$(git -C "$FAKE" worktree list | wc -l)" -eq 1 ]' "build worktree removed"
check '[[ "$LAST_OUT" == *"--prerelease"* ]]' "--prerelease passed to gh"
[ -n "$DIST" ] && rm -rf "$(dirname "$DIST")"
exit "$fail"

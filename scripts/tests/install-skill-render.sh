#!/usr/bin/env bash
# Render the /wl skill with scripts/install-skill.sh into a throwaway repo copy: without bin/wl
# it must refuse, with bin/wl the result is diffed against scripts/tests/expected/SKILL.go.posix.md.
# The temp repo path is replaced by @ROOT@ before diffing. Windows: install-skill-render.ps1.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXPECTED="$REPO_ROOT/scripts/tests/expected"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAKE="$WORK/repo"
mkdir -p "$FAKE/scripts" "$FAKE/skills/wl"
cp "$REPO_ROOT/scripts/install-skill.sh" "$FAKE/scripts/"
cp "$REPO_ROOT/skills/wl/SKILL.template.md" "$FAKE/skills/wl/"
FAKE="$(cd "$FAKE" && pwd -P)"

fail=0
got=0
out="$(CLAUDE_CONFIG_DIR="$WORK/config-none" bash "$FAKE/scripts/install-skill.sh" 2>&1)" || got=$?
if [ "$got" -ne 0 ] && [[ "$out" == *"make -C collector build"* ]] && [ ! -e "$WORK/config-none/skills/wl/SKILL.md" ]; then
  echo "PASS no bin/wl: refused"
else
  echo "FAIL no bin/wl: want a non-zero exit naming 'make -C collector build' and no SKILL.md, got exit=$got:"
  echo "$out" | sed 's/^/    /'; fail=1
fi

mkdir -p "$FAKE/bin" && printf '#!/bin/sh\n' > "$FAKE/bin/wl" && chmod +x "$FAKE/bin/wl"
CLAUDE_CONFIG_DIR="$WORK/config-go" bash "$FAKE/scripts/install-skill.sh"
awk -v root="$FAKE" '{
  while ((i = index($0, root)) > 0) $0 = substr($0, 1, i - 1) "@ROOT@" substr($0, i + length(root))
  print
}' "$WORK/config-go/skills/wl/SKILL.md" > "$WORK/SKILL.go.md"
if diff -u "$EXPECTED/SKILL.go.posix.md" "$WORK/SKILL.go.md"; then
  echo "PASS go"
else
  echo "FAIL go"; fail=1
fi
exit "$fail"

#!/usr/bin/env bash
# Render skills/wl/SKILL.template.md into <claude config dir>/skills/wl/SKILL.md with this
# checkout's absolute path substituted for __WORKLOG_ROOT__, and __WL__ rendered as the Go
# binary <root>/bin/wl, which must exist (make -C collector build). Re-run after editing the
# template or moving the repository.
# Windows: scripts/install-skill.ps1.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$REPO_ROOT/skills/wl/SKILL.template.md"
TARGET_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/wl"
TARGET="$TARGET_DIR/SKILL.md"

[ -f "$TEMPLATE" ] || { echo "template not found: $TEMPLATE" >&2; exit 1; }

if ! [ -f "$REPO_ROOT/bin/wl" ] || ! [ -x "$REPO_ROOT/bin/wl" ]; then
  echo "bin/wl not found: $REPO_ROOT/bin/wl; build it first: make -C collector build" >&2
  exit 1
fi
WL="\"$REPO_ROOT/bin/wl\""

# Older installs made the skill directory (or the file) a symlink into the repo. Writing
# through it would overwrite the template, so drop any link first ([ -L ] is also true
# for a dangling link).
[ -L "$TARGET_DIR" ] && rm "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
[ -L "$TARGET" ] && rm "$TARGET"

# The template's leading HTML comment (and the blank line after it) describes the template
# itself; strip it from the rendered copy. Literal index/substr replacement, because both
# sed and awk's gsub give & and | special meaning inside the path.
awk -v root="$REPO_ROOT" -v wl="$WL" '
  /^<!-- template:/ { skip = 1 }
  skip { if (/-->$/) { skip = 0; eat_blank = 1 }; next }
  eat_blank { eat_blank = 0; if ($0 == "") next }
  {
    ph = "__WL__"
    while ((i = index($0, ph)) > 0) $0 = substr($0, 1, i - 1) wl substr($0, i + length(ph))
    ph = "__WORKLOG_ROOT__"
    while ((i = index($0, ph)) > 0) $0 = substr($0, 1, i - 1) root substr($0, i + length(ph))
    print
  }
' "$TEMPLATE" > "$TARGET"

if grep -qE "__WORKLOG_ROOT__|__WL__" "$TARGET"; then
  echo "placeholder left unrendered in $TARGET" >&2
  exit 1
fi

echo "Installed: $TARGET (worklog root: $REPO_ROOT, wl: bin/wl)"

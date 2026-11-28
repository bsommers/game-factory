#!/bin/sh
# game-factory bootstrap: check the machine, verify the factory works, optionally scaffold a first game.
# Safe to re-run. Works for humans (readable) and AI agents (--json, stable exit codes, no prompts).
#
#   scripts/bootstrap.sh                          check prerequisites + smoke-test the factory
#   scripts/bootstrap.sh --new <dir> "<Title>"    ...then scaffold a web game (default) into <dir>
#   scripts/bootstrap.sh --new <dir> "<Title>" --godot   scaffold a Godot game instead
#   scripts/bootstrap.sh --link                   also symlink bin/factory into ~/.local/bin
#   scripts/bootstrap.sh --json                   machine-readable report on stdout
#
# exit: 0 ready, 1 a required check failed, 2 bad usage, 4 target dir already exists
set -eu
FACT="$(cd "$(dirname "$0")/.." && pwd)"
NEW=""; TITLE=""; GODOT=0; LINK=0; JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --new) NEW="${2:-}"; TITLE="${3:-}"; [ -n "$NEW" ] && [ -n "$TITLE" ] || { echo "usage: --new <dir> \"<Title>\"" >&2; exit 2; }; shift 3 ;;
    --godot) GODOT=1; shift ;;
    --link) LINK=1; shift ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done
[ -n "$NEW" ] && [ -e "$NEW" ] && { echo "$NEW already exists; pick a new directory" >&2; exit 4; }

REPORT=""; FAIL=0
add() { # name status detail   (status: ok|warn|fail)
  REPORT="$REPORT$1|$2|$3
"
  [ "$2" = fail ] && FAIL=1
  [ "$JSON" = 1 ] || printf '  %-5s %-16s %s\n' "[$2]" "$1" "$3"
}
[ "$JSON" = 1 ] || echo "game-factory bootstrap ($FACT)"

# required: node >= 18, git
if command -v node >/dev/null 2>&1; then
  NV=$(node -p 'process.versions.node')
  if [ "${NV%%.*}" -ge 18 ]; then add node ok "v$NV"; else add node fail "v$NV; need 18+"; fi
else add node fail "not found; install Node 18+"; fi
command -v git >/dev/null 2>&1 && add git ok "$(git --version)" || add git fail "not found"

# optional: only needed for particular workflows
opt() { # name cmd why
  if command -v "$2" >/dev/null 2>&1; then add "$1" ok "$(command -v "$2")"; else add "$1" warn "missing; $3"; fi
}
CHROME=""
for c in google-chrome chromium chromium-browser chrome; do command -v "$c" >/dev/null 2>&1 && CHROME=$c && break; done
[ -n "$CHROME" ] && add chrome ok "$CHROME" || add chrome warn "missing; needed for 'shot' screenshots of web games"
opt godot godot "Godot games only; tools/install_godot.sh downloads it"
opt blender blender "optional; procedural 3D model builders"
opt inkscape inkscape "optional; brand-kit PNGs"
opt convert convert "optional; contact sheets (ImageMagick)"

if [ "$FAIL" = 0 ]; then
  # smoke test: the registry loads and the CLI answers
  if OUT=$("$FACT/bin/factory" capabilities --json 2>&1); then
    N=$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const d=j.data;console.log((d.capabilities||d).length)})' 2>/dev/null || echo "?")
    add capabilities ok "$N registered"
  else add capabilities fail "bin/factory capabilities failed: $(printf '%s' "$OUT" | head -1)"; fi
fi

if [ "$FAIL" = 0 ] && [ "$LINK" = 1 ]; then
  mkdir -p "$HOME/.local/bin" && ln -sf "$FACT/bin/factory" "$HOME/.local/bin/factory"
  add link ok "~/.local/bin/factory -> bin/factory$(case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo ' (add ~/.local/bin to PATH)';; esac)"
fi

CREATED=""
if [ "$FAIL" = 0 ] && [ -n "$NEW" ]; then
  if [ "$GODOT" = 1 ]; then SC=""; else SC="--web"; fi
  # shellcheck disable=SC2086
  if "$FACT/bin/factory" new "$NEW" "$TITLE" $SC >/dev/null 2>&1; then
    CREATED=$(cd "$NEW" && pwd); add scaffold ok "$CREATED"
    sed "s#__NAME__#$TITLE#g; s#__FACTORY__#$FACT#g" "$FACT/templates/AGENTS.game.md" > "$CREATED/AGENTS.md" && add agents-md ok "$CREATED/AGENTS.md"
  else add scaffold fail "factory new failed; run: bin/factory new \"$NEW\" \"$TITLE\" $SC"; fi
fi

if [ "$FAIL" = 0 ]; then
  if [ -n "$CREATED" ]; then
    NEXT="cd $CREATED
$FACT/bin/factory guide check --json     # what to do next in the new game
$FACT/bin/factory guide route \"<your goal>\" --json"
  else
    NEXT="$FACT/bin/factory guide route \"<your goal>\" --json   # ranked skills/capabilities/kits
$FACT/bin/factory new <dir> \"<Title>\" --web      # scaffold a browser game
$FACT/bin/factory capabilities --json              # everything the factory can do
read AGENTS.md and docs/GUIDE.md"
  fi
fi

if [ "$JSON" = 1 ]; then
  printf '%s' "$REPORT" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const checks=s.split("\n").filter(Boolean).map(l=>{const [name,status,...r]=l.split("|");return{name,status,detail:r.join("|")}});
      const [factory,created,next]=process.argv.slice(1);
      console.log(JSON.stringify({ok:!checks.some(c=>c.status==="fail"),factory,created:created||null,checks,next:next?next.split("\n"):[]},null,2));
    })' "$FACT" "$CREATED" "${NEXT:-}"
else
  if [ "$FAIL" = 0 ]; then printf '\nready. next:\n%s\n' "$NEXT" | sed 's/^\([^\n]\)/  \1/'; else echo; echo "not ready: fix the [fail] items above and re-run."; fi
fi
exit "$FAIL"

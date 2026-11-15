#!/bin/sh
# Headless playthrough QA: tools/qa.sh [level|all] [--limit=SECONDS] [--secrets] [--shots]
# Plays each level (default e1m1..e1m6) with the QA bot at a fixed 60 fps sim step and a fixed seed,
# prints a summary table. --shots renders tools/shot.sh at each level's exit into out/qa/. Logs: out/qa/<level>.log
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEVELS="e1m1 e1m2 e1m3 e1m4 e1m5 e1m6"; LIMIT=420; SECRETS=""; SHOTS=0; SEED=1234; SKILL=""
for a in "$@"; do
  case "$a" in
    all) ;;
    e1m[1-6]) LEVELS="$a";;
    --limit=*) LIMIT="${a#--limit=}";;
    --skill=*) SKILL="--skill=${a#--skill=}";;
    --seed=*) SEED="${a#--seed=}";;
    --secrets) SECRETS="--secrets";;
    --shots) SHOTS=1;;
    *) echo "usage: $0 [e1mN|all] [--limit=S] [--seed=N] [--secrets] [--shots] [--skill=0..3]" >&2; exit 2;;
  esac
done
OUT="$ROOT/out/qa"; mkdir -p "$OUT"
timeout 300 "$ROOT/tools/godot.sh" --headless --path "$ROOT/game" --import >/dev/null 2>&1 || true
FAILS=0; ROWS=""
for L in $LEVELS; do
  LOG="$OUT/$L.log"
  timeout 900 "$ROOT/tools/godot.sh" --headless --fixed-fps 60 --path "$ROOT/game" --script res://scripts/qa/qa_run.gd -- --level=$L --limit=$LIMIT --seed=$SEED $SECRETS $SKILL >"$LOG" 2>&1
  RC=$?
  JSON="$(grep '^QA_RESULT ' "$LOG" | tail -1 | sed 's/^QA_RESULT //')"
  [ -n "$JSON" ] && printf '%s\n' "$JSON" >"$OUT/$L.json" || { echo "{\"level\":\"$L\",\"reached_exit\":false,\"reason\":\"no result (rc=$RC, crash/timeout)\"}" >"$OUT/$L.json"; }
  EXTRA=$(grep -cE 'SCRIPT ERROR|^ERROR:|^WARNING:' "$LOG")
  [ "$RC" -eq 0 ] || FAILS=$((FAILS+1))
  if [ "$SHOTS" = 1 ] && [ -n "$JSON" ]; then
    CAM=$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));const p=r.final_pos||[0,0,0];console.log([p[0],1.7,p[2],r.final_yaw||0,0].join(","))' "$OUT/$L.json")
    "$ROOT/tools/shot.sh" "$L" "$OUT/${L}_exit.png" --cam "$CAM" --size 1280x720 2>&1 | tail -3
  fi
done
node -e '
const fs=require("fs"),[,out,lv,fails]=process.argv;
const pad=(s,n)=>String(s).padEnd(n);
console.log(pad("level",6)+pad("exit",5)+pad("sim_s",7)+pad("kills",9)+pad("dead",5)+pad("pick",5)+pad("stuck",6)+pad("err",4)+pad("warn",5)+pad("ms avg/max",12)+"reason");
for(const l of lv.split(" ")){let r;try{r=JSON.parse(fs.readFileSync(`${out}/${l}.json`))}catch(e){r={level:l,reason:"unreadable"}}
console.log(pad(l,6)+pad(r.reached_exit?"YES":"no",5)+pad(r.sim_time??"-",7)+pad((r.kills??"-")+"/"+(r.kills_total??"-"),9)+pad(r.deaths??"-",5)+pad(r.pickups??"-",5)+pad(r.stuck_events??"-",6)+pad(r.errors??"-",4)+pad(r.warnings??"-",5)+pad((r.frame_ms_avg??"-")+"/"+(r.frame_ms_max??"-"),12)+(r.reason||""));}
' "$OUT" "$LEVELS" "$FAILS"
[ "$FAILS" -eq 0 ]

#!/bin/sh
# game-factory CLI.  usage:
#   bin/factory new <dir> "<Game Title>"   scaffold a new Godot game repo with tooling, swarm tracker and templates
#   bin/factory new <dir> "<Game Title>" --web   scaffold a zero-dependency browser (Canvas/ES-module) game with serve/shot tools + tracker
#       [--with kits=art,audio,fx,character,docs,raytrace | kits=all]   opt-in content kits (default: none; src/lib is always copied)
#       [--solo]   no swarm tracker/SWARM.md/PLAYBOOK; marks package.json game.solo so `guide check` treats swarm gaps as info
#   bin/factory sync <dir>                 refresh tools/ and swarm/ in an existing game repo from this factory
set -eu
FACT="$(cd "$(dirname "$0")/.." && pwd)"
cmd="${1:-}"
sync_tools() { # $1 = target dir
  mkdir -p "$1/tools" "$1/tools/swarm-tracker"
  cp "$FACT"/tools/*.sh "$FACT"/tools/*.mjs "$1/tools/"
  cp -r "$FACT"/swarm/bin "$FACT"/swarm/dashboard "$1/tools/swarm-tracker/"
}
sync_web_pkg() { # $1 = target dir: build + desktop packaging + installers for web games
  mkdir -p "$1/tools"
  cp "$FACT"/tools/web/pkg/build-web.mjs "$FACT"/tools/web/pkg/package-desktop.mjs "$FACT"/tools/web/pkg/project-info.mjs "$1/tools/"
  rm -rf "$1/tools/desktop"; cp -r "$FACT/tools/web/pkg/desktop" "$1/tools/desktop"
}
# web scaffold helpers
KIT_NAMES="art character audio fx docs raytrace"
kit_dir() { echo "$1-kit"; }
kit_has() { case " $KITS " in *" $1 "*) return 0;; esac; return 1; }
kit_add() { kit_has "$1" || KITS="$KITS $1"; }
parse_kits() { # $1 = comma list; sets KITS (space separated, dependencies resolved)
  KITS=""
  for k in $(printf '%s' "$1" | tr ',' ' '); do
    k="${k%-kit}"
    case "$k" in
      all) for a in $KIT_NAMES; do kit_add "$a"; done;;
      none|"") ;;
      art|character|audio|fx|docs|raytrace) kit_add "$k";;
      *) echo "unknown kit \"$k\"; valid: $(echo $KIT_NAMES | tr ' ' ','),all" >&2; exit 2;;
    esac
  done
  # character-kit and fx-kit import art-kit
  if kit_has character || kit_has fx; then kit_add art; fi
}
copy_kits() { # $1 = target dir; copies only the requested kits, matching tests/examples and a barrel
  [ -n "${KITS# }" ] || return 0
  T="$FACT/templates/web-project/src/kits"; mkdir -p "$1/src/kits/examples"
  for k in $KITS; do cp -r "$T/$(kit_dir "$k")" "$1/src/kits/"; done
  printf '// Kit barrel (only the kits this game opted into). Import by name: import { packSheet } from "./kits/index.js"\n' > "$1/src/kits/index.js"
  for k in $KITS; do [ "$k" = raytrace ] || echo "export * as $k from './$(kit_dir "$k")/index.js';" >> "$1/src/kits/index.js"; done
  kit_has art && kit_has fx && cp "$T/examples/art-and-fx.mjs" "$1/src/kits/examples/"
  kit_has character && cp "$T/examples/colby-rig.mjs" "$1/src/kits/examples/"
  kit_has audio && cp "$T/examples/pawfall-songs.mjs" "$1/src/kits/examples/"
  kit_has docs && cp "$T/examples/docs-config.example.json" "$1/src/kits/examples/"
  rmdir "$1/src/kits/examples" 2>/dev/null || true
}
prune_kit_tests() { # $1 = target dir; drop template kit tests for kits that were not copied
  for k in art character audio fx docs; do kit_has "$k" || rm -f "$1/test/kits/$(kit_dir "$k").test.mjs"; done
  rmdir "$1/test/kits" 2>/dev/null || true
}
finish_pkg() { # $1 = target dir; solo flag in package.json (test script is recursive `node --test test/`; unused kit tests are pruned above)
  node -e '
    const fs=require("fs"),p=process.argv[1]+"/package.json",j=JSON.parse(fs.readFileSync(p,"utf8"));
    const [,,kits,solo]=process.argv;
    if(solo==="1"){delete j.scripts.plan;delete j.scripts.tracker;j.game={...j.game,solo:true};}
    fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n");' "$1" "${KITS# }" "$SOLO"
}

case "$cmd" in
  new)
    D="${2:?usage: factory new <dir> \"<Title>\" [--web] [--with kits=a,b] [--solo]}"; NAME="${3:-My Game}"
    [ -e "$D" ] && { echo "$D exists" >&2; exit 1; }
    WEB=0; SOLO=0; KITS=""; [ $# -ge 3 ] && shift 3 || shift 2
    while [ $# -gt 0 ]; do
      case "$1" in
        --web) WEB=1;;
        --solo) SOLO=1;;
        --with) shift; [ $# -gt 0 ] || { echo "--with needs kits=a,b" >&2; exit 2; }; case "$1" in kits=*) parse_kits "${1#kits=}";; *) echo "unknown --with value \"$1\" (use kits=a,b)" >&2; exit 2;; esac;;
        --with=kits=*) parse_kits "${1#--with=kits=}";;
        *) echo "unknown option $1" >&2; exit 2;;
      esac
      shift
    done
    if [ "$WEB" = 0 ] && { [ "$SOLO" = 1 ] || [ -n "${KITS# }" ]; }; then echo "--solo and --with kits=... apply to --web games only" >&2; exit 2; fi
    if [ "$WEB" = 1 ]; then
      mkdir -p "$D/src" "$D/test" "$D/docs" "$D/tools"; [ "$SOLO" = 1 ] || mkdir -p "$D/docs/swarm"
      sync_tools "$D"; [ "$SOLO" = 1 ] && rm -rf "$D/tools/swarm-tracker"; (cd "$D/tools" && rm -f *.sh fetch_assets.mjs); cp "$FACT"/tools/web/*.sh "$D/tools/"; cp "$FACT"/tools/web/*.mjs "$D/tools/"
      for f in index.html style.css src/main.js; do sed "s#__NAME__#$NAME#g" "$FACT/templates/web-project/$f" > "$D/$f"; done
      mkdir -p "$D/scripts"; cp "$FACT/templates/web-project/scripts/verify.sh" "$D/scripts/verify.sh"; chmod +x "$D/scripts/verify.sh"
      cp "$FACT/templates/web-project/package.json" "$D/package.json"; sed -i "s#\"name\": \"game\"#\"name\": \"$(printf '%s' "$NAME" | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9][^a-z0-9]*/-/g; s/^-//; s/-$//')\"#" "$D/package.json"; sync_web_pkg "$D"; cp -r "$FACT"/templates/web-project/test/* "$D/test/"
      # lib tests that read factory-root spec/ or test/helpers only make sense inside the factory; do not ship them
      grep -rlE "(\.\./){4}(spec|test)/" "$D/test" 2>/dev/null | xargs -r rm -f
      prune_kit_tests "$D"; copy_kits "$D"; cp -r "$FACT/templates/web-project/src/lib" "$D/src/lib"; finish_pkg "$D"
      SLUG=$(printf '%s' "$NAME" | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9][^a-z0-9]*/-/g; s/^-//; s/-$//'); SLUG="${SLUG:-game}"
      for sub in core levels ui; do cp -r "$FACT/templates/web-project/src/$sub" "$D/src/$sub"; done
      sed -i "s#__SLUG__#$SLUG#g; s#__NAME__#$NAME#g" "$D"/src/core/*.js "$D"/src/ui/*.js
      cp "$FACT/docs/KITS.md" "$D/docs/KITS.md"
      cp "$FACT/swarm/templates/LEARNINGS.md" "$D/docs/LEARNINGS.md"
      if [ "$SOLO" = 1 ]; then
        printf '# Solo mode\n\nThis game was scaffolded with `--solo`: one author, no agent swarm. There is no swarm tracker, `docs/swarm/SWARM.md` or PLAYBOOK, and `package.json` has `"game": {"solo": true}`.\n`factory guide check` reports swarm gaps (tracker, ARCHITECTURE.md, manifest) as info instead of warnings.\n\nTo go multi-agent later: remove `game.solo` from package.json, run `factory sync .`, copy `swarm/templates/SWARM.md` to `docs/swarm/SWARM.md`, and read `PLAYBOOK.md`.\n' > "$D/docs/SOLO.md"
        printf '.tracker/\nout/\ndist/\nassets-cache/\n*.log\nnode_modules/\n' > "$D/.gitignore"
      else
        cp "$FACT/swarm/templates/SWARM.md" "$D/docs/swarm/SWARM.md"; cp "$FACT/swarm/templates/CHECKPOINT.md" "$D/docs/CHECKPOINT.md"; cp "$FACT/swarm/PLAYBOOK.md" "$D/docs/PLAYBOOK.md"
        printf '.tracker/\nout/\ndist/\nassets-cache/\n*.log\nnode_modules/\ndocs/CHECKPOINT.md\ndocs/swarm/prompts/\ndocs/swarm/progress/\n' > "$D/.gitignore"
      fi
      # AGENTS.md for the new game (swarm-only lines are dropped for --solo)
      sed "s#__NAME__#$NAME#g; s#__FACTORY__#$FACT#g" "$FACT/templates/AGENTS.game.md" | { if [ "$SOLO" = 1 ]; then sed '/<!-- swarm -->/d'; else sed 's/ *<!-- swarm -->//'; fi; } > "$D/AGENTS.md"
      KITLINE="none (opt-in: re-scaffold with \`--with kits=art,audio,fx,character,docs\` or copy from \`$FACT/templates/web-project/src/kits/\`)"; [ -n "${KITS# }" ] && KITLINE="$(echo $KITS | tr ' ' ',')"
      { printf '# %s\n\nScaffolded by `game-factory new --web%s`. `npm start` serves the game (port 4781), `npm test` runs the suites.\n' "$NAME" "$([ "$SOLO" = 1 ] && echo ' --solo')"
        [ "$SOLO" = 1 ] || printf '`npm run plan` then `npm run tracker` opens the swarm tracker (port 4780).\n'
        printf '\n- Kits: %s. Catalogue and API: `docs/KITS.md`. Reuse a kit before writing a new system.\n- Not sure what exists? `%s/bin/factory guide route "<goal>" --json` ranks skills, capabilities, kits and assets. `AGENTS.md` has the full loop.\n' "$KITLINE" "$FACT"; } > "$D/README.md"
      (cd "$D" && git init -q -b main); echo "created web game $D"; exit 0
    fi
    mkdir -p "$D/game/autoload" "$D/game/tests" "$D/docs/swarm" "$D/assets-src"
    sync_tools "$D"
    cp "$FACT"/templates/godot-project/autoload/*.gd "$D/game/autoload/"
    cp "$FACT"/templates/godot-project/tests/* "$D/game/tests/"
    sed "s#__NAME__#$NAME#" "$FACT/templates/godot-project/project.godot.tmpl" > "$D/game/project.godot"
    cp "$FACT/swarm/templates/SWARM.md" "$D/docs/swarm/SWARM.md"
    cp "$FACT/swarm/templates/CHECKPOINT.md" "$D/docs/CHECKPOINT.md"
    cp "$FACT/swarm/templates/LEARNINGS.md" "$D/docs/LEARNINGS.md"
    cp "$FACT/swarm/PLAYBOOK.md" "$D/docs/PLAYBOOK.md"
    printf '.tools/\n.tracker/\n.godot/\nbuild/\ndist/\nout/\nassets-cache/\n*.log\nnode_modules/\ndocs/CHECKPOINT.md\ndocs/swarm/prompts/\ndocs/swarm/progress/\n' > "$D/.gitignore"
    printf '# %s\n\nScaffolded by game-factory. Next: tools/install_godot.sh, write ARCHITECTURE.md (the contract), edit docs/swarm/SWARM.md, then\n`TRACKER_ROOT=$PWD node tools/swarm-tracker/bin/swarm-plan.mjs` and `TRACKER_ROOT=$PWD TRACKER_PORT=4790 node tools/swarm-tracker/dashboard/server.mjs`.\n' "$NAME" > "$D/README.md"
    (cd "$D" && git init -q -b main)
    echo "created $D  (run: cd $D && tools/install_godot.sh)";;
  sync)
    D="${2:?usage: factory sync <dir>}"; sync_tools "$D"; [ -f "$D/index.html" ] && { (cd "$D/tools" && rm -f *.sh fetch_assets.mjs); cp "$FACT"/tools/web/*.sh "$FACT"/tools/web/*.mjs "$D/tools/"; sync_web_pkg "$D"; }; echo "synced tools into $D";;
  *) sed -n '2,5p' "$0"; exit 2;;
esac

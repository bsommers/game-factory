# Pawgger factory proposals

## Index

| # | Agent | NEW/MODIFIES | Target path in factory | Staged file under proposed/pawgger/ |
|---|-------|--------------|------------------------|-------------------------------------|
| 1 | painter-kit | NEW | src/kits/painter-kit/, styles/presets/ghibli-painterly/ | new/src/kits/painter-kit/, new/styles/presets/ghibli-painterly/ |
| 2 | orchestrator | NOTE | web template sheet.mjs vs array ART manifests (defs.artManifest object form) | none (note; covered by row 7) |
| 3 | pixctx-kit | NEW | src/kits/pixctx-kit/ | new/src/kits/pixctx-kit/index.js |
| 4 | audio-kit | NEW | src/kits/audio-kit/live-music.js | new/src/kits/audio-kit/live-music.js |
| 5 | ship-showcase | NEW + MODIFIES | skills/, docs/, templates/web-project/, bin/factory-scaffold.sh, guide, GUIDE.md, FACTORY-TOOLS.md, PLAYBOOK.md | new/skills/ship-showcase.md, new/docs/SHIP-SHOWCASE.md, new/templates/web-project/*, and the five *.proposed patches (bin_, docs_, factory-core_, swarm_, test_guide_) |
| 6 | orchestrator (ui-shell) | MODIFIES | tools/web/pkg/build-web.mjs | tools_web_pkg_build-web.mjs.proposed (staged by factory-extract, see entry below) |
| 7 | orchestrator (ui-shell) | MODIFIES | tools/web/sheet.mjs | tools_sheet.mjs.proposed |
| 8 | library-sprites | NEW | src/kits/library-sprites/, tools/extract-sheet-characters.mjs | new/src/kits/library-sprites/, new/tools/extract-sheet-characters.mjs |
| 9 | toon-kit | NEW | src/kits/toon-kit/ | new/src/kits/toon-kit/ |
| 10 | toon-library preset | NEW | styles/presets/toon-library/ | new/styles/presets/toon-library/ |
| 11 | orchestrator | NOTE | `factory library install` used verbatim | none |
| 12 | factory-extract | NEW | src/lib/grid-hop.js (+ test/lib/grid-hop.test.mjs) | new/src/lib/grid-hop.js, new/test/lib/grid-hop.test.mjs |
| 13 | factory-extract | NEW | src/lib/grid-hop-autopilot.js (+ test) | new/src/lib/grid-hop-autopilot.js, new/test/lib/grid-hop-autopilot.test.mjs |
| 14 | factory-extract | MODIFIES | tools/web/pkg/build-web.mjs (literal dynamic imports) | tools_web_pkg_build-web.mjs.proposed |
| 15 | factory-extract | MODIFIES | tools/web/shot.mjs (scratch under repo out/, not /tmp) | tools_web_shot.mjs.proposed |
| 16 | factory-extract | NOTE | lane-gen, Pawgger tools (botplay, validate-level, sfx-wav, music-wav) | none, deliberately not extracted |

Patch naming: `/` in the factory path becomes `_`; diffs use factory-relative paths, apply with `patch -p1` from the factory root. `tools_sheet.mjs.proposed` was written against the web-template path `tools/sheet.mjs`: apply it with `cd <factory>/tools/web && patch -p2 < ...`.

## Entries

### painter-kit | NEW src/kits/painter-kit/ and styles/presets/ghibli-painterly/ | new/src/kits/painter-kit/, new/styles/presets/ghibli-painterly/
Why: the factory has no painterly vector toolkit; cartoon-vector assumes thick outlines and flat fills. How Pawgger used it: every ghibli art module (characters, vehicles, river, world, fx) builds sprites from the kit's blob/cloud/leaf/washFill/softShadow/paperGrain primitives. How to adopt: copy the kit folder to src/kits/painter-kit/ (project needs "type":"module"), copy the preset folder to styles/presets/ghibli-painterly/ and add a row to docs/STYLES.md (`ghibli-painterly | top-down | canvas2d-vector | 896x1024 | free | procedural-webaudio | mid | 3/5 | 8-14 | Pawgger`). Tests: `node --test painter-kit.test.mjs` in the kit folder (with a type:module package.json above it) -> 6 pass; preset validated against styles/style.schema.json required keys (none missing, none extra).

### orchestrator | NOTE (no file yet) | web template `tools/sheet.mjs` vs array-style ART manifests
Why: `tools/sheet.mjs` expects `artManifest()` to return objects `{module,name,w,h,frames}`; Pawgger's `defs.ART` uses compact rows `[module,name,w,h,frames]`, so every sprite reported EXTRA. How Pawgger used it: `artManifest()` in defs.js maps rows to objects. How to adopt: either document the object requirement in the template, or make sheet.mjs accept both forms (a 3-line normalise). Tests: `node tools/sheet.mjs vehicles` prints OK after the change.

### pixctx-kit | NEW src/kits/pixctx-kit/ | new/src/kits/pixctx-kit/index.js
Why: renderers cannot be tested headless without a canvas; a tiny RGBA-backed Canvas2D shim lets Node tests render real frames, compare pixels for determinism and write PNGs. How Pawgger used it: test/render.test.mjs draws full frames (day/dusk/night, fallbacks) through createPixCtx and checks night < dusk < day brightness and frame-identical replays. How to adopt: copy the folder to src/kits/pixctx-kit/; `createPixCtx(w,h)`, `createPixCanvas`, `pixToPng(ctx, scale)` (needs art-kit). Tests: see Pawgger test/render.test.mjs (13 pass).

### audio-kit | NEW src/kits/audio-kit/live-music.js | new/src/kits/audio-kit/live-music.js
Why: scheduleSong skips drums and only plays pulse/tri as plain square/triangle with no looping; games need a seamless looping live player. How Pawgger used it: audio.js builds createLiveMusic(ctx, musicGain, {describe: describeMusic, style}) and drives play(name)/setStyle(); loops reschedule via a lookahead timer, stings play once (optional {then} resumes a loop). Generic: `describe(name, style)` must return describeSong()-shaped {events,length,loop}. How to adopt: copy the file, inject describe. Tests: Pawgger test/audio-wire.test.mjs (fake AudioContext). Not auditioned by ear.

### ship-showcase | NEW skill + web template files + wiring patches | new/skills/ship-showcase.md, new/docs/SHIP-SHOWCASE.md, new/templates/web-project/{README.template.md,shots.config.json,tools/shots.mjs,tools/make-gif.sh,.github/workflows/pages.yml,docs/README.md}
Why: every game should ship a snazzy README (banner, badges, hero GIF, dual-style screenshot grid) and a Pages site with the playable game, verified by 200s; this was ad hoc. How Pawgger used it: site-docs follows the skill. How to adopt: copy `new/*` into the factory root (skill to skills/, docs/, templates/); apply the `*.proposed` unified diffs with `patch -p1` from the factory root after renaming (bin_factory-scaffold.sh.proposed -> bin/factory-scaffold.sh, factory-core_guide_index.mjs.proposed -> factory-core/guide/index.mjs, docs_GUIDE.md / docs_FACTORY-TOOLS.md -> docs/, swarm_PLAYBOOK.md -> swarm/PLAYBOOK.md, test_guide_guide.test.mjs -> test/guide/guide.test.mjs); then run `node factory-core/guide/cli.mjs index` to regenerate skills/INDEX.json and Claude skill files. Effect: `factory new --web` scaffolds the files; `guide.check` gains errors `no-readme-shots`, `no-pages-workflow` and warning `no-hero`; the scaffold README stub fails the check until the real README is written. Tests: on a factory copy with everything applied, `node --test test/` 115 pass (guide 44, incl. a new showcase-rules test; the existing healthy-fixture test needed the three new files, included in the test patch); scaffolded game verified; `tools/shots.mjs --hero` on a stub page produced 6 PNGs + a 40-frame GIF (crop and palette path checked with ffprobe). Pawgger test/factory-sop.test.mjs: 8 checks. Not tested: a real push to GitHub Pages.

### orchestrator (from ui-shell) | MODIFIES tools/build-web.mjs (web template / PawFall copy) | not yet staged as a .proposed file
Why: the original single-file bundler installed its module map too late for top-level awaits and handled `import(variable)` by runtime lookup, so a game with `await import()` of optional modules 404'd in the bundle. Pawgger's `tools/build-web.mjs` bundles literal dynamic imports instead. How to adopt: copy Pawgger's `tools/build-web.mjs` over the template copy after review (factory-extract will stage it). Tests: `sh tools/smoke_web.sh` passes on dist/pawgger.html.

### orchestrator (from ui-shell) | MODIFIES tools/sheet.mjs (web template) | tools_sheet.mjs.proposed
Why: ghibli (smooth vector, canvas-only) art packs could not be validated headless; sheet.mjs only handled the retro PixBuf modules. What: adds `--style ghibli`: writes out/previews/ghibli-<file>.html, runs it in headless Chrome via tools/shot.mjs, checks names/frames/sizes against `artManifest()` with w/h multiplied by `GHIBLI_SCALE` (defs export), saves ghibli-<file>.png and prints OK. Retro mode is unchanged. How to adopt: `patch -p1 < tools_sheet.mjs.proposed` from the factory template root (unified diff against the pre-change sheet.mjs); needs tools/shot.mjs + serve.mjs, a `src/art/ghibli/<characters|vehicles|river|world|fx>.js` layout (edit MAP in ghibliMode for other layouts), and `GHIBLI_SCALE` in defs. Tests: `node tools/sheet.mjs colby|vehicles|river|world|fx --style ghibli` each prints OK in Pawgger.

### library-sprites | NEW src/kits/library-sprites/ + tools/extract-sheet-characters.mjs | new/src/kits/library-sprites/{index.js,README.md}, new/tools/extract-sheet-characters.mjs
Why: character-library assets are raster turnaround sheets; games need transparent per-view sprites with provenance. How Pawgger used it: `tools/extract-toon-characters.mjs` verifies installed assets against assets.lock.json, cuts front/side views (flood-fill cutout, enclosed-pocket removal, fringe snap), writes PNGs + manifest (CC0, sha256) + generated base64 module; art/toon/characters.js derives up/squash/drown/home frames in code. How to adopt: copy kit folder to src/kits/library-sprites/, copy the tool and edit ASSETS/splitX/captionY. Tests: Pawgger test/art-toon.test.mjs (cut-outs, PNG round trip, cutout). Needs ImageMagick `convert` for JPEG decoding only at extract time.

### toon-kit | NEW src/kits/toon-kit/ | new/src/kits/toon-kit/{index.js,README.md}
Why: restyle an existing painterly art pack as flat cartoon without redrawing. How Pawgger used it: src/art/toon/{vehicles,river,world,fx}.js are 3-line wrappers over the ghibli modules through toonKit. How to adopt: copy folder (needs painter-kit). Tests: Pawgger test/art-toon.test.mjs (manifest conformance for all modules, kit behaviour).

### toon-library style preset | NEW styles/presets/toon-library/ | new/styles/presets/toon-library/{style.json,THEMING.md}
Why: record the style (derived from cartoon-vector) with its kits and pitfalls. How to adopt: copy folder to styles/presets/, add a row to docs/STYLES.md (`toon-library | top-down | canvas2d-vector | 896x1024 | free | procedural-webaudio | mid | 2/5 | 4-8 | Pawgger`). Tests: style.json keys mirror cartoon-vector (not run through the schema validator).

### orchestrator note | Pawgger used `factory library install` (verbatim CLI, no live factory edits) to install both character-library assets into assets/library/ with assets.lock.json.

### factory-extract | NEW src/lib/grid-hop.js | new/src/lib/grid-hop.js, new/test/lib/grid-hop.test.mjs
Why: every Frogger/Crossy/Pac-style game needs hop-by-cell movement with a one-deep input buffer and a clamp hook; src/lib has platformer physics but no grid movement. How Pawgger used it: the player in src/sim uses startHop/stepHop/queueHop/takeQueued with limit() for screen bounds. How to adopt: `cp new/src/lib/grid-hop.js <factory>/templates/web-project/src/lib/` and the test to templates/web-project/test/lib/; add a "grid-hop.js" paragraph to src/lib/README.md and an export line to src/lib/index.js. Tests: `node --test test/lib/*.test.mjs` in a scratch copy: 4 pass.

### factory-extract | NEW src/lib/grid-hop-autopilot.js | new/src/lib/grid-hop-autopilot.js, new/test/lib/grid-hop-autopilot.test.mjs
Why: Pawgger's bot is an A* over hop macros but is welded to its lane model; this is the generalised core: a time-expanded A* over (col,row,tick) with injected `safe(col,row,tick)`, optional `canHop`, `carry` (platform drift) and admissible `h`. Returns a deterministic action list, plus `planDecider(plan)` for per-tick play. How Pawgger used it: not wired in (src/sim/autopilot.js stays the specimen, it mirrors game.js step order and bay rules); this is a clean-room extraction validated only on a toy road. How to adopt: copy next to grid-hop.js, add README paragraph. Tests: 5 pass (plan reaches goal, landing always safe, determinism, unreachable returns null, carry, decider). Not battle-tested on a real game.

### factory-extract | MODIFIES tools/web/pkg/build-web.mjs | tools_web_pkg_build-web.mjs.proposed
Completes the orchestrator (ui-shell) entry above, which says "not yet staged". Why: literal `import('./x.js')` modules must be bundled and the module map installed before top-level await. How to adopt: from the factory root `patch -p1 < proposed/pawgger/tools_web_pkg_build-web.mjs.proposed`. Tests: patch applied to a scratch copy of the live file gives a file byte-identical to Pawgger's tools/build-web.mjs (cmp); Pawgger `sh tools/smoke_web.sh` was reported passing by ui-shell.

### factory-extract | MODIFIES tools/web/shot.mjs | tools_web_shot.mjs.proposed
Why: default scratch dir was os.tmpdir() (RAM-backed /tmp on this machine; stray profiles filled it). Now `$SCRATCH` or `<repo>/out/shot-tmp`, still falling back to os.tmpdir() if missing. How to adopt: `patch -p1 < proposed/pawgger/tools_web_shot.mjs.proposed` from the factory root. Tests: patched copy is byte-identical to Pawgger tools/shot.mjs; Pawgger used it for all screenshots.

### factory-extract | NOTE | deliberately not extracted
lane-gen (src/levels/lanes.js, levels.js): the lane model, per-bay reachability and difficulty ramp are Pawgger rules; the reusable parts already exist as src/lib/world-gen.js (generator + validateWorld). tools/botplay.mjs, validate-level.mjs, sfx-wav.mjs, music-wav.mjs: thin wrappers over Pawgger modules (diff vs PawFall copies 22-304 lines of game-specific code). src/sim/autopilot.js: replaced by the generic planner above for reuse. Tracker (tools/swarm-tracker) is unchanged from its source.

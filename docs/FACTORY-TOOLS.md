# Game factory tooling (cheesefantasy/tools + game/tests)

Reusable pieces, born from real problems. Add to this list whenever a bug or manual routine becomes a tool.

| Tool | What it does | Born from |
|---|---|---|
| `tools/godot.sh` | project-local Godot 4.7.2 wrapper | setup |
| `tools/shot.sh <scene\|model:id> out.png` | real GPU frame in a private Xvfb, never the desktop; prints mean/std (std<0.01 = blank) | agents verifying visuals |
| `tools/shot_bevy.sh <level> out.png` | Bevy/wgpu game screenshot in a private Xvfb (X11 forced, Vulkan, `GAME_BIN`), needs `--level/--shot` in the game | Cheesemageddon DeviceLost under Wayland/Xvfb |
| `tools/fetch_textures.mjs [--config sets.json] [--res 1k\|2k]` | zero-dep Poly Haven CC0 PBR (color/normal/rough) + HDRI fetcher with slug fallbacks, writes MANIFEST.json + INDEX.md | Cheesemageddon photoreal levels |
| `tools/gen_audio.py [--out dir] [--only a,b]` | numpy-only procedural sfx/ambience/music WAV synth (FPS example set) | Cheesemageddon audio |
| `tools/build_fatniss.py` | example: procedural Blender character to rigged, animated glb (Idle/Run/Shoot) + `--verify` previews; run `blender --background --python` | Cheesemageddon Fatniss |
| `swarm/bin/tokens.mjs` | per-agent and total token/cost tracker feeding the dashboard (already in the factory) | Cheesemageddon cost tracking |
| `templates/bevy-fps-project/` | Rust + Bevy 0.20 FPS starter (see skill `rust-bevy-fps`) | Cheesemageddon |
| `game/scripts/battle_view/shot.sh` | battle harness: `--mode=idle\|menu\|vfx\|summon\|victory`, timed frames (needs absolute `--out`) | battle-presentation |
| `tools/cutscene_sheet.sh <summon\|all>` | captures 4 frames of a summon cinematic and tiles them to `out/show/summon_<id>.jpg` | reviewing cutscenes by hand |
| `tools/sheet.sh out.jpg COLS imgs...` | labelled contact sheet of any screenshots | reviewing galleries |
| `tools/run_tests.sh [filter]` | headless test suite (`game/tests/test_*.gd`) | rpg-core |
| `game/tests/test_facing.gd` | models face -Z: behavioural check + lint that every yaw `atan2` has `+PI` (verified to fail when the fix is reverted) | the "moonwalk" bug |
| `game/tests/qa_run.gd`, `scripts/qa/qa_validate.gd` | scripted full-quest bot; validates every encounter/recipe/summon | qa-bot |
| `tools/smoke_linux.sh` | unpack the SHIPPED tarball, run 600 headless frames, fail on any script/load error | build verification |
| `tools/smoke_windows.sh` | push zip to win-devvm, sha256 check, install, headless launch, uninstall, verify clean | build verification |
| `tools/build.sh`, `tools/package_*.sh` | export + installers (macOS needs `MAC_HOST`) | build-all |
| `tools/swarm-tracker/*` | swarm plan generator + live dashboard (:4782) | orchestration |
| `swarm/dashboard/*` (Media panel) | tracker Media section: audio list with players + server-side `/api/wav-peaks?f=out/sfx/x.wav` waveform peaks, media totals strip (sprites/frames/sfx/music/shots/GIFs), per-phase done/total agent bar; serves `out/` + `dist/` with Range | orchestration |
| `src/kits/art-kit` | PixBuf, palette lock, ASCII/draw-fn sprites, sheet packer + manifest validator, tiles/scenery, PNG | PawFall art modules |
| `src/kits/character-kit` | character spec (palette, poses, anims) to sprites + animator; Colby/Pete rigs as examples | PawFall colby.js |
| `src/kits/audio-kit` | SFX recipes, tracker songs, offline render, WAV, jingles, soundtrack map | PawFall sfx.js/music.js |
| `src/kits/fx-kit` | particles, shake, flash, popups, day-night sky, parallax, foreground silhouettes | PawFall render modules |
| `src/kits/docs-kit` | README / HOW-TO-PLAY / HOW-IT-WAS-MADE / Pages site generator fed by reports and screenshots | PawFall docs |
| `src/lib/platformer-physics.js` | fixed-step platformer core: gravity/jump, pits, one-way + moving platforms, ladders, pendulum rope grab, circular edge transitions | PawFall player.js/physics.js |
| `src/lib/hazard-kit.js` | hazard behaviour registry, contact resolution (lethal/points/solidTop), patroller/roller/cycler/spawner/taunting-boss patterns | PawFall hazards.js |
| `src/lib/world-gen.js` | seeded circular level generator from a rule table (ramp, set-pieces, spacing, collectibles) + fairness validator with a reachability predicate | PawFall levels/gen.js, validate-level |
| `src/lib/autopilot-kit.js` | look-ahead bot parts: trajectory, robust macro search, watchdog, skill humaniser | PawFall autopilot.js |

## Learnings worth reusing
- Pin the orientation convention (models face -Z) in the contract AND in a test; two agents guessed differently.
- Verify tools by reintroducing the bug (mutation check) before trusting them.
- A shot harness needs absolute output paths; random "blank frame" = a class not yet registered (run `--import`).
- Windows VM over ssh: create dirs before `push`, and wait in-session for detached deletes.
- Balance harnesses must use the gear actually available at that point of the story.
- Agents' "tests pass" claims: re-run suites yourself before committing.

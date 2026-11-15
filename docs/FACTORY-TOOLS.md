# Game factory tooling (cheesefantasy/tools + game/tests)

Reusable pieces, born from real problems. Add to this list whenever a bug or manual routine becomes a tool.

| Tool | What it does | Born from |
|---|---|---|
| `tools/godot.sh` | project-local Godot 4.7.2 wrapper | setup |
| `tools/shot.sh <scene\|model:id> out.png` | real GPU frame in a private Xvfb, never the desktop; prints mean/std (std<0.01 = blank) | agents verifying visuals |
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

## Learnings worth reusing
- Pin the orientation convention (models face -Z) in the contract AND in a test; two agents guessed differently.
- Verify tools by reintroducing the bug (mutation check) before trusting them.
- A shot harness needs absolute output paths; random "blank frame" = a class not yet registered (run `--import`).
- Windows VM over ssh: create dirs before `push`, and wait in-session for detached deletes.
- Balance harnesses must use the gear actually available at that point of the story.
- Agents' "tests pass" claims: re-run suites yourself before committing.

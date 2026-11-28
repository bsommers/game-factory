---
name: ship-showcase
description: Ship a snazzy README (banner, badges, hero GIF, dual-style screenshot grid) plus a GitHub Pages site with the playable game, and verify every URL returns 200.
triggers: [showcase, readme, screenshots, hero gif, github pages, pages, publish, ship, release, banner, badges, launch, play online, landing page]
needs: [tools/shot.mjs, ffmpeg, gh CLI, passing tests, shots.config.json]
outputs: [README.md, docs/hero.gif, docs/screenshots/, docs/index.html, .github/workflows/pages.yml, Pages URL]
model: sonnet
cost: low
capabilities: [guide.check]
kits: [docs-kit]
---
# Ship a showcase

Every game ends with a README that sells it and a Pages site where it can be played. Standard operating procedure; do it for every game.

## Steps
1. Scaffolded with `factory new --web`? You already have `README.template.md`, `shots.config.json`, `tools/shots.mjs`, `tools/make-gif.sh`, `.github/workflows/pages.yml`, `docs/`. Otherwise copy them from `templates/web-project/`.
2. Edit `shots.config.json`: one entry per screen worth showing (title, play, action, boss, game over), keys that reach it, and one `styles` row per art style (`?style=<id>`). Two styles gives the dual-style grid.
3. `node tools/shots.mjs` writes `docs/screenshots/<shot>-<style>.png`. Look at 3 of them: not blank, not the title screen thrice.
4. `node tools/shots.mjs --hero` captures frames and runs `tools/make-gif.sh` (crop first, palette GIF) to `docs/hero.gif`. Keep it under 5 MB (lower width, fps or frames).
5. Make `docs/banner.png` (wide crop of a title shot or a drawn logo). Fill `README.template.md` placeholders, save as `README.md`: banner, badges (play, Pages workflow, zero deps, tests, licence), hero GIF, dual-style grid, story, controls, architecture, swarm story, credits. Use real numbers (test count from `npm test`).
6. Landing page: `node src/kits/docs-kit/cli.mjs docs.config.json . --reports docs/swarm/reports --shots docs/screenshots` writes `docs/index.html`; link `play/`.
7. Parody and licence notes: state that the game is an affectionate parody, unaffiliated, with original art, music and code; add a LICENSE file; no third-party trademarks as logos.
8. `guide.check {project}` must show no `no-readme-shots`, `no-pages-workflow`, `no-hero` findings.
9. Commit, push, repo Settings, Pages, Source: GitHub Actions (`gh api -X POST repos/OWNER/REPO/pages -f build_type=workflow`). Watch the run: `gh run watch`.
10. Verify live: `curl -s -o /dev/null -w '%{http_code}\n'` on `<pages>/`, `<pages>/play/`, `<pages>/hero.gif` and one screenshot, each 200; then open `play/` and see the canvas animate.

## Gotchas
- Pages serves only the artifact: the workflow copies `index.html`, `src/` (and `assets/`) into `_site/play/`; absolute `/src/...` paths 404 under a repo subpath, use relative paths.
- Add `.nojekyll`; Pages is not served until the first workflow run finishes.
- `out/` is git-ignored; screenshots and the GIF live in `docs/` so they are committed.
- Headless capture needs a wait for the first frame (`wait` or `waitFor`); a blank PNG means too short.
- Crop before scaling; palette GIFs use `flags=neighbor` to keep pixel art crisp.
- Raw README images need relative paths so they render on GitHub and on Pages.

## Verification
Four URLs return 200, README renders with images on GitHub, hero GIF animates, `guide.check` clean, workflow run green.

# Ship-showcase checklist (SOP for every game)

Skill: `skills/ship-showcase.md`. Tools: `tools/shots.mjs`, `tools/make-gif.sh`. Config: `shots.config.json`.

- [ ] `shots.config.json` lists title, play, action (and boss / game over) shots and 2 styles
- [ ] `node tools/shots.mjs` ran; every PNG in `docs/screenshots/` looked at (not blank, distinct)
- [ ] `node tools/shots.mjs --hero` produced `docs/hero.gif` under 5 MB
- [ ] `docs/banner.png` present
- [ ] `README.md` filled from `README.template.md`: banner, badges, hero, screenshot grid, story, controls, architecture, swarm story, credits; no `{{` left
- [ ] Test count and numbers in README match `npm test`
- [ ] Parody disclaimer and LICENSE present; art/music original
- [ ] `docs/index.html` landing page links `play/`
- [ ] `.github/workflows/pages.yml` committed; Pages source set to GitHub Actions
- [ ] Workflow run green (`gh run watch`)
- [ ] 200 on `<pages>/`, `<pages>/play/`, `<pages>/hero.gif`, one screenshot (`curl -s -o /dev/null -w '%{http_code}'`)
- [ ] Opened `play/` and played one level
- [ ] `guide.check` shows no `no-readme-shots`, `no-pages-workflow`, `no-hero`

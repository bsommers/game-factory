---
name: write-docs-site
description: Generate README, HOW-TO-PLAY, HOW-IT-WAS-MADE and a GitHub Pages site from swarm reports and screenshots with docs-kit.
triggers: [docs, documentation, readme, how to play, how it was made, site, pages site, website, write docs, screenshots, report, documenting]
needs: [docs/swarm/reports/*.md, out/shots]
outputs: [README.md, docs/HOW-TO-PLAY.md, docs/HOW-IT-WAS-MADE.md, docs/index.html]
model: haiku
cost: low
capabilities: []
kits: [docs-kit]
---
# Docs and site

## Steps
1. Copy `examples/docs-config.example.json` to `docs.config.json`; fill title, tagline, controls.
2. Take screenshots with `tools/shot.mjs` into `out/shots`.
3. `node src/kits/docs-kit/cli.mjs docs.config.json . --reports docs/swarm/reports --shots out/shots`.
4. Hand-check numbers (counts, tests, sprites) against reality before committing.

## Gotchas
- Strip HTML comments before regex-scanning docs in tests.
- Every report needs a "What I built" section; the site uses it.
- Template engine: `{{.}}` on a primitive list item returns the item.

## Verification
Open `docs/index.html` locally; links resolve; doc tests pass.

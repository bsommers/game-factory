<!-- Scaffolded by the ship-showcase skill. Replace every {{...}} and delete this comment.
     Screenshots come from `node tools/shots.mjs`, the hero from `node tools/shots.mjs --hero && sh tools/make-gif.sh`. -->
<p align="center"><img src="docs/banner.png" alt="{{TITLE}} banner" width="100%"></p>

<h1 align="center">{{TITLE}}</h1>
<p align="center"><b>{{TAGLINE}}</b></p>

<p align="center">
  <a href="{{PAGES_URL}}play/"><img alt="Play" src="https://img.shields.io/badge/play-in%20browser-ff8a00"></a>
  <a href="https://github.com/{{OWNER}}/{{REPO}}/actions/workflows/pages.yml"><img alt="Pages" src="https://github.com/{{OWNER}}/{{REPO}}/actions/workflows/pages.yml/badge.svg"></a>
  <img alt="zero deps" src="https://img.shields.io/badge/dependencies-0-brightgreen">
  <img alt="tests" src="https://img.shields.io/badge/tests-{{TEST_COUNT}}%20passing-brightgreen">
  <img alt="licence" src="https://img.shields.io/badge/licence-{{LICENCE}}-blue">
</p>

<p align="center"><img src="docs/hero.gif" alt="{{TITLE}} gameplay" width="640"></p>

## Play it

**[{{PAGES_URL}}play/]({{PAGES_URL}}play/)** (keyboard; works offline once loaded). Locally: `npm start`, open http://127.0.0.1:4781/.

## Screenshots

| Style: classic | Style: alt |
|---|---|
| ![title classic](docs/screenshots/title-classic.png) | ![title alt](docs/screenshots/title-alt.png) |
| ![play classic](docs/screenshots/play-classic.png) | ![play alt](docs/screenshots/play-alt.png) |
| ![action classic](docs/screenshots/action-classic.png) | ![action alt](docs/screenshots/action-alt.png) |

## The story

{{STORY}}

## Controls

| Key | Action |
|---|---|
| {{CONTROLS}} | |

## How it is built

{{ARCHITECTURE_BLURB}} See [ARCHITECTURE.md](ARCHITECTURE.md). No dependencies, no build step: ES modules, Canvas 2D, procedural art and WebAudio.

```
npm start      # serve on :4781
npm test       # node:test suites
node tools/shots.mjs               # refresh screenshots
node tools/shots.mjs --hero && sh tools/make-gif.sh   # refresh hero GIF
```

## Built by an agent swarm

{{SWARM_STORY}} Reports and mistakes: [docs/swarm/reports](docs/swarm/reports), [docs/LEARNINGS.md](docs/LEARNINGS.md).

## Credits and notes

{{CREDITS}} {{TITLE}} is an affectionate parody and is not affiliated with or endorsed by the owners of any game or trademark it riffs on; all art, music and code are original. Licence: {{LICENCE}}.

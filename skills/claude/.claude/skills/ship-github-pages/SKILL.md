---
name: ship-github-pages
description: Build the web game and ship it with its docs site to GitHub Pages (play/ build output, docs/ folder, repo push). Use when: ship, deploy, release, github pages, pages, publish game.
---

# Ship to GitHub Pages

## Steps
1. `npm test` green; `guide.check` reports no errors.
2. Build the web package (`tools/web/pkg`) into the folder Pages serves; relative `play/` links need the build output there.
3. Generate docs (`write-docs-site`), commit, push.
4. Settings, Pages, branch main, folder /docs (or deploy `docs/site`). Add a build step; nothing builds it automatically.
5. Open the URL and play one level.

## Gotchas
- Pages serves only the configured folder; copy build output into it.
- No CDN use: vendor every script.
- Do not commit secrets, `.tracker/`, `out/`.

## Verification
Pages URL returns 200 and the canvas animates.

Suggested model: sonnet (cost low). Factory capabilities: guide.check.

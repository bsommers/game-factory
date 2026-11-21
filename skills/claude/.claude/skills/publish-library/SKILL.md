---
name: publish-library
description: Create, validate, index and publish an asset library repo from a game project's art, sfx and songs. Use when: publish library, create library, new library, share assets, export assets, library.new.
---

# Publish a library

## Steps
1. `library.new {name, dir, description, license, author}`.
2. `library.add {library, from: {project, adapter: "pixbuf-web", style, game}}` imports sprites, characters, tilesets, fx, sfx, songs with previews.
3. `library.validate {library}` then `library.index {library}`.
4. Plan the push: `library.publish {library, repo, visibility: "private"}` returns a CONFIRM_REQUIRED plan; run again with `yes: true` only after the user agrees.
5. Register it: `registry.add {source: "owner/repo"}`.

## Gotchas
- Never publish without confirmation; default visibility is private.
- Publish refuses when it finds secrets (.env, keys, tokens).
- INDEX files must be current or validation fails; descriptor id equals its directory.
- Check licenses before making a library public.

## Verification
`library.validate` ok, `library.index {check: true}` ok, fresh `registry.refresh` finds the assets.

Suggested model: sonnet (cost low). Factory capabilities: library.new, library.add, library.validate, library.index, library.publish, registry.add.

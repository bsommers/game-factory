---
name: make-sprites-characters
description: Make pixel-art sprites, tiles and animated characters with art-kit and character-kit, palette locked and viewed at x6.
triggers: [sprite, sprites, character, pixel art, art, tile, tileset, animation, animator, palette, sheet, spritesheet, pixbuf, ascii art, draw, colby, rig, outline, art style]
needs: [src/kits/art-kit, src/kits/character-kit]
outputs: [sprite sheet png, manifest, character spec]
model: sonnet
cost: medium
capabilities: [registry.search, library.install]
kits: [art-kit, character-kit]
---
# Sprites and characters

## Steps
1. First look for existing art: `registry.search {query, type: "sprite", tag: "style:<id>"}`; install with `library.install`.
2. Otherwise lock a palette: `lockPalette({...})`; `lock.offenders(sprite)` must be empty.
3. Static art: `spriteFromAscii(rows, legend)` or `spriteFromFn`. Characters: a spec `{name,size,palette,outline,poses,anims}` through `buildCharacter`, play with `createAnimator`.
4. Pack: `packSheet(...)` then `validateManifest(manifest, sheet, requiredNames)`; write with `encodePng`.
5. Preview at x6 (`tools/sheet.mjs --only <substr>`), judge the smallest, lowest-contrast sprite.

## Gotchas
- `PixBuf.outline` only paints transparent pixels outside the art: keep a 1 px margin (feet on row 22 of 24).
- Seamless animated tiles: period must divide tile width.
- Sprite size, row names and palette come from the defs ART rows; do not invent names.

## Verification
`node --test test/kits/art-kit*.test.mjs`; manifest validator returns []; offenders [] for every sprite.

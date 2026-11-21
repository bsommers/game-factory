# library-sprites kit
Turns raster assets from a factory character-library (e.g. `*.toon-turnaround` sheets: jpeg on a flat grey background) into transparent sprites.
Zero deps. Isomorphic: `cutout`, `bbox`, `crop`, `resizeToHeight`, `keepMainComponents`, `encodePng`/`decodePng`, `toDrawable` (browser canvas, or decoded RGBA object in Node).
Node-only: `decodeImageFile` (needs ImageMagick `convert`), `sha256`.
Flow: `factory library install <game> --library <lib> --all --yes` (writes assets.lock.json) -> a game script (see ../../tools/extract-sheet-characters.mjs) verifies sha256 against the lock, cuts out each view, writes PNGs + manifest.json + a generated base64 data module -> runtime art modules `await toDrawable(...)` and `ctx.drawImage` with scale/tint/overlay transforms.
Test: Pawgger test/art-toon.test.mjs (last two tests).

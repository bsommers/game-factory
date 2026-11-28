# Change log: proposals from Pawed Racer (nothing here is applied to the live factory)

| id | file | kind | summary |
|---|---|---|---|
| P-001 | swarm/dashboard/server.mjs | MODIFIES `swarm/dashboard/server.mjs` | LAN access with an address allowlist |
| P-002 | swarm/dashboard/index.html | MODIFIES `swarm/dashboard/index.html` | phone layout (<=640px) |
| P-003 | (spec) libraries.json manifest + `registry sync` | NEW (to be written) | project manifest with relative-local and GitHub coordinates per library |
| P-004 | new/char-pipeline/ | NEW | text-to-character pipeline: bible schema, prompt composer, mock adapter, learn, postprocess, check, export (needs library.addFiles) |
| P-005 | toon-vec.js | NEW | polygon rasteriser over PixBuf for outlined cel-fill art (toon style) |

## P-001 tracker LAN access
Why: the user wants the tracker on the 192.168.1.x network. Change: `TRACKER_HOST` defaults to `0.0.0.0` (was 127.0.0.1); every request is checked against `TRACKER_ALLOW` (comma list of address prefixes, default `127.0.0.1,::1,192.168.1.`; `*` = anyone) and gets 403 otherwise. Used in: Pawed Racer on port 4860. Adopt: copy over `swarm/dashboard/server.mjs`. Test: curl from loopback and LAN gave 200; no unit test yet. Risk: the tracker is read-only, but exposing it changes the default; consider making LAN opt-in in the factory.

## P-002 mobile layout
Why: phone viewing. Change: CSS block appended to the dashboard: stacked phases, 2-column stat strip, wrapping Gantt header, 44 px touch targets, horizontal scroll for the Gantt canvas. Verified by headless screenshot at 390 px wide (`out/shots/tracker-mobile.png` in pawedracer); not tried on a real phone. Adopt: copy `index.html`.

## P-003 library manifest
See `pawedracer/spec/build-spec.md` section 2.4 and `pawedracer/libraries.json`. Not yet implemented.

## toon-vec.js (toon-style, 2026-11-21)
Deterministic polygon rasteriser over PixBuf (outlined cel fills with crescent shade, strokes, catmull blobs, bands) at HI_SCALE. Reusable for any hi-res cartoon sprite pack; depends on pixbuf.js and defs HI_SCALE/TOON_PAL.

## P-004 char-pipeline (character-from-text tooling)
Why: build-spec 2.1; every game with characters needs bible -> prompt -> art -> verified library asset. Change: new `new/char-pipeline/` (bible schema, prompt composer, generator-adapter interface with offline mock, zero-dep baseline-JPEG/PNG codec, reference learning, post-process, consistency check, contact sheet, library export). No live factory file touched. Used in: Pawed Racer `tools/character-pipeline/` (10 node tests green). Adopt: copy the folder, add a `factory character` command wrapper. Test: `node --test char-pipeline.test.mjs` (paths assume pawedracer layout). Risk: JPEG decoder is baseline only (progressive throws); the export uses `library/ops.mjs` addItems directly because `library add` on the CLI cannot take file buffers; suggest a `--files-json` option or a `library.addFiles` capability.

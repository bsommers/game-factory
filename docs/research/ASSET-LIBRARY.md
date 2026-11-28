# Reusable 3D/audio asset library on public GitHub: research and design

Date: 2026-11-22. Scope: GLB models, animations, textures, audio, shared across games, built on the existing `library.*` / `registry.*` machinery (`docs/LIBRARIES.md`, `factory-core/library/`).

## 1. Facts checked (sources)

**Meshy licensing** (Meshy help center and pricing docs; the ToS page itself, updated 2026-03-07, could not be read in full, so have the user read it before the first public push):
- Paid plans (Pro/Studio/Enterprise): the user retains full private ownership and commercial rights, with no attribution needed. The help article makes this conditional on (a) not publishing the model to the Meshy Community and (b) the content not infringing third-party copyright. Models generated while on a paid plan keep paid rights after a downgrade.
- Free plan: output is licensed CC BY 4.0. Commercial use is allowed, with attribution. Meshy asks for "Model created with Meshy - CC BY 4.0 License" in the project description.
- Generation happens under whichever plan is active at that moment, so the license depends on the plan at generation time, not at publish time.
- Open points the ToS must settle: whether a CC BY free-tier asset may be re-licensed (it may not; you can only pass on CC BY 4.0), and the exact effect of Community visibility on paid ownership.
- Sources: https://help.meshy.ai/en/articles/10137554-what-is-the-ownership-of-the-generated-models, https://intercom.help/meshy/en/articles/16102098-can-i-use-meshy-assets-commercially, https://docs.meshy.ai/en/webapp/pricing, https://www.meshy.ai/cs/terms-of-use

**GitHub Git LFS** (GitHub billing docs, https://docs.github.com/en/billing/concepts/product-billing/git-lfs):
- Free account: 10 GiB LFS storage plus 10 GiB per month bandwidth (older pages that say 1 GB are outdated). Team and Enterprise Cloud get 250 GiB of each.
- Per-file cap: 2 GB on Free and Pro.
- Overage is billed (about $0.07/GiB storage, $0.0875/GiB bandwidth). With no payment method or a $0 budget, LFS downloads stop until the next month. One third-party source says this; I could not confirm it in GitHub's own docs.
- Every `git clone` or CI fetch of an LFS repo counts against bandwidth, so a public library that many games and CI jobs clone will exhaust 10 GiB quickly. Forks share the parent's quota.
- Plain git: a soft repo-size recommendation of about 1 GB (hard warnings around 5 GB), and a 100 MB per-file hard limit. Release assets: up to 2 GiB per file, with no storage or bandwidth quota on public repos.

## 2. Recommendation in one paragraph

Use one public **catalogue repo** that stores only text (manifests, thumbnails, indexes, licenses). Keep the binaries as **GitHub Release assets**, addressed by sha256. Do not use Git LFS. Games consume by **fetch-by-manifest** (`library.install` extended with a download step), never by submodule. Every asset carries a mandatory license record, and a publish gate refuses any asset whose license is unknown, non-redistributable or unproven.

## 3. Repo split

| Repo | Purpose | Contents | Visibility |
|---|---|---|---|
| `game-assets` (general) | Cross-game CC0/CC-BY/own-origin assets | `library.json`, `assets/<id>/asset.json`, thumbnails, `INDEX.*`, `LICENSES/`, `ATTRIBUTION.md` (generated). Binaries in Releases. | public |
| `<game>-assets` (per game) | Game-specific art, WIP, anything with an unclear license | Same format | private until cleared, then optionally public |
| `game-assets-private` | Paid-plan Meshy output you do not want redistributed | Same format | private |

Rule: an asset moves from a per-game repo to `game-assets` only through `library.promote` (section 7), which re-runs the license gate. Registry sources can mix all three. A game with a private repo set up as a source still gets one merged catalogue.

Why not one repo per asset type: it splits tag search and dependencies (a GLB depends on textures and clips). Split by trust and visibility, not by media type.

## 4. Directory layout

```
library.json                     (existing) + licensePolicy, releaseBase
assets/<id>/asset.json           descriptor, schema v2 (below)
assets/<id>/thumb.png            small preview (<= 256 KiB) - IN GIT
assets/<id>/LICENSE.txt          verbatim license text or grant note - IN GIT
assets/<id>/provenance.json      generation record: prompt, plan, job id, date, screenshots of ToS state - IN GIT
blobs.json                       generated: sha256 -> {bytes, url, release} for every payload file
releases: tag `blobs-<n>`        payload files named `<sha256>.<ext>` (content-addressed)
INDEX.json  INDEX.md  ATTRIBUTION.md   generated, deterministic
```

Payload files named in `asset.files[]` keep their logical path (`model.glb`, `clips/walk.glb`), but are not committed. They are fetched into `assets/<id>/<path>` on demand and checked against `sha256`.

## 5. Manifest schema v2 (additions to asset.schema.json)

New `type` values: `model`, `animation`, `texture`, `material`, `hdri`, `music` (keep `song`/`sfx`). Existing fields stay. New optional blocks, required per type where noted:

```jsonc
{
  "license": "CC-BY-4.0",                  // SPDX id or "LicenseRef-<x>"; now required to be on the allow-list
  "licenseInfo": {                          // REQUIRED for every asset in a public library
    "spdx": "CC-BY-4.0",
    "status": "verified",                   // verified | self-owned | needs-review | unknown | blocked
    "redistribute": true,                   // may be placed in a public repo
    "commercialUse": true,
    "attribution": { "required": true, "text": "Model created with Meshy - CC BY 4.0 License", "url": "..." },
    "licenseFile": "LICENSE.txt",
    "evidence": ["provenance.json#plan", "https://..."],  // where the claim comes from
    "verifiedBy": "user", "verifiedAt": "2026-11-22"      // human sign-off, not auto-set
  },
  "provenance": {                           // existing fields plus:
    "generator": "meshy", "tool": "meshy-5", "jobId": "...", "plan": "free|pro|studio|enterprise",
    "visibility": "private|community", "prompt": "...", "sourceUrl": "...", "derivedFrom": ["<asset id or url>"]
  },
  "model": {                                // type model
    "format": "glb", "tris": 12840, "verts": 7012, "materials": 2, "textures": [{"w":2048,"h":2048,"fmt":"png|ktx2"}],
    "bounds": {"min":[..],"max":[..]}, "unitScale": 1, "upAxis": "Y",
    "rig": {"type": "none|humanoid|quadruped|custom", "bones": 24, "skinned": true, "skeletonHash": "sha256"},
    "clips": [{"name":"Walk","duration":1.0,"loop":true,"fps":30,"file":"model.glb"}],
    "compression": ["draco","meshopt","ktx2"], "extensionsRequired": []
  },
  "animation": {                            // type animation (retargetable clip packs)
    "targetRig": "humanoid", "skeletonHash": "sha256", "clips": [ ... ]
  },
  "audio": {"codec":"ogg|wav","sampleRate":44100,"channels":2,"loopable":true,"bpm":120,"loudnessLufs":-16},
  "thumbnail": "thumb.png",                 // alias of existing `preview`
  "blobs": [{"sha256":"...","url":"https://github.com/<o>/<r>/releases/download/blobs-1/<sha>.glb"}]  // optional hints; blobs.json is authoritative
}
```

`hash` stays sha256 over sorted `path\0sha256` lines of `files`. Add `contentId` (same value) as the dedup key.

## 6. Binary size strategy

- Raise caps per library via `library.json` `limits {fileBytes, libraryBytes}`. Today's hard caps (16 MiB per file, 128 MiB per library) are right for untrusted libraries but too small for GLB sets. A manifest may only raise them up to the Release limit (2 GiB per file), and the consumer decides whether to honour the raise (`--max-file`).
- Git holds only manifests, thumbnails and licenses, so the repo stays well under 100 MB and clones are instant.
- Release assets are public, quota-free, and CDN-backed. Names are `<sha256>.<ext>`, which makes them immutable and automatically deduplicated.
- Release asset count is capped by GitHub (1000 per release), so roll to a new tag `blobs-<n>` at 900 files or 4 GiB.
- Optimize before publishing (`assets.optimize` step, see section 8): meshopt or Draco for geometry and KTX2 for textures, targeting under 5 MB per model. This cuts size more than any storage choice.
- Git LFS is rejected: the 10 GiB bandwidth cap is shared by every clone and CI run and breaks downloads for third parties. Plain git for binaries is rejected: history bloat is permanent. Fall back to LFS only for a private per-game repo that a team clones rarely.
- If a library outgrows Releases, the blob URL is a pluggable base (`releaseBase`), so the same `blobs.json` can point at an S3 or R2 bucket without touching manifests.

## 7. Deduplication and versioning

- Content addressing: blob identity is sha256. Two assets that share a texture reference the same blob. `library.add` reports `duplicateOf` when a new file's sha256 (or, for models, a geometry hash) already exists in any registered library, and refuses unless `allowDuplicate:true`.
- Near-duplicate hint (non-blocking): `skeletonHash` and geometry-only hash, so retextured variants are linked via `derivedFrom`.
- Versioning: assets are semver (existing patch bump on `update`). The library has its own semver and git tags (`v1.4.0`). Games pin in `assets.lock.json` by `{library, ref (commit or tag), id, version, hash}`. Never pin by branch.
- Immutability: a published `(id, version)` must never change content. CI fails if `hash` changed without a version bump. Removal is `status: "withdrawn"` in the descriptor plus a `LICENSE-REVOKED` note, so lock files can warn.

## 8. How games consume it

Rank:
1. **Fetch-by-manifest (recommended).** `registry.add owner/game-assets@v1.4.0`, `registry.search`, `library.install`. The install step clones the catalogue (text only), then downloads each needed blob from its `blobs[].url`, verifies sha256 before and after, writes `assets.lock.json`. This extends the current copy-based install. Attribution output is regenerated into the game's `CREDITS.md`.
2. Submodule: works but pulls the whole catalogue and pins to commits that do not contain the binaries. Not recommended.
3. npm-like package: do not publish the library as an npm package. Use the lock file plus `library.verify`. A thin `assets.lock.json` is the same idea without a registry.

Web games: `package.standalone` already copies installed assets into dist. Extend it to emit `CREDITS.md` and fail if any installed asset has `licenseInfo.attribution.required` and the credit text is missing from the shipped credits.

## 9. License record and publish gate

### Per-asset license decision table (Meshy origin)

| Generation plan | Visibility on Meshy | Stored `license` | `redistribute` (public repo) | Attribution |
|---|---|---|---|---|
| Free | any | `CC-BY-4.0` | yes, as CC-BY only | required, Meshy credit text |
| Paid (Pro/Studio/Ent) | private | `LicenseRef-Owner-Meshy-Paid` (owner chooses a release license, e.g. CC0-1.0, only after sign-off) | yes, if the owner explicitly chooses | not required |
| Paid | published to Community | `needs-review` | blocked until the user reads Meshy ToS and confirms | unknown |
| Unknown plan or no job record | any | `unknown` | blocked | n/a |
| Imported third-party (Kenney, Quaternius, Poly Haven, etc.) | n/a | their SPDX | per license | per license |

Open question for the user: a paid-plan model published as CC0 in a public repo is permanent and irrevocable, so do it deliberately. A safer default is "paid-plan assets stay in `game-assets-private` unless promoted with `--release-as <spdx>`".

### Gate (new, runs in `library.validate`, `library.publish` and CI)

A library is "public-ready" only if every asset satisfies all of:
1. `licenseInfo.status` is `verified` or `self-owned` (never `unknown`, `needs-review`, `blocked`).
2. `license` is on the library's allow-list (default: `CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0` (flag copyleft), `MIT`, `Apache-2.0`, `LicenseRef-Owner-*`). Deny `CC-BY-NC*`, `CC-BY-ND*`, unknown `LicenseRef-*` without a `LICENSE.txt`.
3. `licenseInfo.redistribute` is true and `licenseFile` exists and is non-empty.
4. If `attribution.required`, `text` is non-empty. `ATTRIBUTION.md` must be current.
5. Generator-specific rules: `provenance.generator == "meshy"` requires `provenance.plan` and `provenance.visibility`. Plan `free` forces `license: CC-BY-4.0` (reject CC0, MIT and the like, since you cannot relicense). Plan paid plus `visibility: community` forces `needs-review`.
6. Derivative works: `derivedFrom` must resolve to assets whose license is compatible (CC-BY-SA inheritance, NC propagation). No asset may be more permissive than its parents.
7. `verifiedBy` and `verifiedAt` are set for every non-CC0-original asset. The tool never sets these itself; only `library.license-set --confirm` does, and that is an explicit user action.
8. Real-world IP check (section 10) flags: `ipReview.status` must not be `flagged`.

`library.publish` with `visibility: public` runs the gate in addition to the existing secret scan. It fails with `error.code = LICENSE_BLOCKED` and lists the offending ids. Private visibility only warns. CI (generated workflow) repeats the gate on every PR, so a hand edit cannot bypass it.

## 10. Real-world places and characters (IP caution)

- Copyright: a model of a real building, landmark or public sculpture may infringe or may not (depends on country; architectural-work and freedom-of-panorama rules differ, and the latter often does not cover 3D copies or commercial reproduction). Real-city layouts from Google Earth, Maps or OSM-derived photogrammetry carry their own licenses (OSM is ODbL, which has share-alike; Google imagery is not redistributable).
- Trademarks and likeness: brand logos, signage, car and product designs, sports teams, and real people's likeness (right of publicity). Fictional characters (Mario, Pokemon, Disney, anime, comic heroes) are copyrighted and trademarked. An AI-generated "lookalike" is still infringing. Meshy's own paid-ownership grant is conditional on non-infringement, and neither Meshy nor an AI tool can clear it for you.
- Prompts and image-to-3D inputs: record the prompt and input image in `provenance`. Reject input images with unknown copyright (a scraped screenshot is not yours).
- Process: an `ipReview` block (`status: clear|flagged|unchecked`, `notes`) plus a heuristic scanner in `library.validate`: keyword list on name, tags, prompt (named franchises, real-brand names, "in the style of <living artist>"), and a hard block on `ipReview.status != clear` for public publishing. This is a tripwire only. A human decision is still required, and the docs must say so.
- Generic or stylised settings ("medieval harbor town") are fine. Prefer fictional or original design. If a real place is intended, use your own original photos, keep it stylised, and avoid logos and signage.
- Not legal advice. If a game will be sold, get a lawyer to review the list of verified assets.

## 11. CI validation (generated `.github/workflows/validate.yml`)

Runs the zero-dependency `tools/library/validate.mjs` (already the pattern) with extended checks:
1. Schema v2 and existing checks (ids, hashes, paths, symlinks, INDEX freshness).
2. License gate (section 9) and ATTRIBUTION.md freshness.
3. Blob reachability: every `blobs.json` URL returns 200 with matching length (HEAD request; weekly cron and on release).
4. GLB lint: parse GLB header, `tris` / `bones` / `clips` in the manifest match the file (use the existing `factory-core/anim` gltf-anim lib), no external URIs inside the GLB, no embedded base64 over a cap, `extensionsRequired` within an allow-list.
5. Immutability: changed `hash` without version bump fails; deleted assets must be marked `withdrawn`.
6. Size and count budgets from `library.json` `limits`; thumbnails under 256 KiB.
7. Secret scan (reuse the publish scan).

## 12. Exact capability additions

All in `factory-core/library/capabilities.mjs`, same `{ok,data,error,next}` shape. HTTP, CLI and MCP derive automatically (MCP: `library_license_set` and so on). Add tests under `test/library/`.

| Name | Summary | Input sketch | Output sketch | Error codes |
|---|---|---|---|---|
| `library.add` (extend) | Accept `type: model|animation|texture|audio...`; read GLB stats; compute `contentId`; record provenance; set `licenseInfo.status: "needs-review"` unless `--license-from` is given. | add `files[].license`, `files[].licenseInfo`, `provenance` (`generator`, `plan`, `visibility`, `jobId`, `prompt`), `allowDuplicate` | adds `duplicates[]`, `stats` | `DUPLICATE`, `BAD_INPUT` |
| `library.license-set` | The only way to mark an asset verified. | `{library, id, spdx, status, redistribute, commercialUse, attribution{required,text,url}, evidence[], confirm:true}` | `{id, licenseInfo}` | `CONFIRM_REQUIRED`, `NOT_FOUND`, `BAD_INPUT` |
| `library.license-audit` | Dry-run of the gate. Lists every asset with status and reason; optional `--fix-meshy` to derive the license from plan and visibility. | `{library, target: "public"|"private", allowList[]}` | `{ok, blocked:[{id, reasons[]}], warnings[], counts}` | `LICENSE_BLOCKED` |
| `library.attribution` | Generate `ATTRIBUTION.md` and a game-side `CREDITS.md`. | `{library}` or `{project}`, `format: md|json` | `{path, entries}` | `NOT_FOUND` |
| `library.promote` | Move or copy assets between libraries, re-running the gate. | `{from, to, ids[], releaseAs?: spdx, confirm}` | `{moved[], blocked[]}` | `LICENSE_BLOCKED`, `EXISTS` |
| `library.blobs.pack` | Compute `blobs.json`, name payloads `<sha256>.<ext>`, group into release batches. | `{library, maxBytesPerRelease, maxFilesPerRelease}` | `{blobs, releases:[{tag, files, bytes}]}` | `BAD_INPUT` |
| `library.blobs.publish` | Upload blobs with `gh release create/upload`. Confirm-first, like `library.publish`. | `{library, repo, tag, yes}` | `{uploaded, skipped(existing sha)}` | `CONFIRM_REQUIRED`, `TASK_FAILED` |
| `library.blobs.fetch` | Download and verify blobs for chosen assets (used by `library.install`). | `{library, assets[], dest, maxFileBytes}` | `{fetched, verified, failed}` | `HASH_MISMATCH`, `TASK_FAILED` |
| `library.install` (extend) | Call `blobs.fetch` when payloads are absent; write `{ref, version, hash, licenseInfo digest}` to `assets.lock.json`; refuse assets with `status` not verified/self-owned unless `allowUnverified` (private libraries only). | add `fetchBlobs` (default true), `allowUnverified` | adds `credits` | `LICENSE_BLOCKED` |
| `library.publish` (extend) | When `visibility: public`: run `license.audit`; refuse with `LICENSE_BLOCKED`; push blobs via `blobs.publish`; tag `v<version>`. | add `blobs: boolean`, `tag` | adds `audit` | `LICENSE_BLOCKED`, `CONFIRM_REQUIRED` |
| `library.validate` (extend) | Schema v2, license gate, GLB stats vs manifest (use `anim` lib), immutability vs git tag, blob reachability (`checkBlobs`). | add `target`, `checkBlobs` | adds `licenseAudit` | |
| `library.ip-review` | Heuristic scan of names, tags and prompts for franchises and brands; records `ipReview`. | `{library, ids?, set?:{id, status, notes, confirm}}` | `{flagged:[{id, hits[]}]}` | |
| `meshy.import` (small, in `models`/`anim` area) | Create an asset descriptor from a Meshy job (job id, plan, visibility fetched or passed in), set the license per the decision table. | `{library, glb, jobId, plan, visibility, prompt, inputImage?}` | `{id, license, status}` | `BAD_INPUT` |

New JSON schemas: `asset.schema.json` v2 (above), `blobs.schema.json`, `license-info.schema.json`, `lock.schema.json` (add `ref`, `blobUrl`, `licenseDigest`). Keep `formatVersion` bump to 2; the validator accepts v1 and v2, and `library.index` upgrades v1 descriptors with `licenseInfo.status: "needs-review"` when a library is converted.

New skills: `skills/license-gate.md` (haiku-cost: audit, fix, sign-off flow) and an update to `skills/publish-library.md` (add the gate and blob steps, replace "Check licenses before making a library public" with the capability call). `skills/find-reuse-assets.md`: add "credits are mandatory" and "pin by tag".

## 13. Build order

1. Schema v2 plus the license gate plus `library.license-set/audit` (blocks the main risk first; no network).
2. `library.add` GLB stats and provenance, `meshy.import`, `library.attribution`.
3. `blobs.pack/publish/fetch` and the extended `install`/`publish`.
4. CI workflow template update, GLB lint, immutability check.
5. `library.promote`, `library.ip-review`.

## 14. Risks and unknowns

- The Meshy ToS text itself was not read (only help articles). Re-check before the first public push; plan-at-generation-time must be recorded when the job is created, since it cannot be reconstructed later. The Meshy API may expose it. Unverified.
- GitHub's free-tier LFS cutoff behaviour is not confirmed here, but the design avoids LFS anyway.
- Release asset limits (2 GiB per file, 1000 per release) are from general GitHub knowledge, not re-fetched today.
- Public CC0 release of paid-plan models is irreversible.

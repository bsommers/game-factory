# Library blobs (binaries out of git)

Binaries (glb, png, ogg, ...) are addressed by sha256 and stored outside git as GitHub Release assets (no Git LFS). The catalogue keeps only a text manifest, `blobs/MANIFEST.txt`: one tab-separated line per file, `sha256 size content-type path`, sorted by path.

| Capability | What it does |
|---|---|
| `library.blobs-pack` | Hash binaries under `assets/` (or `paths`), write the manifest; `store` also copies blobs to a local `<store>/<sha256>` dir. No network. |
| `library.blobs-publish` | Upload blobs to a release (`tag`, default `blobs-<manifest hash>`) as files named by sha256. `dryRun` defaults to true (plan only, `gh` never called). A `visibility: public` call runs the license/IP gate first and fails `LICENSE_BLOCKED` (unverified license, NC/ND, `ipReview` flagged or unresolved, stale ATTRIBUTION.md), even as a dry run. |
| `library.blobs-fetch` | Restore blobs by sha256 from a local dir or `file://` store (or `repo`+`tag` via `gh release download`). Size and hash are verified before anything is written; mismatches are refused (`TASK_FAILED`). Existing differing files need `yes:true`; `dryRun` verifies only. Works on libraries whose binaries are missing or damaged. |

Attribution and IP review already exist as `library.attribution` (generates ATTRIBUTION.md from `licenseInfo`) and `library.ip-review` (keyword tripwire plus `set {id, status: clear|flagged|unchecked, notes, confirm}`; `flagged` is the BLOCK state). The publish gate above reuses them.

Typical flow: `library.blobs-pack` -> commit the manifest -> `library.blobs-publish {repo, dryRun:true}` -> review -> `dryRun:false` on explicit user instruction. Consumers: `library.blobs-fetch {library, source}`.

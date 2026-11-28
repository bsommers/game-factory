# meshy.generate / meshy.status

Online, optional Meshy API jobs. Offline import/verify live in `meshy.*` (`factory-core/meshy/capabilities.mjs`); this part is `generate-capabilities.mjs` + `generate-lib.mjs`.

- One job per call: `task` = `text-to-3d` (mode preview|refine) | `image-to-3d` | `rig` | `animate`. Chain them yourself using the returned `jobId` (`previewTaskId`, `inputTaskId`, `rigTaskId`).
- **dryRun defaults to true**: no network, no key; returns the request and `estimatedCredits`.
- Real run: `dryRun:false`, `maxCredits` (mandatory; `BAD_INPUT` if missing or below the estimate), key in an env var.
- **Key**: only from the env var named by `keyEnv` (default `MESHY_API_KEY`). There is no key input (schema rejects unknown fields). It is redacted from errors and never returned or written.
- `baseUrl` overrides the API base (tests use a 127.0.0.1 mock). Downloads only from https hosts, or the same host as `baseUrl`; capped at 200 MB.
- Flow: POST, write `<out>/<jobId>.meshy.json` (jobId, taskType, prompt, plan if supplied, estimate, timestamps), poll (`pollMs`, `timeoutSec`), download GLB to `<out>/<jobId>.glb` (default `assets/meshy`). `wait:false` returns right after submit. Only FAILED/CANCELED is failure (`TASK_FAILED`).
- `meshy.status {task, taskId}`: one GET, returns id/status/progress only.
- Next step after a download: `meshy.import`.

CLI: `bin/factory meshy generate --task text-to-3d --prompt "a knight"` (dry run), then add `--dryRun false --maxCredits 20`.

## Unverified
API paths, request field names, result field names and credit prices are agent-reported (docs/research/MESHY-PIPELINE.md). They sit in one table, `MESHY` in `generate-lib.mjs`, marked "unverified, check docs.meshy.ai". Verify before spending. Tests never touch the real API.

# swarm-tracker on-disk protocol

Everything lives under `<root>/.tracker/`, where `<root>` is `$TRACKER_ROOT` or the current directory.
Writers (agents, scripts) only append or write whole small files; the server only reads. There is no lock.

```
.tracker/
  plan.json              the roster: project title, phases, agents  (written by swarm-plan.mjs or by hand)
  events/<agentId>.jsonl one append-only file per agent
  checks/<name>.json     one small file per named check (last write wins)
  loc-history.json       written by the server (lines-of-code samples); not part of the protocol
```

## plan.json

```json
{
  "project": "My Project",
  "tagline": "optional one-liner",
  "startedAt": "2026-01-01T09:00:00.000Z",
  "phases": [{ "id": "p1", "name": "Build", "status": "active" }],
  "agents": [{
    "id": "api", "name": "REST API", "role": "backend", "model": "sonnet",
    "phase": "p1", "owns": ["src/api/", "test/api.test.js"], "desc": "short description"
  }]
}
```

| field | type | notes |
|---|---|---|
| `project` | string | dashboard title; default `Untitled swarm` |
| `tagline` | string | subtitle |
| `startedAt` | ISO-8601 UTC | overall start; if missing the first event time is used |
| `phases[].id` / `name` | string | `name` defaults to `id` |
| `phases[].status` | `pending` / `active` / `done` | anything else is shown as `pending` |
| `agents[].id` | string, required | matches the event file name (`[\w.-]` only after sanitising) |
| `agents[].name`, `role`, `model`, `phase`, `desc` | string | `role` groups cards; `model` is shown as a badge (lower-cased) |
| `agents[].owns` | string[] | files or dirs (trailing `/` = prefix); the server sums their lines of code |

Agents that emit events but are not in the plan appear as role `unplanned`. Agents in the plan with no events are `queued`.
Extra fields are preserved by `swarm-plan.mjs`. A half-written plan is ignored; the server keeps the last good copy.

## events/<agentId>.jsonl

One JSON object per line, appended. Written by `track.mjs`:

```json
{"t":"2026-01-01T09:05:00.123Z","agent":"api","state":"progress","pct":40,"msg":"routes landed"}
```

| field | meaning |
|---|---|
| `t` | ISO-8601 UTC from `new Date().toISOString()`. Never hand-write it |
| `agent` | agent id (falls back to the file name) |
| `state` | `start`, `progress`, `done`, `blocked`, `failed`, `note` |
| `pct` | integer 0-100 or `null`. `done` forces 100, `start` defaults to 0 |
| `msg` | free text (the server truncates to 2000 chars) |

Derived agent state: the last non-`note` event decides. `start`/`progress` -> `running`; `done`, `blocked`, `failed` map to themselves;
no events -> `queued`; only notes -> `running`. A `note` never changes state. The last `pct` seen is the bar. Unknown states are read as `note`.
Malformed or truncated lines are skipped, so concurrent appends are safe.

CLI: `track.mjs <agentId> <state> [pct] "<msg>"`. The pct is recognised only when more arguments follow it.

## checks/<name>.json

```json
{"name":"unit-core","status":"pass","detail":"212 tests","t":"2026-01-01T09:10:00.000Z"}
```

`status` is `pass`, `fail`, `running`, or `skip` (unknown -> `skip`). Written by `track.mjs --check <name> <status> "<detail>"`.
The file name is the sanitised name. The dashboard groups checks by the prefix before the first `-` (`unit-core` -> group `unit`).

## HTTP API (server.mjs)

Environment: `TRACKER_ROOT` (default cwd), `TRACKER_PORT` (default 4780), `TRACKER_HOST` (default 127.0.0.1),
`TRACKER_CODE_DIRS` (comma list scanned for lines of code, default `src,lib,bin,tools,scripts,test,tests,app,docs`).

| route | response |
|---|---|
| `GET /` | the dashboard (`index.html`) |
| `GET /api/state` | full state JSON (below) |
| `GET /api/stream` | Server-Sent Events: `retry: 2000`, then `event: state` with the same JSON on every change; `: ping` every 15 s |
| `GET /api/agent/<id>` | `{ id, events: [...] }` up to the last 2000 events |
| `GET /files/<path>` | files under `<root>/out/` and `<root>/dist/` only (images in the gallery, build artifacts); 403 elsewhere |
| `GET /healthz` | `ok` |

State JSON keys: `serverTime`, `hash`, `project`, `tagline`, `startedAt`, `firstEvent`, `phases`, `agents`
(each with `id name role model phase desc owns inPlan order state pct lastMsg lastT startedAt endedAt eventCount loc ownedFiles segments marks`),
`counts` (`queued running done blocked failed`), `progress` (mean percent), `feed` (newest 120 events), `checks`,
`gallery` (images in `out/previews` and `out/shots`), `artifacts` (files in `dist/`), `totals`, `loc` (history), `recent`, `hasPlan`.
The server rebuilds state every second and pushes only when the content hash changes.

### `?poll`

`/?poll` makes the page fetch `/api/state` on a timer instead of opening the SSE stream. A persistent connection keeps
headless-Chrome `--virtual-time-budget` screenshots from ever finishing, so use `?poll` for captures and tests.

## Conventions the dashboard understands
- Check names `build-<os>` and `smoke-<os>` with `<os>` in `linux`, `windows`, `macos` fill the "Platform builds" matrix.
- Images under `out/previews/` and `out/shots/` fill the gallery; files under `dist/` fill the artifacts list.

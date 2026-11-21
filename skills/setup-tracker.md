---
name: setup-tracker
description: Set up the swarm tracker (plan.json, live dashboard on port 4782, track.mjs reporting) for a project.
triggers: [tracker, dashboard, progress, track.mjs, plan.json, swarm tracker, monitor, status board, live dashboard, media panel]
needs: [docs/swarm/SWARM.md, tools/swarm-tracker]
outputs: [.tracker/plan.json, running dashboard]
model: haiku
cost: low
capabilities: [guide.check]
---
# Set up the tracker

## Steps
1. `factory new --web` already copies it; for an older repo run `bin/factory sync <dir>`.
2. `npm run plan` (generates prompts and `.tracker/plan.json`), `npm run tracker` (http://127.0.0.1:4782/).
3. Agents report with `node tools/swarm-tracker/bin/track.mjs <id> start|progress|done`.
4. Add `.tracker/` and `docs/swarm/prompts/` to `.gitignore`.

## Gotchas
- Set `TRACKER_ROOT` when running from another directory.
- Never kill a dashboard process you did not start.
- wav durations come from file size; sprite totals fall back when defs rows differ.

## Verification
`curl -s localhost:4782/` answers; every agent appears in the plan.

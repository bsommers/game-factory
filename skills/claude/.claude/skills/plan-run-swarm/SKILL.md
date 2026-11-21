---
name: plan-run-swarm
description: Plan an agent swarm for a game or tool: contract first, disjoint file ownership, one SWARM.md manifest, generated prompt files, waves under a concurrency cap. Use when: swarm, parallel agents, orchestrate, manifest, plan agents, agents.
---

# Plan and run a swarm

## When to use
Work splits into 4+ modules that can be built in parallel against a fixed contract.

## Steps
1. Write the contract (ARCHITECTURE.md + shared defs file) before launching anyone.
2. Draft the manifest: `guide.plan {goal, agents?}` gives a skeleton using `swarm/templates/SWARM.md`; fill `owns:` lists that never overlap.
3. Generate prompts: `npm run plan` (= `swarm-plan.mjs`). Spawn each agent with one line: "Read <root>/docs/swarm/prompts/<id>.md and execute it exactly."
4. Start with at most 4 agents running; launch critical-path agents first; plan waves (platform cap about 20 launches).
5. Each agent keeps `docs/swarm/progress/<id>.md` and ends with `CONTINUE: <step>` after about 25 tool calls; a fresh agent continues from it.
6. After each wave: re-run the suites yourself, commit, append to docs/CHECKPOINT.md.

## Commands
- `npm run plan`, `npm run tracker` (dashboard on :4782)
- `node tools/swarm-tracker/bin/track.mjs <id> start|progress|done|blocked|failed "<msg>"`

## Gotchas
- Do not resume a big transcript with SendMessage; start a fresh agent from the checkpoint.
- Concurrency does not create budget; total tokens do.
- Every cross-module hook (name, args, return shape) belongs in the contract with an example call; guessed hooks drift.
- Run `tools/check-imports.mjs` after every contract edit.

## Verification
`.tracker/plan.json` lists every agent, no two `owns:` overlap, each prompt file exists.

Suggested model: sonnet (cost medium). Factory capabilities: guide.plan, guide.check.

---
name: choose-model-per-agent
description: Choose the cheapest adequate model tier (haiku, sonnet, opus) for each swarm agent or subagent task.
triggers: [model, model tier, haiku, sonnet, opus, cost, budget, tokens, cheap, expensive, which model, usage limit, token budget]
needs: []
outputs: [model column in SWARM.md]
model: haiku
cost: low
capabilities: [guide.plan]
---
# Choose a model per agent

## Rules of thumb
- haiku: file search, grep/read exploration, lint/format, boilerplate, mechanical edits (1-2 files), red-green test cycles, docs assembly.
- sonnet: the bulk: multi-file integration, modules with a contract, debugging, code review, planning and research subagents.
- opus: only the one piece that defines the product (complex architecture, high-risk security audit), and only if justified.

## Steps
1. List agents and give each a one-line difficulty note.
2. Default to sonnet for modules, haiku for tooling and mechanical work.
3. Put the choice in the manifest header: `## id | model | phase | role | Name`.
4. Always pass `model` explicitly when spawning a subagent.

## Gotchas
- Finished modules per usage window is the metric; 20 concurrent agents drained a 5-hour window in minutes.
- A resumed 150k-token transcript re-sends at its original (expensive) model on a cold cache; start fresh agents from checkpoints.
- Planning/research/mapping subagents stay on sonnet or haiku unless the user asks otherwise.

## Verification
Every manifest row has a model; opus rows carry a written justification.

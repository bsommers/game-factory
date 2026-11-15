# Orchestrator checkpoint

Append-only. A fresh orchestrator reads this file first. Stamp every section with `date -u +%Y-%m-%dT%H:%M:%SZ`.

## State (rewrite this block on each compaction)
- Goal:
- Phase:
- Model plan / concurrency cap:
- Running agents (id, model, agent id for resume):
- Done:
- Next:
- Gotchas:

## UPDATE <timestamp>
DONE +1: <agent> (<n> of <total>). What landed, how to verify, known limits.
Launched <agent>. Running (<n>): <ids>.

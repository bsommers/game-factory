# AGENTS.md - driving game-factory

One capability registry (`factory-core/`), four equal front doors: CLI, HTTP, MCP, direct import. Whatever one can do, all can.

## Discover
- First run: `scripts/bootstrap.sh --json` checks Node/git/Chrome, smoke-tests the registry; add `--new <dir> "<Title>"` to scaffold a game with its own AGENTS.md.
- `bin/factory capabilities --json` (CLI), `GET /capabilities` or `/openapi.json` (HTTP), `tools/list` (MCP).
- Unsure what to do: `bin/factory guide route "<goal>" --json`; it ranks skills, capabilities, kits, styles and assets, and gives next commands and a model tier per step.
- `bin/factory help <cmd>` lists flags; `guide explain <capability>` gives an example call.

## Conventions
- Every call returns `{ok, data, error, next}`. Read `next` for the follow-up calls. Errors have a stable `error.code` (`BAD_INPUT`, `NOT_FOUND`, `EXISTS`, `CONFLICT`, `TASK_FAILED`, ...).
- CLI: `--json` on everything; exit 0 ok, 1 failed, 2 bad input, 3 not found, 4 exists/conflict. Non-interactive unless on a terminal; pass `--yes` to allow overwrites.
- Inputs are validated against each capability's JSON Schema before the handler runs. Nothing is shell-interpolated.
- HTTP binds 127.0.0.1 only: `bin/factory serve --port 4790`; `POST /api/<capability>` with `content-type: application/json`; progress stream at `GET /events?project=<dir>`.
- MCP: `bin/factory mcp` (stdio). Tool name = capability with `.` replaced by `_` (`kits_list`). Resources: `factory://learnings/<game>`, `factory://kits`, `factory://docs/kits`.
- Read `docs/LEARNINGS.md` (resource or `docs.learnings`) before starting a game swarm.

## Model choice
Haiku for searches, mechanical edits and lint fixes; Sonnet for multi-file integration, debugging, review and all planning/research agents; Opus only for architecture or high-risk security work. `guide.route` suggests a tier per step. Keep subagent replies short.

## Swarm workflow
1. `new <dir> "<Title>" --web`, then `styles recommend`/`styles apply`, `guide check`.
2. Write the contract (ARCHITECTURE.md), then `guide plan "<goal>" --out docs/swarm/SWARM.md`; edit tasks and file ownership (owns must be disjoint).
3. `swarm plan` (prompts + `.tracker/plan.json`), then `swarm next` for what to launch under the caps. Agents report with `swarm track <agent> start|progress|done|failed`.
4. Verify: `test`, `run check-imports`, `shot`; fix, re-run. Never weaken a gate.
5. `library publish` / docs / release when green. Commits and pushes are the orchestrator's job.
Full loop and the same task through each surface: `docs/SURFACES.md`.

## Adding a capability
Add `{name, summary, inputSchema, outputSchema, handler}` to a `factory-core/<area>/capabilities.mjs` and register it in `factory-core/index.mjs`. CLI, HTTP, MCP and OpenAPI pick it up automatically; add a test under `test/`.

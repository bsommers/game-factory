# Guide: skills and the routing advisor

`factory-core/guide/` tells an AI agent, a person or other software how best to use game-factory: which skill, capability, kit, style preset or existing asset fits a goal, which commands to run next and which model tier each step deserves. Everything is deterministic (keyword/tag scoring), offline, zero dependencies; an LLM re-ranker is an optional hook.

## Skills (`skills/`)
One short task-oriented Markdown file per skill. Frontmatter: `name` (= file name), `description`, `triggers` (list; phrases of 2+ words match as phrases), `needs`, `outputs`, `model` (haiku|sonnet|opus), `cost` (low|medium|high), `capabilities` (names that must exist in the catalog), optional `kits`. Body sections: `## Steps`, optional `## Commands`, `## Gotchas`, `## Verification`.

| Skill | Model | Use it to |
|---|---|---|
| `start-new-game` | haiku | scaffold a game repo, pick and apply a style |
| `choose-style` | haiku | pick a style preset (`styles.*`) |
| `plan-run-swarm` | sonnet | contract, manifest, prompts, waves |
| `choose-model-per-agent` | haiku | cheapest adequate model tier |
| `add-physics-hazards-worldgen` | sonnet | platformer physics, hazards, seeded levels, validator |
| `make-sprites-characters` | sonnet | art-kit, character-kit, palette lock |
| `compose-music-sfx` | sonnet | audio-kit songs, recipes, WAV |
| `add-fx` | sonnet | fx-kit particles, shake, sky |
| `write-docs-site` | haiku | docs-kit README, how-to-play, Pages site |
| `find-reuse-assets` | haiku | registry search, install, verify |
| `publish-library` | sonnet | build, validate, index, publish a library |
| `setup-tracker` | haiku | swarm tracker and dashboard |
| `qa-with-bot` | sonnet | autopilot, smoke, mutation checks |
| `ship-github-pages` | sonnet | build and publish with Pages |
| `debug-common-failures` | sonnet | symptom table from LEARNINGS-*.md and PawFall reports |

Generated files (never hand-edit; `guide.index` rewrites, `guide.index {check:true}` and the tests detect staleness):
- `skills/INDEX.json` – deterministic index (no timestamps): skills plus keywords, commands and steps.
- `skills/claude/.claude/skills/<name>/SKILL.md` – the same skills in Claude Code layout (frontmatter `name`, `description` with "Use when: ..."). Install with `guide.install {target: <project>}` (or `~` for user level); differing files are never overwritten without `yes`.

## Capabilities (core registry format `{name, summary, inputSchema, outputSchema, handler}` returning `{ok, data, error, next}`)
Registered by `registerGuide(registry)` from `factory-core/guide/capabilities.mjs` (array, Map or object with `register`). The router also sees `styles.*`, `library.*` and `registry.*` built in, plus whatever else is in the registry passed to `registerGuide`. `data.text` carries a human rendering.

| Capability | Input | Result |
|---|---|---|
| `guide.route` | `goal`, `limit?`, `context? {state{hasProject,hasTests,hasTracker}, assetNeeds[], budget low/medium/high, style, registryHome}` | ranked skills (score, reasons, model, cost, commands), capabilities with example calls, kits, style presets (via `styles.recommend`), assets (via offline `registry.search`), steps with model tier, commands |
| `guide.plan` | `goal`, `project?`, `tagline?`, `budget?`, `concurrency?`, `agents?`, `out?`, `yes?`, `dryRun?` | `agents`, `waves`, `manifest` (SWARM.md text accepted by `swarm-plan.mjs`), `errors`. Checks unique ids, models, `pN` phases, disjoint `owns`, opus justification |
| `guide.check` | `project` | findings `{id, severity, message, fix, skill}` and a 0-100 score: no tests, tracker, contract, manifest, style, unlocked pixel palette, kits, README, site, `.gitignore` gaps |
| `guide.explain` | `capability` (name, unique suffix/prefix, skill or kit) | inputs, example call, related skills; `NOT_FOUND` with suggestions |
| `guide.skills` / `guide.show` | `tag?` / `name` | list / full skill |
| `guide.install` / `guide.index` | `target, yes?, dryRun?` / `check?` | Claude skill files / regenerated INDEX |

Error codes: `BAD_INPUT`, `NOT_FOUND`, `INVALID_PLAN`, `EXISTS`, `CONFLICT`, `STALE`.

### Scoring (deterministic)
Goal tokens are lower-cased, stop-words dropped, lightly stemmed. Per skill: trigger phrase hit +6, trigger keyword +3 each, name word +2, description word +1, tool (capability/kit) word +1.5; context bonuses (`hasProject:false` favours `start-new-game`, `hasTests:false` favours `qa-with-bot`, low budget favours cheap skills and drops the model one tier, `assetNeeds` favour `find-reuse-assets`). Ties sort by name. Skills scoring 0 are omitted. `setReranker(fn)` (in `capabilities.mjs`) or `route(input, {rerank})` takes `(ranked, goal) -> ordered names`; a throwing hook is ignored.

## CLI wrapper spec for `factory guide` (for factory-surface)
`bin/factory guide <sub> ...` execs `node factory-core/guide/cli.mjs <sub> ...` (ready to use; it prints `data.text`, or the full envelope with `--json`, exit 0/1).

```
factory guide route "<goal>" [--budget low|medium|high] [--assets "cat sprite,jungle song"] [--style <id>] [--limit N] [--json]
factory guide plan  "<goal>" [--project NAME] [--budget low] [--concurrency N] [--out docs/swarm/SWARM.md] [--yes] [--dry-run]
factory guide check [dir]                      (default .)
factory guide explain <capability|skill|kit>
factory guide skills [tag]      factory guide show <skill>
factory guide install <dir|~> [--yes]           factory guide index [--check]
```
MCP/API: expose the `guide.*` capabilities through the same registry as `styles.*` and `library.*`.

## Agent usage
1. Unsure what to do: `guide.route {goal}`; follow `steps` and `commands`; spawn subagents with the suggested `model`.
2. Starting a swarm: `guide.plan {goal, out}` then edit tasks, `npm run plan`.
3. Before a release: `guide.check {project}` and fix errors/warnings.
4. Install the skills for Claude Code: `guide.install {target: "~"}`.

## Adding a skill
Create `skills/<name>.md` with the frontmatter above, list only capabilities that exist, run `node factory-core/guide/cli.mjs index`, add a golden routing case in `test/guide/guide.test.mjs`, run `node --test test/guide/`.

## Tests
`node --test test/guide/` (43 tests): 20 routing golden cases, route shape/determinism/budget/style/assets (seed library)/reranker, index determinism and freshness, frontmatter validation, Claude layout and install safety, plan validity (also fed to the real `swarm-plan.mjs`), `check` on fixture projects, explain, capability format and registration.

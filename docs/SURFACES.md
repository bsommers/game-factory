# One factory, four front doors

All actions are capabilities in `factory-core/` (`buildRegistry()` registers styles, library/registry, guide, then core: project, kits, swarm, docs). Results are always `{ok, data, error, next}`.

## The same task four ways: scaffold a web game, then list the kits
| Surface | New project | List kits |
|---|---|---|
| CLI | `bin/factory new ~/src/fun/g "G" --web --json` | `bin/factory kits list --json` |
| HTTP | `curl -s -XPOST 127.0.0.1:4790/api/project.new -H 'content-type: application/json' -d '{"dir":"/home/me/g","title":"G","web":true}'` | `curl -s -XPOST 127.0.0.1:4790/api/kits.list -H 'content-type: application/json' -d '{}'` |
| MCP | `tools/call project_new {"dir":"/home/me/g","title":"G","web":true}` | `tools/call kits_list {}` |
| Library | `await buildRegistry().call('project.new', {dir, title:'G', web:true})` | `await reg.call('kits.list', {})` |
| By hand | `sh bin/factory-scaffold.sh new ~/src/fun/g "G" --web` (the original script, still shipped) | `ls templates/web-project/src/kits` |

`test/factory-surface.test.mjs` proves the four programmatic doors return identical envelopes.

Start HTTP with `bin/factory serve --port 4790` (127.0.0.1 only; `GET /openapi.json`, `GET /capabilities`, `GET /events?project=<dir>` for SSE). Start MCP with `bin/factory mcp`, e.g. in a client config: `{"command":"/path/to/game-factory/bin/factory","args":["mcp"]}`.

## Exit codes and errors
0 ok, 1 failed, 2 bad usage or input (`BAD_INPUT`), 3 not found, 4 exists or conflict. HTTP: 200, 400, 404, 409, 422 (capability failed), 415/403 for transport problems.

## The autonomous factory loop
1. Idea: `guide route "<idea>"`, `styles recommend {idea}` to pick a look.
2. Manifest: `new --web`, `styles apply`, write the contract, `guide plan {goal, out}`.
3. Swarm: `swarm plan`, then loop `swarm next` (spawn what it prints, with the stated model), watch `swarm status` or the SSE stream, agents call `swarm track`.
4. Verify: `test`, `run check-imports`, `shot`, `guide check` until clean.
5. Publish: `library validate` then `library publish`, `guide index --check`, release. A human or the orchestrator approves publishes and commits.

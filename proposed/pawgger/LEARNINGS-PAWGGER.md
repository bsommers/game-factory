# Learnings from Pawgger (for the next game)

- Frogger-likes: keep lane positions closed-form (`x0 + dir*speed*t` mod ring). A bot or validator can then evaluate any future tick without cloning the sim, which made the time-expanded A* planner (grid-hop-autopilot) cheap and exact.
- Plan in the sim's step order, in fixed ticks (hop = 8 ticks, wait quantum 4). Mismatched step order is the main cause of bots dying at the last row.
- Fairness is a reachability problem per goal (per bay), not per level; a BFS over (row, time, x) is the validator; world-gen's `validateWorld` covers the circular case, grid games need the time dimension.
- `tools/sheet.mjs` expects object manifests ({module,name,w,h,frames}); keep `defs.artManifest()` object-shaped and let ART rows be compact arrays.
- The single-file bundler must bundle literal `import('./x.js')` and install its module map before top-level await; never rely on `import(variable)`.
- Headless tools must not default scratch to `/tmp` (tmpfs); use `<repo>/out/`.
- Painterly (vector) art cannot be validated with PixBuf headless: render in headless Chrome and compare against the manifest scaled by the style scale.
- Restyling by wrapping (toon-kit over painter modules) beats redrawing: 3-line modules, one source of art truth.
- Parallel agents: appended changelog entries are the audit trail; a final extract pass should only add rows and missing patches, never rewrite entries.

# Learnings from MicroMaze

- Jingle note crossing a 16-step bar line threw at module load. In the browser the whole module graph failed: blank black canvas, while node tests passed (they never imported the audio module). Fix: add a test that imports the audio/music module and validates every note stays inside its bar, plus a headless-Chrome console check:
  `google-chrome --headless=new --enable-logging=stderr --virtual-time-budget=6000 --dump-dom URL | grep CONSOLE`
  Any CONSOLE error line fails the gate.
- Documented controls must be verified against `src/core/input.js` (the real key map), not written from memory. README and in-game help drifted from the code.
- `scripts/verify.sh` runs under `set -euo pipefail`; an informational per-level botplay that fails (levels vary in difficulty) aborted the whole gate. Append `|| true` to informational commands, and note that `| tail -1` hides the botplay exit code only because of the pipe; use `|| true` explicitly.
- Pages: relative `import.meta.url` fetches, `.nojekyll`, Pages from `main:/`.

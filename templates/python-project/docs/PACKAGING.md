# Packaging

- **PyInstaller** (native, per-OS; build on each target): `pip install -e ".[game,package]"` then
  `pyinstaller --onefile --windowed --name __SLUG__ src/game/main.py` (add `--paths src`; output in `dist/`).
- **Nuitka**: `python -m nuitka --onefile --enable-plugin=pygame src/game/main.py --output-dir=dist`
  (needs a C compiler; faster startup than PyInstaller).
- **Web**: `pip install -e ".[web]"`; pygbag wants `main.py` at the project root of a folder and an async main loop
  (`await asyncio.sleep(0)` per frame). Copy `src/game` next to a small async `main.py` wrapper, then `pygbag --build .`.
- Keep large build output out of `/tmp`; use `dist/` or `/datanapps`.

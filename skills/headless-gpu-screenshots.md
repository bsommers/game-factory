---
name: headless-gpu-screenshots
description: Take real GPU screenshots of a Bevy or Godot game in a private Xvfb with no desktop window, and avoid the DeviceLost / blank-frame traps.
triggers: [screenshot, headless screenshot, xvfb, gpu screenshot, deviceloss, device lost, blank frame, shot.sh, bevy screenshot, visual qa]
needs: [Xvfb, Vulkan driver, built game binary]
outputs: [out/*.png]
model: haiku
cost: low
capabilities: []
---
# headless-gpu-screenshots

## When to use
You need to see what the game renders (agents verifying levels, docs images) without opening windows on the user's desktop.

## Steps
1. Game side: support `--level <x> --shot <png>`: after ~3 s of Playing, `Screenshot::primary_window()` + `save_to_disk`, wait for the file, then `AppExit` (template: `templates/bevy-fps-project/src/render/mod.rs`).
2. `tools/shot_bevy.sh <level> out/x.png` (set `GAME_BIN` to the binary). It starts `Xvfb -displayfd`, unsets `WAYLAND_DISPLAY`, sets `XDG_SESSION_TYPE=x11`, `WGPU_BACKEND=vulkan`, `MESA_VK_WSI_DEBUG=sw`, runs under `timeout 120`, kills Xvfb by PID on exit.
3. Godot games use `tools/shot.sh <scene>` instead (prints mean/std; std < 0.01 means blank).
4. Look at the image yourself (Read tool) and compare levels with a contact sheet before reporting done.

## Gotchas
- A Wayland surface under Xvfb gave `DeviceLost`; forcing X11 (unset `WAYLAND_DISPLAY`) is the fix that produced the Cheesemageddon level shots. Another agent may still be tuning other causes; see LEARNINGS-CHEESEMAGEDDON.
- `MESA_VK_WSI_DEBUG=sw` keeps rendering on the GPU (RADV/NVIDIA) while presentation is a CPU copy; software rasterizers (lavapipe) cannot do Solari ray tracing.
- Never `pkill -f` or `pgrep -f` with a pattern in your own command line (kills your shell, exit 144). Kill by PID.
- Put the FIFO and outputs on /datanapps, not /tmp. Debug builds are slow to load assets: allow the timer, not a fixed sleep.

## Verification
The PNG exists, is non-uniform, and shows the level; the script exits 0 and no Xvfb process remains.

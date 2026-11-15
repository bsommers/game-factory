# Windows build and installer

    tools/build.sh windows            # ~30 s -> build/windows/KasekriegRatOps.exe (305 MB, PCK embedded, no console wrapper produced)
    tools/package_windows.sh [--no-build]   # ~32 s -> dist/KasekriegRatOps-windows-x64-setup.zip (189 MB) + .sha256

No NSIS/wine on the host, so the installer is a zip with `install.cmd` / `install.ps1` / `uninstall.ps1`.
Install (per user, no admin): unzip, run `install.cmd` (or `install.ps1`). `-AllUsers` installs to Program Files (admin).
Creates the Start Menu shortcut "KASEKRIEG RAT OPS" and an Apps & Features entry; uninstall via that entry or
`<install dir>\uninstall.ps1` (keeps user saves in %APPDATA%\Godot).

## VM test (~/src/infra/win-devvm, Windows 11)
    ./vm.sh push <zip> ratops/    # 3.5 s for 675 MB (SLIRP)
    ./vm.sh ssh '...'             # tar -xf zip (2.3 s), install.ps1 (3.3 s), launch, uninstall.ps1 -Quiet
`--headless --quit-after 120` exits 0 in ~3 s. Windowed runs (d3d12/vulkan) exit 0 immediately with no log because
the SSH session has no interactive desktop (`query user` empty); opengl3 hangs until killed. Verifying the renderer
needs an interactive logon (autologon + reboot, or RDP) which was not done. Unsigned: SmartScreen warns.

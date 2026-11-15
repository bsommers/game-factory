#!/bin/sh
# usage: tools/smoke_windows.sh [zip]   Windows VM (~/src/infra/win-devvm) smoke: push zip, verify sha256, extract,
# install -Quiet, launch installed exe headless (300 frames), uninstall, verify the folder is gone.
# Learnings baked in: the guest dir must exist before push; the VM shell is PowerShell; uninstall deletes its folder
# from a detached cmd, which an ssh session kills on exit, so we wait IN-SESSION before checking.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
Z="${1:-$(ls -t "$ROOT"/dist/*windows*setup.zip | head -1)}"
VM="${WIN_VM_DIR:-$HOME/src/infra/win-devvm}"
cd "$VM"
./vm.sh ssh 'New-Item -ItemType Directory -Force cf | Out-Null; Remove-Item -Recurse -Force cf\x -ErrorAction SilentlyContinue' >/dev/null
./vm.sh push "$Z" cf/ >/dev/null
LOCAL="$(sha256sum "$Z" | cut -c1-64)"; B="$(basename "$Z")"
OUT="$(./vm.sh ssh '$ErrorActionPreference="Continue"; cd cf; $h=(Get-FileHash '"$B"' -Algorithm SHA256).Hash.ToLower(); "sha="+$h; mkdir x | Out-Null; tar -xf '"$B"' -C x; $s=(Get-ChildItem x -Recurse -Filter install.ps1 | Select-Object -First 1).DirectoryName; powershell -ExecutionPolicy Bypass -File "$s\install.ps1" -Quiet; "install_exit=$LASTEXITCODE"; $d="$env:LOCALAPPDATA\Programs\CheeseFantasy"; $exe=(Get-ChildItem $d -Filter *.exe | Select-Object -First 1).FullName; $p=Start-Process -FilePath $exe -ArgumentList "--headless","--quit-after","300" -RedirectStandardOutput "$env:TEMP\o.log" -RedirectStandardError "$env:TEMP\e.log" -PassThru -Wait; "run_exit="+$p.ExitCode; "script_errors="+((Get-Content "$env:TEMP\o.log","$env:TEMP\e.log" | Select-String "SCRIPT ERROR|Parse Error|Failed loading").Count); powershell -ExecutionPolicy Bypass -File "$d\uninstall.ps1" -Quiet; Start-Sleep 8; "uninstall_clean="+(-not (Test-Path $d))' 2>&1)"
echo "$OUT" | grep -E '^(sha|install_exit|run_exit|script_errors|uninstall_clean)='
echo "$OUT" | grep -q "^sha=$LOCAL" || { echo "SMOKE_WINDOWS FAIL: sha mismatch"; exit 1; }
echo "$OUT" | grep -q '^install_exit=0' && echo "$OUT" | grep -q '^run_exit=0' && echo "$OUT" | grep -q '^script_errors=0' && echo "$OUT" | grep -q '^uninstall_clean=True' \
  && echo "SMOKE_WINDOWS OK $(basename "$Z")" || { echo "SMOKE_WINDOWS FAIL"; exit 1; }

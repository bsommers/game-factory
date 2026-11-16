#!/bin/sh
# usage: desktop/smoke_windows.sh [zip]  Windows VM (~/src/infra/win-devvm) smoke of the SHIPPED zip: push, sha256 check,
# extract, launch catxzzon.exe in browser mode (embedded server, no window), fetch index.html + app.js over HTTP, stop it.
# Prints SMOKE_WINDOWS SKIP (exit 0) when the VM is unreachable. VM shell is PowerShell; guest dir must exist before push.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
Z="${1:-$(ls -t "$ROOT"/dist/desktop/*win-x64.zip | head -1)}"
VM="${WIN_VM_DIR:-$HOME/src/infra/win-devvm}"
[ -x "$VM/vm.sh" ] || { echo "SMOKE_WINDOWS SKIP: no $VM/vm.sh"; exit 0; }
cd "$VM"
timeout 60 ./vm.sh ssh 'New-Item -ItemType Directory -Force cx | Out-Null; Remove-Item -Recurse -Force cx\x -ErrorAction SilentlyContinue' >/dev/null 2>&1 \
  || { echo "SMOKE_WINDOWS SKIP: VM unreachable"; exit 0; }
./vm.sh push "$Z" cx/ >/dev/null
LOCAL="$(sha256sum "$Z" | cut -c1-64)"; B="$(basename "$Z")"
OUT="$(timeout 180 ./vm.sh ssh '$ErrorActionPreference="Continue"; cd cx; "sha="+(Get-FileHash '"$B"' -Algorithm SHA256).Hash.ToLower(); mkdir x | Out-Null; tar -xf '"$B"' -C x; $e=(Get-ChildItem x -Recurse -Filter catxzzon.exe | Select-Object -First 1); "exe_found="+[bool]$e; $p=Start-Process -FilePath $e.FullName -ArgumentList "--mode=browser","--port=47931" -PassThru -WindowStyle Hidden; Start-Sleep 4; try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:47931/; "index_ok="+($r.Content -match "CATXZZON"); $j=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:47931/app.js; "app_js_ok="+($j.Content.Length -gt 1000) } catch { "index_ok=False"; "app_js_ok=False" }; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Start-Sleep 1; "stopped="+(-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)); Remove-Item -Recurse -Force x' 2>&1)" || true
echo "$OUT" | grep -E '^(sha|exe_found|index_ok|app_js_ok|stopped)=' || echo "$OUT" | tail -5
echo "$OUT" | grep -q "^sha=$LOCAL" || { echo "SMOKE_WINDOWS FAIL: sha mismatch/no output"; exit 1; }
echo "$OUT" | grep -q '^exe_found=True' && echo "$OUT" | grep -q '^index_ok=True' && echo "$OUT" | grep -q '^app_js_ok=True' && echo "$OUT" | grep -q '^stopped=True' \
  && echo "SMOKE_WINDOWS OK $B" || { echo "SMOKE_WINDOWS FAIL"; exit 1; }

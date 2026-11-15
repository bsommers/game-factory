# KASEKRIEG: RAT OPS installer. Per-user by default (no admin); -AllUsers installs to Program Files (needs admin).
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1 [-AllUsers] [-InstallDir <path>] [-Quiet]
param([switch]$AllUsers, [string]$InstallDir = "", [switch]$Quiet)
$ErrorActionPreference = "Stop"
$name = "KASEKRIEG RAT OPS"; $exe = "KasekriegRatOps.exe"; $src = $PSScriptRoot
if (-not $InstallDir) {
  $InstallDir = if ($AllUsers) { Join-Path $env:ProgramFiles "KasekriegRatOps" } else { Join-Path $env:LOCALAPPDATA "Programs\KasekriegRatOps" }
}
if (-not (Test-Path (Join-Path $src $exe))) { throw "$exe not found next to install.ps1" }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item (Join-Path $src $exe) $InstallDir -Force
Copy-Item (Join-Path $src "uninstall.ps1") $InstallDir -Force
$menu = if ($AllUsers) { Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs" } else { Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs" }
$lnk = Join-Path $menu "$name.lnk"
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk); $s.TargetPath = Join-Path $InstallDir $exe; $s.WorkingDirectory = $InstallDir; $s.Save()
$root = if ($AllUsers) { "HKLM:" } else { "HKCU:" }
$key = "$root\Software\Microsoft\Windows\CurrentVersion\Uninstall\KasekriegRatOps"
New-Item -Force -Path $key | Out-Null
$un = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""
$size = [int]((Get-Item (Join-Path $InstallDir $exe)).Length / 1KB)
@{ DisplayName=$name; DisplayVersion="1.0"; Publisher="RAT OPS"; InstallLocation=$InstallDir; DisplayIcon=(Join-Path $InstallDir $exe);
   UninstallString=$un; QuietUninstallString="$un -Quiet"; NoModify=1; NoRepair=1; EstimatedSize=$size }.GetEnumerator() | ForEach-Object {
  $t = if ($_.Value -is [int]) { "DWord" } else { "String" }; New-ItemProperty -Path $key -Name $_.Key -Value $_.Value -PropertyType $t -Force | Out-Null }
# remember scope for the uninstaller
Set-Content (Join-Path $InstallDir "install.scope") ($(if ($AllUsers) { "all" } else { "user" }))
if (-not $Quiet) { Write-Host "Installed to $InstallDir ; Start Menu: $lnk" }

# Install __TITLE__ for the current user: copies to %LOCALAPPDATA%\Programs\__SLUG__ and adds a Start Menu shortcut.
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1 [-Uninstall]   (not yet tested on a real Windows machine)
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\__SLUG__'
$lnk  = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\__TITLE__.lnk'
if ($Uninstall) { Remove-Item -Recurse -Force $dest, $lnk -ErrorAction SilentlyContinue; Write-Host 'removed __TITLE__'; exit 0 }
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $src '__SLUG__.exe'))) { throw 'run install.ps1 from the unpacked __SLUG__ folder' }
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $src '*') $dest -Recurse -Force
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = Join-Path $dest '__SLUG__.exe'; $s.WorkingDirectory = $dest; $s.Save()
Write-Host "installed __TITLE__ -> $dest (Start Menu: __TITLE__)"

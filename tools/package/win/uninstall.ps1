param([switch]$Quiet)
$ErrorActionPreference = "Continue"
$dir = $PSScriptRoot; $name = "KASEKRIEG RAT OPS"
$all = (Test-Path "$dir\install.scope") -and ((Get-Content "$dir\install.scope") -eq "all")
$menu = if ($all) { Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs" } else { Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs" }
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $menu "$name.lnk")
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "$(if ($all) {'HKLM:'} else {'HKCU:'})\Software\Microsoft\Windows\CurrentVersion\Uninstall\KasekriegRatOps"
# user data (saves/settings in %APPDATA%\Godot\app_userdata) is kept.
# A running script cannot delete its own folder: delete from a detached cmd after we exit.
Start-Process cmd.exe -WindowStyle Hidden -ArgumentList "/c ping -n 3 127.0.0.1 >nul & rd /s /q `"$dir`""
if (-not $Quiet) { Write-Host "Uninstalled $name" }

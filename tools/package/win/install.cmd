@echo off
rem Double-click installer: per-user install. Run "install.cmd /allusers" (as admin) for Program Files.
if /i "%~1"=="/allusers" (powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -AllUsers) else (powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1")
pause

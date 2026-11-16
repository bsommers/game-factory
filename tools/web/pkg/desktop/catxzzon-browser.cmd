@echo off
rem Plays CATXZZON in your default browser (embedded static server) - use if WebView2 is unavailable.
start "" "%~dp0catxzzon.exe" --mode=browser

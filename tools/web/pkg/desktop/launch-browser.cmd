@echo off
rem Plays __TITLE__ in your default browser (embedded static server) - use if WebView2 is unavailable.
start "" "%~dp0__SLUG__.exe" --mode=browser

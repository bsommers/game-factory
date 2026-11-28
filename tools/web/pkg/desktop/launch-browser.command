#!/bin/sh
# Plays __TITLE__ in your default browser (embedded static server).
D="$(cd "$(dirname "$0")" && pwd)"
exec "$D/__TITLE__.app/Contents/MacOS/__SLUG__" --mode=browser

#!/bin/sh
# Plays CATXZZON in your default browser (embedded static server).
D="$(cd "$(dirname "$0")" && pwd)"
exec "$D/CATXZZON.app/Contents/MacOS/catxzzon" --mode=browser

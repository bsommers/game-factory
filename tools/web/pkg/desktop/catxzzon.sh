#!/bin/sh
# CATXZZON launcher. Native window (needs webkit2gtk-4.1 + gtk3); falls back to your default browser
# (embedded static server) when the webview is missing, or when run with --browser.
D="$(cd "$(dirname "$0")" && pwd)"
if [ "$1" = "--browser" ]; then shift; exec "$D/catxzzon" --mode=browser "$@"; fi
if ldconfig -p 2>/dev/null | grep -q 'libwebkit2gtk-4\.1' && ldconfig -p 2>/dev/null | grep -q 'libgtk-3\.so'; then
  exec "$D/catxzzon" "$@"
fi
echo "catxzzon: webkit2gtk-4.1 not found -> opening in your browser (install libwebkit2gtk-4.1-0 for a native window)" >&2
exec "$D/catxzzon" --mode=browser "$@"

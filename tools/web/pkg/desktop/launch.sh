#!/bin/sh
# __TITLE__ launcher. Native window (needs webkit2gtk-4.1 + gtk3); falls back to your default browser
# (embedded static server) when the webview is missing, or when run with --browser.
D="$(dirname "$(readlink -f "$0")")"
if [ "$1" = "--browser" ]; then shift; exec "$D/__SLUG__" --mode=browser "$@"; fi
if ldconfig -p 2>/dev/null | grep -q 'libwebkit2gtk-4\.1' && ldconfig -p 2>/dev/null | grep -q 'libgtk-3\.so'; then
  exec "$D/__SLUG__" "$@"
fi
echo "__SLUG__: webkit2gtk-4.1 not found -> opening in your browser (install libwebkit2gtk-4.1-0 for a native window)" >&2
exec "$D/__SLUG__" --mode=browser "$@"

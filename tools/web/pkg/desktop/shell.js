// Desktop shell glue (injected into the desktop copy of index.html only; not part of the web build).
// F11 toggles fullscreen; closing the window exits the process. Safe in browser mode (no-ops).
(function () {
  if (typeof Neutralino === 'undefined' || !window.NL_TOKEN && !window.NL_PORT) return;
  try { Neutralino.init(); } catch (e) { return; }
  var windowMode = window.NL_MODE === 'window';
  if (windowMode) {
    Neutralino.events.on('windowClose', function () { Neutralino.app.exit(); });
    var full = false;
    window.addEventListener('keydown', function (e) {
      if (e.key !== 'F11') return;
      e.preventDefault();
      full = !full;
      (full ? Neutralino.window.setFullScreen() : Neutralino.window.exitFullScreen()).catch(function () { full = !full; });
    });
  }
})();

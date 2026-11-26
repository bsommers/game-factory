// Per-game identity. __SLUG__ is substituted by the scaffolder; it namespaces localStorage keys
// so several games served from one origin (e.g. GitHub Pages) never share scores or settings.
export const GAME_ID = '__SLUG__';

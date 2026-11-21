# Theming ASCII Terminal

Text-grid game for the terminal or a canvas monospace grid: glyph tiles, 16 or 256 ANSI colours, keyboard play, minimal audio.

Apply a theme with `styles.apply` (theme.json mixin). Guidance for this style:

- Pick a 16-colour ANSI palette and map roles (wall, floor, hero, enemy, item); assume a dark background.
- A glyph table per theme: for example jungle uses " . , ^ & # %"; space uses " . * + o O @".
- No fonts: the terminal supplies it; set a title banner in a block-letter table.
- Audio: a bell on key events; optional WAV through the platform player.
- Title: a boxed banner with a one-line tagline and a controls list.

Limits: no mouse in some terminals; no sound beyond the bell without a player.

Pitfalls: terminal state not restored on crash: install exit handlers; unicode width differences between terminals; colour support detection (NO_COLOR, TERM); blocking input in the game loop.

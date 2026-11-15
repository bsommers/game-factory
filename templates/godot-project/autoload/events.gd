extends Node
## Events — the cross-module signal bus (ARCHITECTURE section 4).
## Modules emit and connect here instead of holding references to each other.
## Signals marked "contract" are required by ARCHITECTURE.md; the rest are additive helpers.

# --- contract signals -------------------------------------------------------
signal player_hurt(dmg: int)
signal player_died
signal enemy_killed(kind: String, pos: Vector3)
signal pickup_taken(kind: String, amount: int)
signal weapon_changed(id: String)
signal ammo_changed(cur: int, reserve: int)
signal health_changed(hp: int, lives: int)
signal door_opened(id: String)
signal secret_found
signal level_completed(stats: Dictionary)
signal message(text: String)

# --- additive signals (game flow / settings / tooling) ----------------------
## Game state machine changed (`Game.State` values as ints).
signal state_changed(new_state: int, old_state: int)
## A level scene finished building and is in the tree.
signal level_loaded(id: String)
## Request to load a level (UI -> Game); Game handles it.
signal level_requested(id: String)
## Score changed (total).
signal score_changed(score: int)
## Player picked up a key ("gold" / "silver").
signal key_taken(color: String)
## Settings were changed and applied.
signal settings_changed
## Pause toggled.
signal paused_changed(is_paused: bool)
## Play a named sound effect (names from Defs.SFX) at a position (Vector3.INF = non-positional).
signal sfx(sound_name: String, pos: Vector3)
## Change music track (names from Defs.MUSIC; "" stops).
signal music(track: String)

# --- integration additions (integ-lead) -------------------------------------
## Hit feedback for the HUD: kill = the shot killed, head = headshot.
signal hit_marker(kill: bool, head: bool)
## Current weapon spread in radians (crosshair size).
signal crosshair_spread(radians: float)
## An enemy noticed the player / got hurt / a locked door was tried (audio + HUD).
signal enemy_alerted(kind: String, pos: Vector3)
signal enemy_hurt(kind: String, pos: Vector3)
signal door_locked(id: String)
## Loud noise at a position (radius in metres) so enemies can hear shots.
signal noise(pos: Vector3, radius: float)

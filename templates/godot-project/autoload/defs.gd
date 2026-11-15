extends Node
## Game definitions (weapons, enemies, items, scoring). Keep numbers in ONE place so tests, AI and UI agree.
## Stub from game-factory: the symbols below are required by autoload/game.gd; replace the data, keep the API.
const START: Dictionary = {"health": 100, "lives": 3, "ammo": {}, "owned": [], "weapon": 0}
const SKILLS: Array = [{"id": 0, "name": "Easy", "dmg_taken": 0.6, "enemy_hp": 0.8, "reaction": 1.3},
	{"id": 1, "name": "Normal", "dmg_taken": 1.0, "enemy_hp": 1.0, "reaction": 1.0},
	{"id": 2, "name": "Hard", "dmg_taken": 1.4, "enemy_hp": 1.25, "reaction": 0.7}]
const DEFAULT_SKILL: int = 1
## [id, display name, par seconds]
const LEVELS: Array = [["level1", "Level 1", 300]]
const SCORING: Dictionary = {"kill_ratio_100": 500, "secret_ratio_100": 500, "item_ratio_100": 500, "par_bonus": 1000}

func level_index(id: String) -> int:
	for i: int in LEVELS.size():
		if LEVELS[i][0] == id:
			return i
	return -1

func level_par(id: String) -> int:
	var i: int = level_index(id)
	return LEVELS[i][2] if i >= 0 else 0

func intermission_bonus(stats: Dictionary) -> int:
	var b: int = 0
	if int(stats.get("kills_total", 0)) > 0 and int(stats.get("kills", 0)) >= int(stats.get("kills_total", 0)):
		b += int(SCORING["kill_ratio_100"])
	return b

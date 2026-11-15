extends Node
## Game — global game-flow state machine (ARCHITECTURE sections 4 and 6).
## States: TITLE, PLAYING, PAUSED, INTERMISSION, GAME_OVER, VICTORY.
## Owns lives, score, level index, the player's carried weapons/ammo snapshot and level loading by id.
## Other modules talk to it through the `Events` bus; it never holds references to their nodes
## except the level root it instantiates.

enum State { TITLE, PLAYING, PAUSED, INTERMISSION, GAME_OVER, VICTORY }

const STATE_NAMES: PackedStringArray = ["title", "playing", "paused", "intermission", "game_over", "victory"]
## Level scene that the level-builder module provides. Game instantiates it and hands it the id.
const LEVEL_SCENE: String = "res://scenes/level_base.tscn"
## Scripts tried (in order) when the scene is missing: a builder exposing build(id) / load_level(id).
const LEVEL_BUILDER_SCRIPTS: PackedStringArray = ["res://scripts/level/level_builder.gd"]

var state: State = State.TITLE
var lives: int = 9
var score: int = 0
var level_index: int = -1
var level_id: String = ""
var skill: int = 2
## Player loadout carried between levels: {health, ammo{}, owned[], weapon}.
var loadout: Dictionary = {}
## Per-level stats (kills, secrets, treasure, totals, time, par).
var stats: Dictionary = {}

## Snapshot taken when a level starts; restored on death (reference rule).
var _level_start_score: int = 0
var _level_start_loadout: Dictionary = {}
var _level_root: Node = null
var _level_parent: Node = null
var _level_time: float = 0.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_reset_run()
	Events.level_requested.connect(func(id: String) -> void: start_level(id))
	Events.player_died.connect(on_player_died)
	Events.level_completed.connect(func(s: Dictionary) -> void: complete_level(s))
	Events.enemy_killed.connect(_on_enemy_killed)
	Events.secret_found.connect(_on_secret_found)
	Events.pickup_taken.connect(_on_pickup_taken)


func _process(delta: float) -> void:
	if state == State.PLAYING:
		_level_time += delta


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") and (state == State.PLAYING or state == State.PAUSED):
		toggle_pause()
		get_viewport().set_input_as_handled()


# ───────────────────────────── state machine ─────────────────────────────
## Allowed transitions. Any state may go to TITLE (quit to menu).
const _TRANSITIONS: Dictionary = {
	State.TITLE: [State.PLAYING],
	State.PLAYING: [State.PAUSED, State.INTERMISSION, State.GAME_OVER, State.VICTORY, State.PLAYING],
	State.PAUSED: [State.PLAYING],
	State.INTERMISSION: [State.PLAYING, State.VICTORY],
	State.GAME_OVER: [State.PLAYING],
	State.VICTORY: [],
}


func can_transition(to: State) -> bool:
	if to == State.TITLE:
		return true
	return to in _TRANSITIONS.get(state, [])


## Returns false (and changes nothing) for an illegal transition.
func set_state(to: State) -> bool:
	if not can_transition(to):
		push_warning("Game: illegal transition %s -> %s" % [state_name(state), state_name(to)])
		return false
	var old: State = state
	state = to
	var tree: SceneTree = get_tree()
	if tree != null:
		tree.paused = (to == State.PAUSED)
	if old != to:
		Events.state_changed.emit(int(to), int(old))
		if to == State.PAUSED or old == State.PAUSED:
			Events.paused_changed.emit(to == State.PAUSED)
	return true


func state_name(s: int = -1) -> String:
	var v: int = int(state) if s < 0 else s
	return STATE_NAMES[v] if v >= 0 and v < STATE_NAMES.size() else "?"


func toggle_pause() -> void:
	if state == State.PLAYING:
		set_state(State.PAUSED)
	elif state == State.PAUSED:
		set_state(State.PLAYING)


# ───────────────────────────── run / level flow ─────────────────────────────
## New game from the title: resets lives, score and loadout, then loads `id` (default first level).
func new_game(id: String = "", skill_level: int = -1) -> void:
	skill = Defs.DEFAULT_SKILL if skill_level < 0 else clampi(skill_level, 0, Defs.SKILLS.size() - 1)
	_reset_run()
	if state != State.TITLE:
		set_state(State.TITLE)
	start_level(id if id != "" else String(Defs.LEVELS[0][0]))


## Load a level by id ("e1m1".."e1m6"). Snapshots score/loadout for death restore.
func start_level(id: String) -> bool:
	var idx: int = Defs.level_index(id)
	if idx < 0:
		push_error("Game: unknown level id '%s'" % id)
		return false
	level_index = idx
	level_id = id
	_level_start_score = score
	_level_start_loadout = loadout.duplicate(true)
	_reset_stats()
	if state == State.PAUSED:
		set_state(State.PLAYING)
	set_state(State.PLAYING)
	_spawn_level(id)
	return true


func restart_level() -> void:
	if level_id != "":
		start_level(level_id)


## Reference rule: lose a life; restore the level-start score and weapons; game over at 0 lives.
func on_player_died() -> void:
	if state != State.PLAYING:
		return
	lives -= 1
	score = _level_start_score
	loadout = _level_start_loadout.duplicate(true)
	loadout["health"] = int(Defs.START["health"])
	Events.score_changed.emit(score)
	Events.health_changed.emit(int(loadout["health"]), lives)
	if lives <= 0:
		set_state(State.GAME_OVER)
	else:
		_level_start_loadout = loadout.duplicate(true)
		restart_level()


## Called on exit switch. Adds bonus and goes to INTERMISSION (or VICTORY after the last level).
func complete_level(extra: Dictionary = {}) -> void:
	if state != State.PLAYING:
		return
	stats.merge(extra, true)
	stats["time"] = _level_time
	stats["par"] = Defs.level_par(level_id)
	var bonus: int = Defs.intermission_bonus(stats)
	stats["bonus"] = bonus
	add_score(bonus)
	if level_index >= Defs.LEVELS.size() - 1:
		set_state(State.VICTORY)
	else:
		set_state(State.INTERMISSION)


## From INTERMISSION: load the next level.
func next_level() -> void:
	if state != State.INTERMISSION:
		return
	var nxt: int = level_index + 1
	if nxt >= Defs.LEVELS.size():
		set_state(State.VICTORY)
		return
	start_level(String(Defs.LEVELS[nxt][0]))


func quit_to_title() -> void:
	_free_level()
	set_state(State.TITLE)


func add_score(points: int) -> void:
	score += points
	Events.score_changed.emit(score)


# ───────────────────────────── level instancing ─────────────────────────────
## Where levels are parented (main.tscn registers a container). Defaults to the current scene.
func set_level_parent(node: Node) -> void:
	_level_parent = node


func current_level() -> Node:
	return _level_root


func _spawn_level(id: String) -> void:
	_free_level()
	var parent: Node = _level_parent
	if parent == null or not is_instance_valid(parent):
		var tree: SceneTree = get_tree()
		parent = tree.current_scene if tree != null else null
	if parent == null:
		return  # headless logic tests: state only, no scene
	var lvl: Node = _instantiate_level(id)
	lvl.name = "Level_%s" % id
	parent.add_child(lvl)
	_level_root = lvl
	Events.level_loaded.emit(id)


func _instantiate_level(id: String) -> Node:
	var node: Node = null
	if ResourceLoader.exists(LEVEL_SCENE):
		var ps: PackedScene = load(LEVEL_SCENE) as PackedScene
		if ps != null:
			node = ps.instantiate()
	if node == null:
		for path: String in LEVEL_BUILDER_SCRIPTS:
			if ResourceLoader.exists(path):
				var scr: Script = load(path) as Script
				if scr != null and scr.can_instantiate():
					var obj: Object = scr.new()
					if obj is Node:
						node = obj as Node
						break
	if node == null:
		push_warning("Game: no level scene/builder yet; using empty placeholder for %s" % id)
		node = Node3D.new()
	# Hand over the id without a hard dependency on the builder's API.
	node.set_meta("level_id", id)
	if "level_id" in node:
		node.set("level_id", id)
	for m: String in ["build_level", "load_level"]:  # LevelBuilder.build_level(id); build() takes a Dictionary
		if node.has_method(m):
			node.call_deferred(m, id)
			break
	return node


func _free_level() -> void:
	if _level_root != null and is_instance_valid(_level_root):
		_level_root.queue_free()
	_level_root = null


# ───────────────────────────── stats ─────────────────────────────
func _reset_run() -> void:
	lives = int(Defs.START["lives"])
	score = 0
	level_index = -1
	level_id = ""
	loadout = {
		"health": int(Defs.START["health"]),
		"ammo": (Defs.START["ammo"] as Dictionary).duplicate(true),
		"owned": (Defs.START["owned"] as Array).duplicate(),
		"weapon": int(Defs.START["weapon"]),
	}
	_reset_stats()


func _reset_stats() -> void:
	_level_time = 0.0
	stats = {"kills": 0, "kills_total": 0, "secrets": 0, "secrets_total": 0,
		"treasure": 0, "treasure_total": 0, "time": 0.0, "par": 0}


func _on_enemy_killed(kind: String, _pos: Vector3) -> void:
	stats["kills"] = int(stats["kills"]) + 1
	add_score(int(Defs.enemy(kind).get("score", 0)))


func _on_secret_found() -> void:
	stats["secrets"] = int(stats["secrets"]) + 1


func _on_pickup_taken(kind: String, _amount: int) -> void:
	var it: Dictionary = Defs.item(kind)
	var pts: int = int(it.get("score", 0))
	if pts > 0:
		stats["treasure"] = int(stats["treasure"]) + 1
		add_score(pts)

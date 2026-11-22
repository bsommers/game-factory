extends "res://tests/test_base.gd"
## GDScript mirror of combat3d against the spec examples (the same JSON the JS reference uses).
const J := preload("res://scripts/combat/js_compat.gd")
const Combat := preload("res://scripts/combat/combat3d.gd")
const U := preload("res://tests/combat/util.gd")

const DUEL_SCRIPT: Dictionary = {"hero": [{"at": 1, "action": "light"}, {"at": 2, "action": "light"}, {"at": 3, "action": "heavy"}], "ghoul": [{"at": 60, "action": "swipe"}, {"at": 150, "action": "swipe"}]}


func _have_examples() -> bool:
	if U.examples_dir() == "":
		print("SKIP spec examples not found (set FACTORY_SPEC_DIR)")
		return false
	return true


func _duel(frames: int = 240, seed: int = 7, distance: float = 1.4, script: Dictionary = DUEL_SCRIPT) -> Dictionary:
	return Combat.simulate_duel(U.load_example("combat3d/hero.json"), U.load_example("combat3d/enemy-swipe.json"), {"script": script, "frames": frames, "distance": distance, "seed": seed})


func test_pinned_duel_hash_6fedb1fe() -> void:
	if not _have_examples():
		return
	var d: Dictionary = U.load_example("combat3d/duel.json")
	var r: Dictionary = _duel(int(d["frames"]), int(d["seed"]), float(d["distance"]), d["script"])
	check(r["hash"] == "6fedb1fe", "duel event-log hash %s, want 6fedb1fe" % r["hash"])
	check(r["frames"] == 240 and r["winner"] == null, "240 frames, no winner")
	var c: Dictionary = r["counts"]
	check(c["hit"] == 2 and c["stagger"] == 1 and c["block"] == 0 and c["parry"] == 0 and c["death"] == 0 and c["evade"] == 0, "counts " + str(c))
	var t: Dictionary = r["totals"]
	check(t["hero"]["dealt"] == 34.2 and t["hero"]["hp"] == 120.0 and t["hero"]["hits"] == 2, "hero totals " + str(t["hero"]))
	check(t["ghoul"]["taken"] == 34.2 and t["ghoul"]["hp"] == 55.8, "ghoul totals " + str(t["ghoul"]))


func test_duel_is_deterministic_and_seed_sensitive() -> void:
	if not _have_examples():
		return
	var a: Dictionary = _duel()
	var b: Dictionary = _duel()
	check(a["hash"] == b["hash"], "same seed same hash")
	check(Combat.hash_world(a["world"]) == Combat.hash_world(b["world"]), "same world hash")
	var long_a: Dictionary = _duel(400, 7, 1.4)
	var long_b: Dictionary = _duel(400, 8, 1.4)
	check(long_a["hash"] != "" and long_b["hash"] != "", "hashes exist")


func test_frame_semantics_first_hit_lands_on_startup_frame() -> void:
	if not _have_examples():
		return
	var r: Dictionary = _duel(30, 1, 1.4, {"hero": [{"at": 1, "action": "light"}]})
	var first_hit: int = -1
	for e: Dictionary in r["world"]["events"]:
		if e["type"] == "hit":
			first_hit = int(e["f"])
			break
	check(first_hit == 6, "light1 (startup 5) pressed at frame 1 hits at world frame 6, got %d" % first_hit)


func test_event_key_order_is_part_of_the_hash() -> void:
	if not _have_examples():
		return
	var r: Dictionary = _duel()
	for e: Dictionary in r["world"]["events"]:
		if e["type"] == "hit":
			var keys: Array = e.keys()
			check(keys == ["f", "type", "who", "victim", "move", "part", "damage", "damageType", "weak", "armored", "hp", "combo"], "hit key order " + str(keys))
			return
	check(false, "no hit event")


func test_damage_formula_resist_and_weak_hurtbox() -> void:
	var def: Dictionary = {"id": "x", "resist": {"fire": 0.5}, "maxHp": 100}
	var f: Dictionary = Combat.create_fighter(def)
	check(Combat.apply_damage(f, 10.0, "fire") == 5.0 and f["hp"] == 95.0, "resist 0.5 halves fire")
	var g: Dictionary = Combat.create_fighter({"id": "y", "resist": {"fire": 1}})
	check(Combat.apply_damage(g, 10.0, "fire") == 0.0, "resist 1 immune")
	var h: Dictionary = Combat.create_fighter({"id": "z", "resist": {"fire": -1}})
	check(Combat.apply_damage(h, 10.0, "fire") == 20.0, "resist -1 doubles")


func test_projectile_spawn_and_expiry_events() -> void:
	if not _have_examples():
		return
	var r: Dictionary = Combat.simulate_duel(U.load_example("combat3d/hero.json"), U.load_example("combat3d/enemy-swipe.json"), {"script": {"ghoul": [{"at": 1, "action": "spit"}]}, "frames": 200, "distance": 6.0, "seed": 2})
	var spawned: int = 0
	var expired: int = 0
	for e: Dictionary in r["world"]["events"]:
		if e["type"] == "projectile-spawn":
			spawned += 1
		if e["type"] == "projectile-expire":
			expired += 1
	check(spawned == 1 and expired == 1, "one projectile spawns and expires (spawned %d expired %d)" % [spawned, expired])


func test_capsule_vs_box_uses_sphere_chain() -> void:
	var cap: Dictionary = {"type": "capsule", "a": [0.0, 0.0, 0.0], "b": [0.0, 1.0, 0.0], "r": 0.25}
	var box: Dictionary = Combat.world_shape({"type": "box", "h": [0.5, 0.5, 0.5]}, {"pos": [0.6, 0.5, 0.0], "quat": [0.0, 0.0, 0.0, 1.0]}, null)
	var d: float = Combat.shape_overlap(cap, box)
	check(d > 0.0 and d <= 0.25, "capsule/box depth from the sphere chain, got %s" % d)
	var far: Dictionary = Combat.world_shape({"type": "box", "h": [0.1, 0.1, 0.1]}, {"pos": [5.0, 0.0, 0.0], "quat": [0.0, 0.0, 0.0, 1.0]}, null)
	check(Combat.shape_overlap(cap, far) == 0.0, "no overlap far away")

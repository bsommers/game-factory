extends "res://tests/test_base.gd"
## GDScript mirror of boss3d against the spec examples; hashes are the ones the JS reference prints for the same seeds.
const J := preload("res://scripts/combat/js_compat.gd")
const Boss := preload("res://scripts/boss/boss3d.gd")
const U := preload("res://tests/combat/util.gd")


func _def(name: String) -> Variant:
	var d: Variant = U.load_example("boss3d/%s.json" % name)
	if d == null:
		print("SKIP spec examples not found (set FACTORY_SPEC_DIR)")
	return d


func test_hydra_simulate_hash_matches_js() -> void:
	var def: Variant = _def("hydra")
	if def == null:
		return
	var sim: Dictionary = Boss.simulate(def, {"runs": 3, "seed": 1})
	check(sim["hash"] == "bf579cc4", "hydra simulate(runs 3, seed 1) hash %s, want bf579cc4" % sim["hash"])
	var hashes: Array = []
	for r: Dictionary in sim["results"]:
		hashes.append(r["logHash"])
	check(hashes == ["54005500", "33904cbd", "1c9ad837"], "per-run log hashes " + str(hashes))
	check(sim["winRate"] == 0.6667, "winRate %s" % sim["winRate"])


func test_vortex_simulate_hash_matches_js() -> void:
	var def: Variant = _def("vortex")
	if def == null:
		return
	var sim: Dictionary = Boss.simulate(def, {"runs": 3, "seed": 1})
	check(sim["hash"] == "e34529a4", "vortex simulate(runs 3, seed 1) hash %s, want e34529a4" % sim["hash"])


func test_same_seed_same_log_different_seed_differs() -> void:
	var def: Variant = _def("hydra")
	if def == null:
		return
	var a: Dictionary = Boss.run_fight(def, {"seed": 4})
	var b: Dictionary = Boss.run_fight(def, {"seed": 4})
	var c: Dictionary = Boss.run_fight(def, {"seed": 5})
	check(a["logHash"] == b["logHash"], "deterministic")
	check(a["logHash"] != c["logHash"], "seed changes the fight")


func test_zone_geometry() -> void:
	var z: Dictionary = Boss.resolve_zone({"shape": "circle", "r": 2.0}, [0.0, 0.0, 0.0], [5.0, 0.0, 0.0], 0.0)
	check(Boss.zone_contains(z, [1.0, 0.0, 0.0]) and not Boss.zone_contains(z, [3.0, 0.0, 0.0]), "circle")
	check(Boss.zone_contains(z, [2.2, 0.0, 0.0], 0.3), "pad widens the zone")
	var ring: Dictionary = Boss.resolve_zone({"shape": "ring", "rInner": 3.0, "rOuter": 5.0}, [0.0, 0.0, 0.0], [9.0, 0.0, 0.0], 0.0)
	check(not Boss.zone_contains(ring, [1.0, 0.0, 0.0]) and Boss.zone_contains(ring, [4.0, 0.0, 0.0]), "ring")
	var jump: Dictionary = Boss.resolve_zone({"shape": "circle", "r": 4.0, "maxY": 0.9}, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], 0.0)
	check(Boss.zone_contains(jump, [1.0, 0.5, 0.0]) and not Boss.zone_contains(jump, [1.0, 1.5, 0.0]), "maxY lets a jump clear the zone")
	var line: Dictionary = Boss.resolve_zone({"shape": "line", "length": 6.0, "width": 1.0}, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], 0.0)
	check(Boss.zone_contains(line, [5.0, 0.0, 0.2]) and not Boss.zone_contains(line, [5.0, 0.0, 1.0]), "line")


func test_phase_and_part_events_appear() -> void:
	var def: Variant = _def("vortex")
	if def == null:
		return
	var r: Dictionary = Boss.run_fight(def, {"seed": 1, "log": true, "profile": {"hp": 2000.0, "dodgeSkill": 0.6, "attackDamage": 14.0}})
	var types: Dictionary = {}
	for e: Dictionary in r["log"]:
		types[e["type"]] = true
	for k: String in ["telegraph", "active", "hit", "phase", "hazardStart"]:
		check(types.has(k), "log has %s events" % k)

extends "res://tests/test_base.gd"
## Unit checks for rng, hashing, steering, A* and tokens (values cross-checked against the JS reference).
const A := preload("res://scripts/ai3d/ai3d_core.gd")
const NAV := preload("res://scripts/ai3d/ai3d_nav.gd")


func test_rng_matches_mulberry32() -> void:
	# JS: o={rng:1}; rngNext x3 -> reference values below (see test/godot-ai3d.test.mjs, which recomputes them from ai3d.js)
	var o: Dictionary = {"rng": 1}
	var vals: Array = [A.rng_next(o), A.rng_next(o), A.rng_next(o)]
	var ref: Variant = JSON.parse_string(FileAccess.get_file_as_string(ref_path()))
	if ref is Dictionary and ref.has("rng1"):
		for i in 3:
			check(absf(vals[i] - float(ref["rng1"][i])) < 1e-12, "rng[%d] %s != %s" % [i, vals[i], ref["rng1"][i]])
	for v: float in vals:
		check(v >= 0.0 and v < 1.0, "rng in [0,1)")


static func ref_path() -> String:
	if OS.get_environment("PARITY_DIR") != "":
		return OS.get_environment("PARITY_DIR").path_join("ai3d/units.json")
	return ProjectSettings.globalize_path("res://").path_join("../../spec/v4/parity/ai3d/units.json").simplify_path()


func test_hash_str() -> void:
	check(A.hash_str("a") == "e40c292c", "fnv1a('a')")
	check(A.hash_str("") == "811c9dc5", "fnv1a('')")


func test_num4_prints_like_js() -> void:
	check(A.num4(3.0) == "3", "3")
	check(A.num4(-0.00001) == "0", "-0 prints 0")
	check(A.num4(1.23456) == "1.2346", "1.2346")
	check(A.num4(-2.5) == "-2.5", "-2.5")
	check(A.num4(0.0001) == "0.0001", "0.0001")


func test_steering() -> void:
	var s: Dictionary = A.arrive([0.0, 0.0, 0.0], [0.0, 0.0, 1.0], 2.0, 0.2)
	check(absf(s["speed"] - 0.4444444444444444) < 1e-12, "arrive ramps speed")
	var f: Dictionary = A.flee([0.0, 0.0, 0.0], [3.0, 0.0, 0.0])
	check(f["dir"][0] == -1.0, "flee away from threat")
	var c: Dictionary = A.combine([{"dir": [1.0, 0.0, 0.0], "speed": 1.0, "weight": 1.0}, {"dir": [0.0, 0.0, 1.0], "speed": 1.0, "weight": 1.0}], 1.0)
	check(absf(c["speed"] - 1.0) < 1e-12, "combine clamps to cap")


func test_grid_astar_routes_around_wall() -> void:
	var blocked: Array = []
	blocked.resize(100)
	blocked.fill(0)
	for z in range(0, 8):
		blocked[z * 10 + 5] = 1
	var nav: RefCounted = NAV.create_grid({"origin": [0.0, 0.0], "cellSize": 1.0, "width": 10, "height": 10, "blocked": blocked})
	check(not nav.is_clear([1.5, 0.0, 3.5], [8.5, 0.0, 3.5]), "wall blocks straight line")
	var p: Variant = nav.find_path([1.5, 0.0, 3.5], [8.5, 0.0, 3.5])
	check(p != null and p.size() >= 2, "path exists")
	if p != null:
		var last: Array = p[p.size() - 1]
		check(absf(last[0] - 8.5) < 1e-9 and absf(last[2] - 3.5) < 1e-9, "path ends at goal")
		var pass_z: bool = false
		for w: Array in p:
			if w[2] > 8.0:
				pass_z = true
		check(pass_z, "path detours around the gap at z>=8")
	var sealed: Array = blocked.duplicate()
	for z in 8:
		sealed[z * 10 + 5] = 1
	sealed[8 * 10 + 5] = 1
	sealed[9 * 10 + 5] = 1
	var nav2: RefCounted = NAV.create_grid({"origin": [0.0, 0.0], "cellSize": 1.0, "width": 10, "height": 10, "blocked": sealed})
	check(nav2.find_path([1.5, 0.0, 3.5], [8.5, 0.0, 3.5]) == null, "sealed wall -> no path")


func test_tokens_cap_attackers() -> void:
	var g: Dictionary = A.create_group({"maxAttackers": 2, "ttl": 1.0})
	check(A.group_request(g, "a", 0.0), "a gets token")
	check(A.group_request(g, "b", 0.0), "b gets token")
	check(not A.group_request(g, "c", 0.0), "c denied at cap")
	check(A.group_request(g, "c", 1.5), "tokens expire after ttl")
	A.group_release(g, "c")
	check(not A.group_holds(g, "c", 1.5), "released")

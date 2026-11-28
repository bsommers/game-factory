extends "res://tests/test_base.gd"
## Decision-timeline parity of the GDScript ai3d core against the JS reference (spec/v4/parity/ai3d/*.json).
const A := preload("res://scripts/ai3d/ai3d_core.gd")


static func parity_dir() -> String:
	var env: String = OS.get_environment("PARITY_DIR")
	if env != "":
		return env.path_join("ai3d")
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--parity="):
			return a.substr(9)
	return ProjectSettings.globalize_path("res://").path_join("../../spec/v4/parity/ai3d").simplify_path()


func _load(name: String) -> Dictionary:
	var txt: String = FileAccess.get_file_as_string(parity_dir().path_join(name + ".json"))
	var d: Variant = JSON.parse_string(txt)
	check(d is Dictionary, "cannot read parity file %s in %s" % [name, parity_dir()])
	return d if d is Dictionary else {}


func _parity(name: String) -> void:
	var f: Dictionary = _load(name)
	if f.is_empty():
		return
	var exp: Dictionary = f["expected"]
	var got: Dictionary = A.simulate(f["scenario"])
	check(got["hash"] == exp["hash"], "%s: hash %s != JS %s" % [name, got["hash"], exp["hash"]])
	check(got["steps"] == int(exp["steps"]), "%s: steps" % name)
	var et: Array = exp["timeline"]
	var gt: Array = got["timeline"]
	check(gt.size() == et.size(), "%s: timeline length %d != JS %d" % [name, gt.size(), et.size()])
	for i in mini(gt.size(), et.size()):
		var g: Dictionary = gt[i]
		var e: Dictionary = et[i]
		var same: bool = absf(g["t"] - float(e["t"])) < 1e-9 and g["agent"] == e["agent"] and g["state"] == e["state"] and g["wantAttack"] == e["wantAttack"] and g["target"] == e["target"]
		for k in 3:
			same = same and absf(g["pos"][k] - float(e["pos"][k])) < 1e-9
		if not same:
			check(false, "%s: timeline[%d] %s != JS %s" % [name, i, JSON.stringify(g), JSON.stringify(e)])
			break
	for k: String in exp["attacks"]:
		check(int(got["attacks"].get(k, 0)) == int(exp["attacks"][k]), "%s: attacks[%s]" % [name, k])
	check(got["attacks"].size() == (exp["attacks"] as Dictionary).size(), "%s: attacker set" % name)
	check(int(got["stats"]["maxTokens"]) == int(exp["stats"]["maxTokens"]), "%s: maxTokens" % name)
	check(int(got["stats"]["maxSimultaneousAttacks"]) == int(exp["stats"]["maxSimultaneousAttacks"]), "%s: maxSimultaneousAttacks" % name)
	for i in (exp["final"] as Array).size():
		var ef: Dictionary = exp["final"][i]
		var gf: Dictionary = got["final"][i]
		check(gf["id"] == ef["id"] and gf["state"] == ef["state"] and gf["target"] == ef["target"], "%s: final[%d] state" % [name, i])
		for k in 3:
			check(absf(gf["pos"][k] - float(ef["pos"][k])) < 1e-9, "%s: final[%d] pos" % [name, i])


func test_grunt_parity() -> void:
	_parity("grunt")


func test_ranged_parity() -> void:
	_parity("ranged")


func test_charger_parity() -> void:
	_parity("charger")


func test_group_token_parity() -> void:
	_parity("group-token")


func test_deterministic_rerun() -> void:
	var f: Dictionary = _load("group-token")
	if f.is_empty():
		return
	check(A.simulate(f["scenario"])["hash"] == A.simulate(f["scenario"])["hash"], "same scenario must hash the same twice")

extends SceneTree
## Cross-runtime parity driver (used by the factory capability `parity.run`, also runnable by hand):
##   godot --headless --path <project> --script res://scripts/combat/parity_dump.gd -- --module=combat3d|boss3d --cases=<abs cases.json> --out=<abs result.json>
## Runs the GDScript mirror on the same example JSON the JS reference uses and writes canonical (ECMAScript-formatted) JSON results.
const J := preload("res://scripts/combat/js_compat.gd")
const Combat := preload("res://scripts/combat/combat3d.gd")
const Boss := preload("res://scripts/boss/boss3d.gd")


static func read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))


func _initialize() -> void:
	var a: Dictionary = {}
	for s: String in OS.get_cmdline_user_args():
		var kv: PackedStringArray = s.trim_prefix("--").split("=", true, 1)
		a[kv[0]] = kv[1] if kv.size() > 1 else ""
	var spec: Variant = read_json(a.get("cases", ""))
	if not (spec is Dictionary):
		printerr("PARITY_FAIL cannot read cases ", a.get("cases", ""))
		quit(2)
		return
	var out: Array = []
	for c: Dictionary in spec["cases"]:
		out.append(_run_boss(c) if a.get("module", "") == "boss3d" else _run_combat(c))
	var text: String = J.jstr({"module": a.get("module", ""), "cases": out})
	var f: FileAccess = FileAccess.open(a.get("out", ""), FileAccess.WRITE)
	if f == null:
		printerr("PARITY_FAIL cannot write ", a.get("out", ""))
		quit(2)
		return
	f.store_string(text)
	f.close()
	print("PARITY_OK ", out.size(), " cases")
	quit(0)


func _run_combat(c: Dictionary) -> Dictionary:
	var da: Variant = read_json(c["a"])
	var db: Variant = read_json(c["b"])
	var r: Dictionary = Combat.simulate_duel(da, db, {"script": c.get("script", {}), "frames": c.get("frames", 600), "distance": c.get("distance", 1.6), "seed": c.get("seed", 1), "statuses": c.get("statuses"), "friendlyFire": c.get("friendlyFire", false), "hostility": c.get("hostility"), "kbDecay": c.get("kbDecay", 0.85), "poses": c.get("poses"), "poseFrames": c.get("poseFrames")})
	var w: Dictionary = r["world"]
	return {"name": c["name"], "frames": r["frames"], "winner": r["winner"], "counts": r["counts"], "totals": r["totals"], "hash": r["hash"], "worldHash": Combat.hash_world(w), "eventCount": w["events"].size(), "events": w["events"].slice(0, 2000)}


func _run_boss(c: Dictionary) -> Dictionary:
	var def: Variant = read_json(c["file"])
	var sim: Dictionary = Boss.simulate(def, {"runs": c.get("runs", 3), "seed": c.get("seed", 1), "profile": c.get("profile"), "maxSeconds": c.get("maxSeconds", 300)})
	var head: Array = []
	var head_n: int = int(c.get("head", 300))
	if head_n > 0:
		var r0: Dictionary = Boss.run_fight(def, {"seed": c.get("seed", 1), "profile": c.get("profile"), "maxSeconds": c.get("maxSeconds", 300), "log": true})
		head = r0["log"].slice(0, head_n)
	return {"name": c["name"], "sim": sim, "head": head}

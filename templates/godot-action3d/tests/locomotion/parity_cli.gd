extends SceneTree
## godot --headless --path <project> --script res://tests/locomotion/parity_cli.gd -- --scenario=<abs.json> [--out=<abs.json>]
## Runs one parity scenario through the GDScript cores. Prints `PARITY <name> ok|FAIL maxErr=...`; writes the Godot trajectory
## ({steps, samples:[{step,...}], events}) to --out when given. Exit 1 when it differs from `expected` beyond tolerance.
const Lib := preload("res://tests/locomotion/parity_lib.gd")


func _initialize() -> void:
	var a: Dictionary = {}
	for s: String in OS.get_cmdline_user_args():
		var kv: PackedStringArray = s.trim_prefix("--").split("=", true, 1)
		a[kv[0]] = kv[1] if kv.size() > 1 else ""
	var path: String = a.get("scenario", "")
	var scn: Variant = Lib.read_json(path)
	if not (scn is Dictionary):
		printerr("PARITY_FAIL cannot read scenario ", path)
		quit(2)
		return
	var got: Dictionary = Lib.run_scenario(scn, path)
	var res: Dictionary = Lib.compare(scn, got)
	if a.has("out") and a["out"] != "":
		var arr: Array = []
		var keys: Array = got.samples.keys()
		keys.sort()
		for k: int in keys:
			var e: Dictionary = got.samples[k].duplicate()
			e["step"] = k
			arr.append(e)
		var f := FileAccess.open(a["out"], FileAccess.WRITE)
		f.store_string(JSON.stringify({"steps": got.steps, "samples": arr, "events": got.events, "maxErr": res.maxErr}))
	print("PARITY %s %s maxErr=%s" % [scn.get("name", "?"), "ok" if res.ok else "FAIL", JSON.stringify(res.maxErr)])
	for e: String in res.errors:
		print("  ", e)
	quit(0 if res.ok else 1)

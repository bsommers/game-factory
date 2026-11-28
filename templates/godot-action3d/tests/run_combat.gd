extends SceneTree
## Headless runner for the combat3d/boss3d mirror suite:
##   godot --headless --path <project> --script res://tests/run_combat.gd [-- <filter>]
## Runs every test_*() method of res://tests/combat/test_*.gd and res://tests/boss/test_*.gd; same PASS/FAIL/RESULT protocol as
## run_all.gd (use godot.test with runner=res://tests/run_combat.gd). Example JSON is found via FACTORY_SPEC_DIR or ../../spec/v4/examples.

func _initialize() -> void:
	await process_frame
	var filter: String = ""
	var ua: PackedStringArray = OS.get_cmdline_user_args()
	if ua.size() > 0:
		filter = ua[0]
	var passed: int = 0
	var failed: int = 0
	for dir: String in ["combat", "boss"]:
		var files: Array = Array(DirAccess.get_files_at("res://tests/" + dir)).filter(func(f: String) -> bool: return f.begins_with("test_") and f.get_extension() in ["gd", "remap"])
		files.sort()
		for f: String in files:
			var scr: GDScript = load("res://tests/%s/%s" % [dir, f.trim_suffix(".remap")]) as GDScript
			if scr == null:
				print("FAIL %s (load error)" % f)
				failed += 1
				continue
			for m: Dictionary in scr.get_script_method_list():
				var mn: String = m["name"]
				if not mn.begins_with("test_") or (filter != "" and filter not in f and filter not in mn):
					continue
				var inst: RefCounted = scr.new()
				inst.set("tree", self)
				await inst.call(mn)
				var fails: PackedStringArray = inst.get("failures")
				if fails.is_empty():
					print("PASS %s::%s" % [f, mn])
					passed += 1
				else:
					print("FAIL %s::%s" % [f, mn])
					for msg: String in fails:
						print("     - " + msg)
					failed += 1
	print("RESULT %d passed, %d failed" % [passed, failed])
	quit(1 if failed > 0 or passed == 0 else 0)

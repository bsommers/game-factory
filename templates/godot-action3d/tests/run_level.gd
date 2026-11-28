extends SceneTree
## Headless runner for the level loader tests:
##   godot --headless --path <project> --script res://tests/run_level.gd [-- <filter>]
## Runs every test_*() method of res://tests/level/test_*.gd; prints PASS/FAIL lines and `RESULT n passed, m failed`; exit 1 on any failure.
## (res://tests/run_all.gd only scans res://tests/, so these stay out of the default run.)

func _initialize() -> void:
	await process_frame
	var filter: String = ""
	var ua: PackedStringArray = OS.get_cmdline_user_args()
	if ua.size() > 0:
		filter = ua[0]
	var files: Array = Array(DirAccess.get_files_at("res://tests/level")).filter(func(f: String) -> bool: return f.begins_with("test_") and f.get_extension() in ["gd", "remap"])
	files.sort()
	var passed: int = 0
	var failed: int = 0
	for f: String in files:
		var scr: GDScript = load("res://tests/level/" + f.trim_suffix(".remap")) as GDScript
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

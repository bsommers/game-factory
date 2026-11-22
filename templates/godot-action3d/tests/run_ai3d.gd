extends SceneTree
## Headless runner for the ai3d suite: godot --headless --path <project> --script res://tests/run_ai3d.gd [-- <filter>] [--parity=<dir>]
## Runs every test_*() method of res://tests/ai3d/test_*.gd; prints PASS/FAIL lines and `RESULT n passed, m failed`; exit 1 on any failure.
## Parity files default to <repo>/spec/v4/parity/ai3d (resolved relative to this template); override with --parity=<dir>.

func _initialize() -> void:
	await process_frame
	var filter: String = ""
	for a: String in OS.get_cmdline_user_args():
		if not a.begins_with("--"):
			filter = a
	var files: Array = Array(DirAccess.get_files_at("res://tests/ai3d")).filter(func(f: String) -> bool: return f.begins_with("test_") and f.get_extension() in ["gd", "remap"])
	files.sort()
	var passed: int = 0
	var failed: int = 0
	for f: String in files:
		var scr: GDScript = load("res://tests/ai3d/" + f.trim_suffix(".remap")) as GDScript
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

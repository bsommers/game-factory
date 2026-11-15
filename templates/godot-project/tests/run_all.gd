extends SceneTree
## Headless test runner (ARCHITECTURE section 7).
## usage: tools/godot.sh --headless --path game --script res://tests/run_all.gd [-- <filter>]
## Runs every `test_*` method of every res://tests/test_*.gd (TestCase subclasses or any RefCounted
## exposing `failures`). Prints PASS/FAIL per test and exits non-zero on any failure.

const DIR: String = "res://tests"


func _initialize() -> void:
	await process_frame  # autoloads ready
	var filter: String = ""
	var ua: PackedStringArray = OS.get_cmdline_user_args()
	if ua.size() > 0:
		filter = ua[0]
	var files: PackedStringArray = []
	for f: String in DirAccess.get_files_at(DIR):
		var name: String = f.trim_suffix(".remap")
		if name.begins_with("test_") and name.ends_with(".gd") and name != "test_case.gd":
			files.append(name)
	files.sort()
	var passed: int = 0
	var failed: int = 0
	for f: String in files:
		var scr: GDScript = load(DIR + "/" + f) as GDScript
		if scr == null or not scr.can_instantiate():
			print("FAIL %s (script failed to load)" % f)
			failed += 1
			continue
		var methods: PackedStringArray = []
		for m: Dictionary in scr.get_script_method_list():
			var mn: String = m["name"]
			if mn.begins_with("test_") and not mn in methods and (filter == "" or filter in f or filter in mn):
				methods.append(mn)
		for mn: String in methods:
			var inst: Object = scr.new()
			if "tree" in inst:
				inst.set("tree", self)
			if inst.has_method("before_each"):
				await inst.call("before_each")
			await inst.call(mn)
			if inst.has_method("after_each"):
				await inst.call("after_each")
			var fails: PackedStringArray = inst.get("failures") if "failures" in inst else PackedStringArray()
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

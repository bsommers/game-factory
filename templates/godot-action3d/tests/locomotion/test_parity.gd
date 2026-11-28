extends "res://tests/test_base.gd"
## Runs every spec/v4/parity/{locomotion3d,camera3d}/*.json scenario through the GDScript cores and diffs against the
## JS-reference trajectory stored in `expected`. Skips (passes) when the spec dir is not reachable (template copied out of the repo).
const Lib := preload("res://tests/locomotion/parity_lib.gd")


func _run_dir(sub: String) -> void:
	var dir: String = Lib.parity_dir().path_join(sub)
	if not DirAccess.dir_exists_absolute(dir):
		print("SKIP parity %s (no %s; set FACTORY_PARITY_DIR)" % [sub, dir])
		return
	var files: Array = Array(DirAccess.get_files_at(dir)).filter(func(f: String) -> bool: return f.ends_with(".json"))
	files.sort()
	check(files.size() > 0, "no scenarios in " + dir)
	for f: String in files:
		var path: String = dir.path_join(f)
		var scn: Variant = Lib.read_json(path)
		if not (scn is Dictionary) or not scn.has("expected"):
			failures.append("%s: unreadable or no expected block" % f)
			continue
		var res: Dictionary = Lib.compare(scn, Lib.run_scenario(scn, path))
		for e: String in res.errors:
			failures.append("%s: %s" % [f, e])


func test_parity_locomotion3d() -> void:
	_run_dir("locomotion3d")


func test_parity_camera3d() -> void:
	_run_dir("camera3d")

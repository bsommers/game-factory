extends RefCounted
## Shared helpers for the combat/boss GDScript suites: locate and load the spec example JSON.
const J := preload("res://scripts/combat/js_compat.gd")


static func examples_dir() -> String:
	var env: String = OS.get_environment("FACTORY_SPEC_DIR")
	if env != "":
		return env.path_join("examples")
	var from: String = ProjectSettings.globalize_path("res://")
	for up in ["../../spec/v4", "../spec/v4", "../../../spec/v4"]:
		var p: String = from.path_join(up).simplify_path().path_join("examples")
		if DirAccess.dir_exists_absolute(p):
			return p
	return ""


static func load_example(rel: String) -> Variant:
	var d: String = examples_dir()
	if d == "":
		return null
	var p: String = d.path_join(rel)
	if not FileAccess.file_exists(p):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(p))

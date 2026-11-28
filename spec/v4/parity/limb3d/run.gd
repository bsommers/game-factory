extends SceneTree
## Parity runner: godot --headless --path <dir> --script res://run.gd
## <dir> must contain limb_core.gd and scenario.json. Prints one line `LIMB3D_RESULT <json>`.
func _initialize() -> void:
	var core: GDScript = load("res://limb_core.gd") as GDScript
	var txt: String = FileAccess.get_file_as_string("res://scenario.json")
	var sc: Dictionary = JSON.parse_string(txt)
	var res: Dictionary = core.simulate(sc["config"], sc["script"])
	print("LIMB3D_RESULT " + JSON.stringify(res))
	quit(0)

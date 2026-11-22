extends SceneTree
## godot.import-check harness. User args: --glb=res://path.glb ; prints one line `IMPORT_JSON {...}`.

func _walk(n: Node, out: Dictionary) -> void:
	if n is Skeleton3D:
		var sk: Skeleton3D = n
		var names: Array = []
		for i in sk.get_bone_count():
			names.append(sk.get_bone_name(i))
		out["skeletons"].append({"path": str(n.name), "bones": sk.get_bone_count(), "boneNames": names})
	elif n is MeshInstance3D:
		out["meshes"] += 1
	elif n is AnimationPlayer:
		var ap: AnimationPlayer = n
		for an: StringName in ap.get_animation_list():
			var an_res: Animation = ap.get_animation(an)
			out["animations"].append({"name": str(an), "length": snappedf(an_res.length, 0.0001), "tracks": an_res.get_track_count(), "loop": an_res.loop_mode != Animation.LOOP_NONE})
	for c: Node in n.get_children():
		_walk(c, out)


func _initialize() -> void:
	var path: String = ""
	for s: String in OS.get_cmdline_user_args():
		if s.begins_with("--glb="):
			path = s.substr(6)
	var ps: PackedScene = load(path) as PackedScene
	if ps == null:
		print("IMPORT_JSON " + JSON.stringify({"error": "cannot load " + path + " (not imported? run godot --import first)"}))
		quit(1)
		return
	var inst: Node = ps.instantiate()
	var out: Dictionary = {"skeletons": [], "animations": [], "meshes": 0}
	_walk(inst, out)
	print("IMPORT_JSON " + JSON.stringify(out))
	quit(0)

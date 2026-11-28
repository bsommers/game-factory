extends SceneTree
## godot.shot harness. User args: --scene=res://x.tscn --out=/abs.png [--frames=N]
## Needs a real renderer (not --headless): run under xvfb-run with software GL/Vulkan.

func _initialize() -> void:
	var a: Dictionary = {}
	for s: String in OS.get_cmdline_user_args():
		var kv: PackedStringArray = s.trim_prefix("--").split("=", true, 1)
		a[kv[0]] = kv[1] if kv.size() > 1 else ""
	var ps: PackedScene = load(a.get("scene", "")) as PackedScene
	if ps == null:
		printerr("SHOT_FAIL cannot load scene ", a.get("scene", ""))
		quit(1)
		return
	root.add_child(ps.instantiate())
	for i in int(a.get("frames", "10")):
		await process_frame
	await RenderingServer.frame_post_draw
	var img: Image = root.get_texture().get_image()
	if img == null or img.is_empty():
		printerr("SHOT_FAIL empty image (dummy renderer? do not use --headless)")
		quit(1)
		return
	var err: int = img.save_png(a.get("out", ""))
	print("SHOT_OK %dx%d %s" % [img.get_width(), img.get_height(), a.get("out", "")])
	quit(0 if err == OK else 1)

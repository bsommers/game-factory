extends "res://tests/test_base.gd"
## vfx3d: loader builds every example def, and the GD maths matches the JS reference (vfx3d.js) numerically.
const Loader: GDScript = preload("res://scripts/vfx/vfx_loader.gd")
const NAMES: Array = ["whirlpool", "flood-water", "toxic-sludge", "fire", "steam-vent", "hit-spark"]


func _def(n: String) -> Dictionary:
	return Loader.load_def("res://vfx/defs/%s.json" % n)


func _near(a: float, b: float, eps: float = 1e-3) -> bool:
	return absf(a - b) <= eps


func test_all_defs_build() -> void:
	for n: String in NAMES:
		var d: Dictionary = _def(n)
		check(not d.is_empty(), "%s: def failed to load" % n)
		if d.is_empty():
			continue
		var node: Node3D = Loader.build(d, {"time": 2.0})
		check(node != null, "%s: build returned null" % n)
		if node == null:
			continue
		check(node.get_child_count() >= 1, "%s: no children" % n)
		var particles: int = 0
		for c: Node in node.get_children():
			if c is GPUParticles3D:
				particles += 1
		check(particles == d.get("emitters", []).size(), "%s: expected %d GPUParticles3D, got %d" % [n, d.get("emitters", []).size(), particles])
		check(node.get_node_or_null("Water") != null if d.has("water") else true, "%s: missing Water node" % n)
		node.free()


func test_whirlpool_has_funnel_and_shader_params() -> void:
	var node: Node3D = Loader.build(_def("whirlpool"), {"time": 1.0})
	var fn: MeshInstance3D = node.get_node_or_null("Funnel")
	check(fn != null, "Funnel node missing")
	if fn != null:
		var m: ShaderMaterial = fn.material_override as ShaderMaterial
		check(m != null and m.shader != null, "funnel shader missing")
		check(_near(float(m.get_shader_parameter("radius")), 17.0), "funnel radius should equal field.radius (17)")
		check(_near(float(m.get_shader_parameter("depth")), 2.6), "funnel depth from visual.depth")
		check(fn.mesh.get_surface_count() == 1, "funnel mesh surface")
	node.free()


func test_field_force_matches_js() -> void:
	var w: Dictionary = _def("whirlpool")
	var f: Vector3 = Loader.field_force(w["field"], Vector3(5, 0, 2), 5.0)
	check(_near(f.x, -0.4514) and _near(f.y, 0.0) and _near(f.z, -0.5079), "vortex force %s != JS (-0.4514, 0, -0.5079)" % f)
	check(Loader.field_force(w["field"], Vector3(30, 0, 0), 5.0) == Vector3.ZERO, "outside radius = zero")
	var s: Dictionary = _def("steam-vent")
	var u: Vector3 = Loader.field_force(s["field"], Vector3(0.5, 2, 0.2), 1.0)
	check(_near(u.y, 6.0) and _near(u.x, 0.0), "steam updraft %s != (0,6,0)" % u)
	check(Loader.field_force(s["field"], Vector3(3, 2, 0), 1.0) == Vector3.ZERO, "outside vent area = zero")


func test_water_height_matches_js() -> void:
	var fl: Dictionary = _def("flood-water")
	check(_near(Loader.water_height(fl["water"], 3.5, -2.0, 6.0), 0.51799), "flood height %s != JS 0.51799" % Loader.water_height(fl["water"], 3.5, -2.0, 6.0))
	var w: Dictionary = _def("whirlpool")
	check(_near(Loader.water_height(w["water"], 1.0, 2.0, 3.0), -0.17706), "whirlpool water height != JS -0.17706")
	check(_near(Loader.water_level(fl["water"], 7.0), 0.6), "rise halfway (7s of 14) = 0.6")
	check(_near(Loader.funnel_depth(w["visual"], w["field"], 6.0), 1.08858), "funnel depth at r=6 != JS 1.08858")


func test_instance_drives_shader_time() -> void:
	var node: Node3D = Loader.build(_def("whirlpool"), {"time": 3.0})
	tree.root.add_child(node)
	await tree.process_frame
	var m: ShaderMaterial = (node.get("funnel_node") as MeshInstance3D).material_override as ShaderMaterial
	check(_near(float(m.get_shader_parameter("t")), 3.0), "shader t pinned to fixed_time")
	var fv: Vector3 = node.call("force_at", Vector3(5, 0, 2))
	check(fv.length() > 0.0, "force_at inside the vortex is non-zero")
	node.queue_free()
	await tree.process_frame

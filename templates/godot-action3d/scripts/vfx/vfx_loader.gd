extends RefCounted
## vfx3d loader: builds Godot nodes from a vfx3d JSON definition (spec/v4/vfx3d.md) and mirrors the JS gameplay maths
## (templates/web-project/src/lib/vfx3d.js: fieldForce, gerstner, waterHeight, funnelDepth) so physics and visuals share one data set.
## Use: var fx: Node3D = preload("res://scripts/vfx/vfx_loader.gd").build(def); add_child(fx). No class_name (works before editor import).

const WATER_SHADER: String = "res://vfx/shaders/water_gerstner.gdshader"
const WHIRL_SHADER: String = "res://vfx/shaders/whirlpool.gdshader"
const Instance: GDScript = preload("res://scripts/vfx/vfx_instance.gd")
const MAX_WAVES: int = 4


static func load_def(path: String) -> Dictionary:
	var f: FileAccess = FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var v: Variant = JSON.parse_string(f.get_as_text())
	return v if v is Dictionary else {}


static func color_of(c: Variant, a: float = 1.0) -> Color:
	if c is String:
		var col: Color = Color.html(c)
		col.a = a
		return col
	if c is Array and c.size() >= 3:
		return Color(float(c[0]), float(c[1]), float(c[2]), a)
	return Color(1, 1, 1, a)


static func v3(a: Variant, d: Vector3 = Vector3.ZERO) -> Vector3:
	if a is Array and a.size() >= 3:
		return Vector3(float(a[0]), float(a[1]), float(a[2]))
	return d


static func _r4(v: float) -> float:
	return roundf(v * 1e4) / 1e4


# ---------------------------------------------------------------- gameplay maths (parity with vfx3d.js)
static func field_amp(field: Dictionary, t: float) -> float:
	var amp: float = 1.0
	var ramp: float = float(field.get("ramp", 0.0))
	if ramp > 0.0:
		amp = clampf(maxf(t, 0.0) / maxf(1.0 / 60.0, ramp), 0.0, 1.0)
	if field.has("pulse"):
		var p: Dictionary = field["pulse"]
		var period: float = float(p["period"])
		var ph: float = fposmod(t, period)
		amp *= 1.0 if ph < float(p["active"]) else float(p.get("idle", 0.25))
	return amp


static func in_area(area: Dictionary, p: Vector3) -> bool:
	if area.is_empty():
		return true
	var c: Vector3 = v3(area.get("center"))
	if area.get("shape", "cylinder") == "box":
		var h: Vector3 = v3(area.get("size"), Vector3.ONE)
		return absf(p.x - c.x) <= h.x / 2.0 and absf(p.y - c.y) <= h.y / 2.0 and absf(p.z - c.z) <= h.z / 2.0
	if Vector2(p.x - c.x, p.z - c.z).length() > float(area.get("radius", 1.0)):
		return false
	return not area.has("height") or (p.y >= c.y and p.y <= c.y + float(area["height"]))


static func field_force(field: Dictionary, pos: Vector3, t: float = 0.0, resisting: bool = false) -> Vector3:
	var kind: String = str(field.get("kind", "none"))
	if kind == "flow":
		if not in_area(field.get("area", {}), pos):
			return Vector3.ZERO
		return v3(field.get("flow")) * field_amp(field, t)
	if kind != "vortex":
		return Vector3.ZERO
	var c: Vector3 = v3(field.get("center"))
	var dx: float = c.x - pos.x
	var dz: float = c.z - pos.z
	var d: float = sqrt(dx * dx + dz * dz)
	var radius: float = float(field["radius"])
	if d >= radius or d < 1e-6:
		return Vector3.ZERO
	var k: float = float(field["strength"]) * field_amp(field, t) * pow(1.0 - d / radius, float(field.get("falloff", 1.0)))
	if resisting:
		k *= float(field.get("resistFactor", 0.3))
	var ux: float = dx / d
	var uz: float = dz / d
	var sw: float = float(field.get("swirl", 0.0))
	return Vector3(k * (ux - sw * uz), 0.0, k * (uz + sw * ux))


static func _wave_params(w: Dictionary, n: int) -> Dictionary:
	var wl: float = maxf(1e-3, float(w["wavelength"]))
	var k: float = TAU / wl
	var c: float = float(w["speed"]) if w.has("speed") else sqrt(9.81 / k)
	var dir: Array = w["dir"]
	var dl: float = Vector2(float(dir[0]), float(dir[1])).length()
	if dl == 0.0:
		dl = 1.0
	return {"d": Vector2(float(dir[0]) / dl, float(dir[1]) / dl), "k": k, "om": k * c, "a": float(w.get("amplitude", 0.0)),
		"st": float(w.get("steepness", 0.0)), "qa": float(w.get("steepness", 0.0)) / (k * n), "ph": float(w.get("phase", 0.0))}


static func gerstner(water: Dictionary, x0: float, z0: float, t: float) -> Vector3:
	var ws: Array = water.get("waves", [])
	var n: int = maxi(1, ws.size())
	var out: Vector3 = Vector3.ZERO
	for w: Dictionary in ws:
		var p: Dictionary = _wave_params(w, n)
		var d: Vector2 = p["d"]
		var th: float = float(p["k"]) * (d.x * x0 + d.y * z0) - float(p["om"]) * t + float(p["ph"])
		out.x += float(p["qa"]) * d.x * cos(th)
		out.z += float(p["qa"]) * d.y * cos(th)
		out.y += float(p["a"]) * sin(th)
	return out


static func water_level(water: Dictionary, t: float = 0.0) -> float:
	if water.has("rise"):
		var r: Dictionary = water["rise"]
		return float(r["fromY"]) + (float(r["toY"]) - float(r["fromY"])) * clampf(maxf(t, 0.0) / maxf(1.0 / 60.0, float(r["seconds"])), 0.0, 1.0)
	return float(water.get("level", 0.0))


static func water_height(water: Dictionary, x: float, z: float, t: float = 0.0) -> float:
	var x0: float = x
	var z0: float = z
	for i in 4:
		var g: Vector3 = gerstner(water, x0, z0, t)
		x0 = x - g.x
		z0 = z - g.z
	return water_level(water, t) + gerstner(water, x0, z0, t).y


static func funnel_depth(vis: Dictionary, field: Dictionary, r: float) -> float:
	if field.get("kind", "") != "vortex" or r >= float(field["radius"]):
		return 0.0
	return float(vis.get("depth", 0.0)) * pow(1.0 - r / float(field["radius"]), float(vis.get("funnelPower", 2.0)))


# ---------------------------------------------------------------- builders
static func build(def: Dictionary, opts: Dictionary = {}) -> Node3D:
	var root: Node3D = Node3D.new()
	root.set_script(Instance)
	root.name = str(def.get("id", "vfx"))
	root.set("def", def)
	root.set("fixed_time", float(opts.get("time", -1.0)))
	var level: float = 0.0
	if def.has("water"):
		var wn: MeshInstance3D = _build_water(def)
		root.add_child(wn)
		root.set("water_node", wn)
		level = water_level(def["water"], 0.0)
	if def.get("kind", "") == "whirlpool" and def.has("field") and def.has("visual"):
		var fn: MeshInstance3D = _build_funnel(def)
		fn.position.y = level + 0.02
		root.add_child(fn)
		root.set("funnel_node", fn)
	for e: Dictionary in def.get("emitters", []):
		var p: GPUParticles3D = build_emitter(e, bool(opts.get("preprocess", true)))
		var fc: Vector3 = v3(def.get("field", {}).get("center")) if def.get("kind", "") == "whirlpool" else Vector3.ZERO
		p.position = Vector3(fc.x, level, fc.z)
		root.add_child(p)
	return root


static func _build_water(def: Dictionary) -> MeshInstance3D:
	var water: Dictionary = def["water"]
	var vis: Dictionary = def.get("visual", {})
	var size: Array = water.get("size", [40, 40])
	var mesh: PlaneMesh = PlaneMesh.new()
	mesh.size = Vector2(float(size[0]), float(size[1]))
	mesh.subdivide_width = clampi(int(float(size[0]) * 3.0), 32, 200)
	mesh.subdivide_depth = clampi(int(float(size[1]) * 3.0), 32, 200)
	var mat: ShaderMaterial = ShaderMaterial.new()
	mat.shader = load(WATER_SHADER) as Shader
	var ws: Array = water.get("waves", [])
	var n: int = maxi(1, ws.size())
	var wa: PackedVector4Array = PackedVector4Array()
	var wb: PackedVector4Array = PackedVector4Array()
	for i in MAX_WAVES:
		if i < ws.size():
			var p: Dictionary = _wave_params(ws[i], n)
			var d: Vector2 = p["d"]
			wa.append(Vector4(d.x, d.y, float(p["k"]), float(p["om"])))
			wb.append(Vector4(float(p["a"]), float(p["qa"]), float(p["ph"]), float(p["st"]) / n))
		else:
			wa.append(Vector4(1, 0, 1, 0))
			wb.append(Vector4(0, 0, 0, 0))
	mat.set_shader_parameter("wave_a", wa)
	mat.set_shader_parameter("wave_b", wb)
	mat.set_shader_parameter("level", water_level(water, 0.0))
	mat.set_shader_parameter("color", color_of(vis.get("color", "#2a6f7c")))
	mat.set_shader_parameter("deep_color", color_of(vis.get("deepColor", "#04161d")))
	mat.set_shader_parameter("foam_color", color_of(vis.get("foamColor", "#e8f4f6")))
	mat.set_shader_parameter("foam", float(vis.get("foam", 0.4)))
	mat.set_shader_parameter("opacity", float(vis.get("opacity", 1.0)))
	var fl: Dictionary = def.get("field", {})
	if fl.get("kind", "") == "flow":
		var fv: Vector3 = v3(fl.get("flow"))
		mat.set_shader_parameter("flow_speed", Vector2(fv.x, fv.z).length())
		mat.set_shader_parameter("flow_dir", Vector2(fv.x, fv.z).normalized() if Vector2(fv.x, fv.z).length() > 0.0 else Vector2(1, 0))
	if def.get("kind", "") == "whirlpool" and fl.get("kind", "") == "vortex":
		var c: Vector3 = v3(fl.get("center"))
		mat.set_shader_parameter("hole_center", Vector2(c.x, c.z))
		mat.set_shader_parameter("hole_radius", float(fl["radius"]) * 0.9)
	var mi: MeshInstance3D = MeshInstance3D.new()
	mi.name = "Water"
	mi.mesh = mesh
	mi.material_override = mat
	mi.extra_cull_margin = 4.0
	return mi


static func funnel_mesh(radius: float, rings: int = 56, segs: int = 96) -> ArrayMesh:
	var st: SurfaceTool = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in rings:
		var r0: float = radius * float(i) / rings
		var r1: float = radius * float(i + 1) / rings
		for j in segs:
			var a0: float = TAU * float(j) / segs
			var a1: float = TAU * float(j + 1) / segs
			var p00: Vector3 = Vector3(cos(a0) * r0, 0, sin(a0) * r0)
			var p01: Vector3 = Vector3(cos(a1) * r0, 0, sin(a1) * r0)
			var p10: Vector3 = Vector3(cos(a0) * r1, 0, sin(a0) * r1)
			var p11: Vector3 = Vector3(cos(a1) * r1, 0, sin(a1) * r1)
			for p: Vector3 in [p00, p10, p11, p00, p11, p01]:
				st.set_normal(Vector3.UP)
				st.add_vertex(p)
	return st.commit()


static func _build_funnel(def: Dictionary) -> MeshInstance3D:
	var f: Dictionary = def["field"]
	var vis: Dictionary = def["visual"]
	var mi: MeshInstance3D = MeshInstance3D.new()
	mi.name = "Funnel"
	mi.mesh = funnel_mesh(float(f["radius"]))
	mi.extra_cull_margin = 6.0
	var mat: ShaderMaterial = ShaderMaterial.new()
	mat.shader = load(WHIRL_SHADER) as Shader
	mat.set_shader_parameter("radius", float(f["radius"]))
	mat.set_shader_parameter("depth", float(vis.get("depth", 2.0)))
	mat.set_shader_parameter("power", float(vis.get("funnelPower", 2.0)))
	mat.set_shader_parameter("swirl_rate", float(vis.get("swirlRate", 1.5)))
	mat.set_shader_parameter("twist", float(vis.get("twist", 3.0)))
	mat.set_shader_parameter("arms", float(vis.get("arms", 5.0)))
	mat.set_shader_parameter("foam", float(vis.get("foam", 0.6)))
	mat.set_shader_parameter("core_radius", float(f.get("coreRadius", 1.5)))
	mat.set_shader_parameter("color", color_of(vis.get("color", "#2a6f7c")))
	mat.set_shader_parameter("deep_color", color_of(vis.get("deepColor", "#04161d")))
	mat.set_shader_parameter("foam_color", color_of(vis.get("foamColor", "#e8f4f6")))
	mi.material_override = mat
	mi.position = v3(f.get("center"))
	return mi


static func _range(v: Variant, d: float) -> Vector2:
	if v is Array and v.size() >= 2:
		return Vector2(float(v[0]), float(v[1]))
	if v is Array and v.size() == 1:
		return Vector2(float(v[0]), float(v[0]))
	if v is float or v is int:
		return Vector2(float(v), float(v))
	return Vector2(d, d)


static func _soft_texture() -> GradientTexture2D:
	var g: Gradient = Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	var tex: GradientTexture2D = GradientTexture2D.new()
	tex.gradient = g
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.5)
	tex.width = 64
	tex.height = 64
	return tex


static func build_emitter(e: Dictionary, preprocess: bool = true) -> GPUParticles3D:
	var life: Vector2 = _range(e.get("lifetime"), 1.0)
	var speed: Vector2 = _range(e.get("speed"), 1.0)
	var burst: Dictionary = e.get("burst", {})
	var rate: float = float(e.get("rate", 0.0))
	var p: GPUParticles3D = GPUParticles3D.new()
	p.name = str(e.get("id", "emitter"))
	p.lifetime = maxf(life.y, 0.05)
	p.randomness = clampf(1.0 - life.x / maxf(life.y, 0.001), 0.0, 1.0)
	var count: int = int(ceil(rate * life.y)) + int(burst.get("count", 0))
	if burst.has("repeat") and rate <= 0.0:
		p.lifetime = maxf(life.y, float(burst["repeat"]))
	p.amount = clampi(mini(count, int(e.get("maxParticles", 5000))), 1, 5000)
	if rate <= 0.0 and not burst.is_empty():
		p.explosiveness = 1.0
	p.preprocess = p.lifetime * 1.0 if preprocess else 0.0
	p.fixed_fps = 0
	p.local_coords = false
	p.visibility_aabb = AABB(Vector3(-12, -4, -12), Vector3(24, 24, 24))
	var m: ParticleProcessMaterial = ParticleProcessMaterial.new()
	var sh: Dictionary = e.get("shape", {"type": "point"})
	match str(sh.get("type", "point")):
		"sphere":
			m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
			m.emission_sphere_radius = maxf(float(sh.get("radius", 0.5)), 0.001)
		"box":
			m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
			m.emission_box_extents = v3(sh.get("size"), Vector3.ONE) * 0.5
		"disc", "cone":
			m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_RING
			m.emission_ring_axis = Vector3.UP
			m.emission_ring_height = 0.0
			m.emission_ring_radius = maxf(float(sh.get("radius", 0.4)), 0.001)
			m.emission_ring_inner_radius = 0.0
		_:
			m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_POINT
	m.direction = v3(e.get("direction"), Vector3.UP).normalized()
	m.spread = float(e.get("spread", 0.0))
	m.initial_velocity_min = speed.x
	m.initial_velocity_max = speed.y
	m.gravity = v3(e.get("gravity"))
	var drag: float = float(e.get("drag", 0.0))
	m.damping_min = drag * speed.x
	m.damping_max = drag * speed.y
	var sz: Dictionary = e.get("size", {"start": 0.2, "end": 0.2})
	var s0: float = float(sz.get("start", 0.2))
	var s1: float = float(sz.get("end", 0.2))
	var smax: float = maxf(maxf(s0, s1), 0.0001)
	m.scale_min = smax
	m.scale_max = smax
	var curve: Curve = Curve.new()
	curve.add_point(Vector2(0.0, s0 / smax))
	curve.add_point(Vector2(1.0, s1 / smax))
	var ct: CurveTexture = CurveTexture.new()
	ct.curve = curve
	m.scale_curve = ct
	var grad: Gradient = Gradient.new()
	var stops: Array = e.get("color", [])
	if stops.is_empty():
		stops = [{"t": 0.0, "c": "#ffffff", "a": 1.0}, {"t": 1.0, "c": "#ffffff", "a": 0.0}]
	var offs: PackedFloat32Array = PackedFloat32Array()
	var cols: PackedColorArray = PackedColorArray()
	for s: Dictionary in stops:
		offs.append(float(s["t"]))
		cols.append(color_of(s["c"], float(s.get("a", 1.0))))
	grad.offsets = offs
	grad.colors = cols
	var gt: GradientTexture1D = GradientTexture1D.new()
	gt.gradient = grad
	m.color_ramp = gt
	p.process_material = m
	var q: QuadMesh = QuadMesh.new()
	q.size = Vector2(1, 1)
	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if str(e.get("blend", "mix")) == "add" else BaseMaterial3D.BLEND_MODE_MIX
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = _soft_texture()
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.billboard_keep_scale = true
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	q.material = mat
	p.draw_pass_1 = q
	return p

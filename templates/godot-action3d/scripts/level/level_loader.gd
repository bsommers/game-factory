extends Node3D
## Instantiates a level3d JSON (spec/v4/level3d.md) into scene nodes:
##   pieces      -> StaticBody3D (layer 1) with collision (+ simple visual mesh)
##   triggers    -> Area3D in group "trigger" (meta: event, once, activates), emits trigger_entered
##   hazards     -> Area3D in group "hazard" (meta: kind, dps, ref, active)
##   checkpoints -> Area3D in group "checkpoint";  spawns -> Marker3D in groups "spawn" and "spawn_<kind>"
## Geometry matches the JS bake exactly (same box/ramp/heightmap triangles, yaw about +Y, Godot convention).

signal trigger_entered(id: String, event: String, body: Node3D)
signal checkpoint_reached(id: String, body: Node3D)

@export var build_visuals: bool = true

var data: Dictionary = {}
var pieces: Dictionary = {}
var triggers: Dictionary = {}
var hazards: Dictionary = {}
var checkpoints: Dictionary = {}
var spawns: Dictionary = {}
var arena: Dictionary = {}
var _fired: Dictionary = {}


static func v3(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))


func load_file(path: String) -> Error:
	var f: FileAccess = FileAccess.open(path, FileAccess.READ)
	if f == null:
		return FileAccess.get_open_error()
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		return ERR_PARSE_ERROR
	return load_dict(parsed as Dictionary)


func load_dict(d: Dictionary) -> Error:
	if int(d.get("version", 0)) != 1 or not d.has("pieces"):
		return ERR_INVALID_DATA
	clear_level()
	data = d
	name = String(d.get("id", "Level"))
	for p: Dictionary in d["pieces"]:
		_add_piece(p)
	for s: Dictionary in d.get("spawns", []):
		_add_spawn(s)
	for t: Dictionary in d.get("triggers", []):
		_add_volume(t, "trigger", triggers)
	for h: Dictionary in d.get("hazards", []):
		_add_volume(h, "hazard", hazards)
	for c: Dictionary in d.get("checkpoints", []):
		_add_checkpoint(c)
	arena = d.get("arena", {})
	return OK


func clear_level() -> void:
	for c: Node in get_children():
		remove_child(c)
		c.queue_free()
	pieces.clear()
	triggers.clear()
	hazards.clear()
	checkpoints.clear()
	spawns.clear()
	arena = {}
	_fired.clear()


func spawn_position(id: String) -> Vector3:
	return (spawns[id] as Marker3D).position if spawns.has(id) else Vector3.ZERO


func spawns_of(kind: String) -> Array:
	return spawns.values().filter(func(m: Marker3D) -> bool: return m.get_meta("kind") == kind)


func set_hazard_active(id: String, active: bool) -> void:
	if hazards.has(id):
		var a: Area3D = hazards[id]
		a.set_meta("active", active)
		a.set_deferred("monitoring", active)


func in_arena(p: Vector3) -> bool:
	if arena.is_empty():
		return false
	if arena["shape"] == "circle":
		var c: Array = arena["center"]
		return Vector2(p.x - float(c[0]), p.z - float(c[1])).length() <= float(arena["radius"])
	var lo: Array = arena["min"]
	var hi: Array = arena["max"]
	return p.x >= float(lo[0]) and p.x <= float(hi[0]) and p.z >= float(lo[1]) and p.z <= float(hi[1])


# ---------- pieces ----------
static func ramp_triangles(size: Vector3) -> PackedVector3Array:
	var w: float = size.x / 2.0
	var h: float = size.y / 2.0
	var l: float = size.z / 2.0
	var a := Vector3(-w, -h, -l)
	var b := Vector3(w, -h, -l)
	var c := Vector3(-w, -h, l)
	var d := Vector3(w, -h, l)
	var e := Vector3(-w, h, l)
	var f := Vector3(w, h, l)
	# JS bake uses CCW-outward; Godot (and Jolt mesh shapes) treat clockwise as front, so each triangle is emitted with vertices 2 and 3 swapped.
	return PackedVector3Array([b, e, a, b, f, e, c, f, d, c, e, f, a, d, b, a, c, d, a, e, c, b, d, f])


static func heightmap_triangles(heights: Array, cell: float) -> PackedVector3Array:
	var out := PackedVector3Array()
	for j: int in range(heights.size() - 1):
		var row: Array = heights[j]
		for i: int in range(row.size() - 1):
			var a := Vector3(i * cell, float(heights[j][i]), j * cell)
			var b := Vector3((i + 1) * cell, float(heights[j][i + 1]), j * cell)
			var c := Vector3((i + 1) * cell, float(heights[j + 1][i + 1]), (j + 1) * cell)
			var d := Vector3(i * cell, float(heights[j + 1][i]), (j + 1) * cell)
			out.append_array(PackedVector3Array([a, c, d, a, b, c]))
	return out


func _mesh_from_tris(tris: PackedVector3Array) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for v: Vector3 in tris:
		st.add_vertex(v)
	st.generate_normals()
	return st.commit()


func _add_piece(p: Dictionary) -> void:
	var body := StaticBody3D.new()
	body.name = String(p["id"])
	body.position = v3(p["pos"])
	body.rotation.y = deg_to_rad(float(p.get("yaw", 0.0)))
	body.set_meta("type", p["type"])
	body.add_to_group("level_piece")
	var shape: Shape3D = null
	var mesh: Mesh = null
	var offset := Vector3.ZERO
	match String(p["type"]):
		"box":
			var sz: Vector3 = v3(p["size"])
			shape = BoxShape3D.new()
			(shape as BoxShape3D).size = sz
			mesh = BoxMesh.new()
			(mesh as BoxMesh).size = sz
		"ramp":
			var tris: PackedVector3Array = ramp_triangles(v3(p["size"]))
			shape = ConcavePolygonShape3D.new()
			(shape as ConcavePolygonShape3D).set_faces(tris)
			mesh = _mesh_from_tris(tris)
		"heightmap":
			var tris2: PackedVector3Array = heightmap_triangles(p["heights"], float(p["cellSize"]))
			shape = ConcavePolygonShape3D.new()
			(shape as ConcavePolygonShape3D).set_faces(tris2)
			mesh = _mesh_from_tris(tris2)
		"glb":
			var px: Dictionary = p["proxy"]
			shape = BoxShape3D.new()
			(shape as BoxShape3D).size = v3(px["size"])
			offset = v3(px.get("offset", [0, 0, 0]))
			var asset: String = "res://" + String(p["asset"])
			if build_visuals and ResourceLoader.exists(asset):
				var scn: Resource = load(asset)
				if scn is PackedScene:
					body.add_child((scn as PackedScene).instantiate())
	if p.get("collide", true) and shape != null:
		var cs := CollisionShape3D.new()
		cs.shape = shape
		cs.position = offset
		body.add_child(cs)
	if build_visuals and mesh != null:
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		body.add_child(mi)
	add_child(body)
	pieces[String(p["id"])] = body


# ---------- volumes ----------
func _shape_for(v: Dictionary) -> Shape3D:
	match String(v["shape"]):
		"sphere":
			var s := SphereShape3D.new()
			s.radius = float(v["radius"])
			return s
		"cylinder":
			var c := CylinderShape3D.new()
			c.radius = float(v["radius"])
			c.height = float(v.get("height", 1.0))
			return c
	var b := BoxShape3D.new()
	b.size = v3(v["size"])
	return b


func _add_volume(v: Dictionary, group: String, registry: Dictionary) -> void:
	var area := Area3D.new()
	area.name = String(v["id"])
	area.position = v3(v["pos"])
	area.add_to_group(group)
	var cs := CollisionShape3D.new()
	cs.shape = _shape_for(v)
	area.add_child(cs)
	for k: String in v.keys():
		if k not in ["id", "shape", "pos", "size", "radius", "height"]:
			area.set_meta(k, v[k])
	if group == "trigger":
		area.body_entered.connect(_on_trigger.bind(area))
	else:
		area.set_meta("active", bool(v.get("startActive", true)))
		area.monitoring = bool(v.get("startActive", true))
	add_child(area)
	registry[String(v["id"])] = area


func _on_trigger(body: Node3D, area: Area3D) -> void:
	if body is StaticBody3D:
		return
	var id: String = String(area.name)
	if bool(area.get_meta("once", false)) and _fired.has(id):
		return
	_fired[id] = true
	for target: String in area.get_meta("activates", []):
		set_hazard_active(target, true)
	trigger_entered.emit(id, String(area.get_meta("event", "")), body)


func _add_checkpoint(c: Dictionary) -> void:
	var area := Area3D.new()
	area.name = String(c["id"])
	area.position = v3(c["pos"])
	area.add_to_group("checkpoint")
	var cs := CollisionShape3D.new()
	var sp := SphereShape3D.new()
	sp.radius = float(c["radius"])
	cs.shape = sp
	area.add_child(cs)
	area.set_meta("respawn", c.get("respawn", ""))
	area.body_entered.connect(func(body: Node3D) -> void:
		if not body is StaticBody3D:
			checkpoint_reached.emit(String(area.name), body))
	add_child(area)
	checkpoints[String(c["id"])] = area


func _add_spawn(s: Dictionary) -> void:
	var m := Marker3D.new()
	m.name = String(s["id"])
	m.position = v3(s["pos"])
	m.rotation.y = deg_to_rad(float(s.get("yaw", 0.0)))
	m.add_to_group("spawn")
	m.add_to_group("spawn_" + String(s["kind"]))
	for k: String in s.keys():
		if k not in ["id", "pos", "yaw"]:
			m.set_meta(k, s[k])
	add_child(m)
	spawns[String(s["id"])] = m

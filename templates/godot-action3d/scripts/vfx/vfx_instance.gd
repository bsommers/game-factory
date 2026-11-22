extends Node3D
## Runtime driver for a vfx3d effect built by vfx_loader.gd: advances `time` (or pins it to fixed_time >= 0 for screenshots/tests)
## and pushes time + field amplitude into the water and funnel shaders. Gameplay reads the same def via vfx_loader.field_force().
var def: Dictionary = {}
var time: float = 0.0
var fixed_time: float = -1.0
var water_node: MeshInstance3D
var funnel_node: MeshInstance3D


func _ready() -> void:
	_apply()


func _process(delta: float) -> void:
	time = fixed_time if fixed_time >= 0.0 else time + delta
	_apply()


func _apply() -> void:
	var t: float = fixed_time if fixed_time >= 0.0 else time
	var loader: GDScript = load("res://scripts/vfx/vfx_loader.gd")
	if water_node != null:
		var m: ShaderMaterial = water_node.material_override as ShaderMaterial
		m.set_shader_parameter("t", t)
		m.set_shader_parameter("level", loader.water_level(def["water"], t))
	if funnel_node != null:
		var f: ShaderMaterial = funnel_node.material_override as ShaderMaterial
		f.set_shader_parameter("t", t)
		f.set_shader_parameter("amp", loader.field_amp(def["field"], t))


## Force at a world position (same data/formula as boss3d + locomotion3d env.force).
func force_at(pos: Vector3, resisting: bool = false) -> Vector3:
	var loader: GDScript = load("res://scripts/vfx/vfx_loader.gd")
	return loader.field_force(def.get("field", {}), pos - global_position, time, resisting)

extends Node3D
## Camera rig stub: follows `target` with smoothing; mouse look orbits yaw/pitch. Child Camera3D sits on a SpringArm3D.

@export var target_path: NodePath
@export var follow_speed: float = 10.0
@export var mouse_sensitivity: float = 0.003

var pitch: float = -0.3


func _ready() -> void:
	set_as_top_level(true)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		rotation.y -= event.relative.x * mouse_sensitivity
		pitch = clampf(pitch - event.relative.y * mouse_sensitivity, -1.2, 0.4)
		$Arm.rotation.x = pitch


func _process(delta: float) -> void:
	var t: Node3D = get_node_or_null(target_path) as Node3D
	if t != null:
		global_position = global_position.lerp(t.global_position + Vector3(0, 1.4, 0), clampf(follow_speed * delta, 0.0, 1.0))

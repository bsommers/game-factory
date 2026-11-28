extends CharacterBody3D
## Third-person player stub: camera-relative movement, gravity, jump. Swap the Visual child for a Meshy GLB.

@export var speed: float = 6.0
@export var jump_velocity: float = 6.0
@export var turn_rate: float = 12.0
@export var camera_rig_path: NodePath

var gravity: float = 20.0
## Test hook: when set, used instead of Input (x = right, y = forward).
var input_override: Variant = null


func move_input() -> Vector2:
	if input_override != null:
		return input_override
	return Input.get_vector("move_left", "move_right", "move_back", "move_forward")


func _physics_process(delta: float) -> void:
	var in2: Vector2 = move_input()
	var yaw: float = 0.0
	var rig: Node3D = get_node_or_null(camera_rig_path) as Node3D
	if rig != null:
		yaw = rig.global_rotation.y
	var dir: Vector3 = Vector3(in2.x, 0.0, -in2.y).rotated(Vector3.UP, yaw)
	velocity.x = dir.x * speed
	velocity.z = dir.z * speed
	if not is_on_floor():
		velocity.y -= gravity * delta
	elif input_override == null and Input.is_action_just_pressed("jump"):
		velocity.y = jump_velocity
	if dir.length() > 0.01:
		rotation.y = lerp_angle(rotation.y, atan2(-dir.x, -dir.z), clampf(turn_rate * delta, 0.0, 1.0))
	move_and_slide()

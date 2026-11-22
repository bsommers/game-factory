extends Node3D
## Third-person camera rig driven by camera_core.gd (same algorithm and JSON config as templates/web-project/src/lib/camera3d.js).
## Mouse / right stick orbit, optional lock-on target and aim, boom collision via a physics sphere cast.
## Exposes `yaw` (heading the camera looks along; the player reads it for camera-relative movement) and rotates this node to it.

const CamCore := preload("res://scripts/camera/camera_core.gd")
const InputSetup := preload("res://scripts/locomotion/input_setup.gd")

@export var target_path: NodePath
@export var config_path: String = ""
@export var mouse_sensitivity: float = 0.003
@export var stick_rate: float = 2.5
@export var capture_mouse: bool = true
@export var lock_target_path: NodePath

var core: RefCounted
var yaw: float = 0.0
var pitch: float = 0.0
var _yaw_delta: float = 0.0
var _pitch_delta: float = 0.0
var _shape: SphereShape3D = SphereShape3D.new()
var _exclude: Array[RID] = []
@onready var _cam: Camera3D = $Camera


func _ready() -> void:
	InputSetup.ensure()
	set_as_top_level(true)
	var cfg: Dictionary = {}
	if config_path != "":
		cfg = CamCore.load_config_file(config_path)
	var t: Node3D = get_node_or_null(target_path) as Node3D
	var p: Vector3 = t.global_position if t != null else global_position
	core = CamCore.new(cfg, [p.x, p.y, p.z], global_rotation.y)
	core.sweep = _sweep
	if t is CollisionObject3D:
		_exclude = [(t as CollisionObject3D).get_rid()]
	yaw = core.yaw
	pitch = core.pitch


func add_trauma(amount: float) -> void:
	core.add_trauma(amount)


func kick_fov(deg: float) -> void:
	core.kick_fov(deg)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and capture_mouse and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_yaw_delta -= event.relative.x * mouse_sensitivity  # mouse right turns the view right (toward +X at yaw 0)
		_pitch_delta += event.relative.y * mouse_sensitivity  # mouse down lifts the camera, looking down on the player


# Sphere sweep for the boom; returns hit fraction or -1.
func _sweep(origin: Array, radius: float, delta: Array) -> float:
	var w: World3D = get_world_3d()
	if w == null:
		return -1.0
	_shape.radius = radius
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = _shape
	q.transform = Transform3D(Basis.IDENTITY, Vector3(origin[0], origin[1], origin[2]))
	q.motion = Vector3(delta[0], delta[1], delta[2])
	q.exclude = _exclude
	var r: PackedFloat32Array = w.direct_space_state.cast_motion(q)
	if r.size() >= 2 and r[0] < 1.0:
		return r[0]
	return -1.0


func _process(delta: float) -> void:
	if core == null:
		return
	var t: Node3D = get_node_or_null(target_path) as Node3D
	if t == null:
		return
	var look: Vector2 = Input.get_vector("look_left", "look_right", "look_up", "look_down")
	var yd: float = _yaw_delta - look.x * stick_rate * delta
	var pd: float = _pitch_delta + look.y * stick_rate * delta
	_yaw_delta = 0.0
	_pitch_delta = 0.0
	var lock: Variant = null
	var lt: Node3D = get_node_or_null(lock_target_path) as Node3D
	if lt != null:
		lock = [lt.global_position.x, lt.global_position.y, lt.global_position.z]
	var p: Vector3 = t.global_position
	core.step({"target": [p.x, p.y, p.z], "yawDelta": yd, "pitchDelta": pd, "lock": lock, "aim": Input.is_action_pressed("aim")}, delta)
	yaw = core.yaw
	pitch = core.pitch
	rotation.y = yaw
	var o: Dictionary = core.out
	var up: Vector3 = Vector3(o.up[0], o.up[1], o.up[2])
	_cam.look_at_from_position(Vector3(o.pos[0], o.pos[1], o.pos[2]), Vector3(o.target[0], o.target[1], o.target[2]), up)
	_cam.fov = o.fov

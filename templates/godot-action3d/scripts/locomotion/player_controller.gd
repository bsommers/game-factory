extends CharacterBody3D
## Third-person player: Godot physics (CharacterBody3D) drives collision, locomotion_core.gd decides movement
## (same algorithm and JSON config as templates/web-project/src/lib/locomotion3d.js). yaw 0 faces -Z.
## Pass a locomotion3d JSON config via `config_path` (res:// or absolute); empty = defaults.

const LocoCore := preload("res://scripts/locomotion/locomotion_core.gd")
const InputSetup := preload("res://scripts/locomotion/input_setup.gd")

signal state_changed(new_state: String, old_state: String)
signal loco_event(event_name: String)

@export var config_path: String = ""
@export var camera_rig_path: NodePath
## Visual node rotated to the facing yaw (the body itself is never rotated; velocity is world space).
@export var model_path: NodePath = ^"Model"

var core: RefCounted
## Last animation-graph input (locomotionState, speed, grounded, ...), refreshed every physics step.
var output: Dictionary = {}
## Test hook: when set (Vector2, x right, y forward) used instead of Input; jump/dodge/sprint are then off.
var input_override: Variant = null
var jump_override: bool = false
var dodge_override: bool = false
var sprint_override: bool = false
var cam_yaw_override: Variant = null


func _ready() -> void:
	InputSetup.ensure()
	var cfg: Dictionary = {}
	if config_path != "":
		cfg = LocoCore.load_config_file(config_path)
	core = LocoCore.new(cfg, [global_position.x, global_position.y, global_position.z], global_rotation.y)
	core.mover = _mover
	floor_snap_length = LocoCore.SNAP_DISTANCE
	floor_max_angle = deg_to_rad(float(core.cfg.body.slopeLimitDeg))
	floor_stop_on_slope = true
	motion_mode = CharacterBody3D.MOTION_MODE_GROUNDED


func get_config() -> Dictionary:
	return core.cfg


func move_input() -> Vector2:
	if input_override != null:
		return input_override
	return Input.get_vector("move_left", "move_right", "move_back", "move_forward")


func camera_yaw() -> float:
	if cam_yaw_override != null:
		return float(cam_yaw_override)
	var rig: Node = get_node_or_null(camera_rig_path)
	if rig != null:
		if "yaw" in rig:
			return float(rig.get("yaw"))
		if rig is Node3D:
			return (rig as Node3D).global_rotation.y
	return 0.0


## Knockback / launch (world-space impulse, metres per second).
func apply_impulse(impulse: Vector3, stun_time: float = -1.0) -> void:
	core.apply_impulse([impulse.x, impulse.y, impulse.z], stun_time)


# Called by the core in place of collision3d.moveAndSlide: real engine collision.
func _mover(c: RefCounted, tx: float, ty: float, tz: float, dt: float) -> void:
	var start: Vector3 = global_position
	velocity = Vector3(tx, ty, tz)
	move_and_slide()
	var moved: Vector3 = global_position - start
	var g: bool = is_on_floor()
	c.px = global_position.x
	c.py = global_position.y
	c.pz = global_position.z
	c.grounded = g
	c.ground_n = [0.0, 1.0, 0.0]
	if g:
		var n: Vector3 = get_floor_normal()
		c.ground_n = [n.x, n.y, n.z]
	var inv: float = 1.0 / dt if dt > 0.0 else 0.0
	var vyo: float = ty
	if g or (is_on_ceiling() and ty > 0.0):
		vyo = 0.0
	c.vel = [moved.x * inv, vyo, moved.z * inv]


func _physics_process(delta: float) -> void:
	if core == null:
		return
	# the engine body is the source of truth for position and floor contact between steps
	core.px = global_position.x
	core.py = global_position.y
	core.pz = global_position.z
	var mv: Vector2 = move_input()
	var jump_held: bool
	var pressed: bool
	var sprint: bool
	var dodge: bool
	if input_override != null:
		jump_held = jump_override
		pressed = jump_override
		sprint = sprint_override
		dodge = dodge_override
		jump_override = false
		dodge_override = false
	else:
		jump_held = Input.is_action_pressed("jump")
		pressed = Input.is_action_just_pressed("jump")
		sprint = Input.is_action_pressed("sprint")
		dodge = Input.is_action_just_pressed("dodge")
	var old_state: String = core.state
	output = core.step({"move": [mv.x, mv.y], "camYaw": camera_yaw(), "sprint": sprint, "jump": pressed, "jumpHeld": jump_held, "dodge": dodge}, delta)
	var m: Node3D = get_node_or_null(model_path) as Node3D
	if m != null:
		m.rotation.y = core.yaw
	for e: String in output.events:
		loco_event.emit(e)
	if core.state != old_state:
		state_changed.emit(core.state, old_state)

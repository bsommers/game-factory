extends Node3D
## Preview scene driver for godot.shot: sky, light, camera and one effect from res://vfx/defs/<def>.json.
@export var def_name: String = "whirlpool"
@export var cam_pos: Vector3 = Vector3(0, 8, 16)
@export var cam_look: Vector3 = Vector3(0, 0, 0)
@export var fixed_time: float = 5.0
@export var ground: bool = false
const Loader: GDScript = preload("res://scripts/vfx/vfx_loader.gd")


func _ready() -> void:
	var env: Environment = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.05, 0.07, 0.1)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.55, 0.65)
	env.ambient_light_energy = 0.8
	var we: WorldEnvironment = WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun: DirectionalLight3D = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, 30, 0)
	sun.light_energy = 1.2
	add_child(sun)
	if ground:
		var g: MeshInstance3D = MeshInstance3D.new()
		var pm: PlaneMesh = PlaneMesh.new()
		pm.size = Vector2(30, 30)
		var gm: StandardMaterial3D = StandardMaterial3D.new()
		gm.albedo_color = Color(0.16, 0.15, 0.15)
		pm.material = gm
		g.mesh = pm
		g.position.y = -0.02
		add_child(g)
	var cam: Camera3D = Camera3D.new()
	add_child(cam)
	cam.position = cam_pos
	cam.look_at(cam_look, Vector3.UP)
	var def: Dictionary = Loader.load_def("res://vfx/defs/%s.json" % def_name)
	add_child(Loader.build(def, {"time": fixed_time}))

extends Node
## Settings — user options persisted via ConfigFile (user://settings.cfg) and quality presets.
## Quality presets Low/Med/High/Ultra change environment effects (SDFGI, SSR, SSAO, SSIL, fog, glow),
## shadow atlas sizes/filtering, MSAA/TAA and 3D scaling. Every WorldEnvironment in the tree is updated
## on apply; levels may also call `apply_to_environment(env)` directly after building their environment.

enum Quality { LOW, MEDIUM, HIGH, ULTRA }
const QUALITY_NAMES: PackedStringArray = ["Low", "Medium", "High", "Ultra"]
const PATH: String = "user://settings.cfg"

## Per-preset values. msaa: Viewport.MSAA_*; scaling: Viewport.SCALING_3D_MODE_*.
const PRESETS: Array[Dictionary] = [
	{ # LOW
		"sdfgi": false, "ssr": false, "ssao": false, "ssil": false, "fog": false, "glow": true,
		"dir_shadow_size": 2048, "pos_shadow_size": 2048, "shadow_filter": RenderingServer.SHADOW_QUALITY_HARD,
		"msaa": Viewport.MSAA_DISABLED, "taa": false, "fxaa": true, "scale": 0.77, "scaling": Viewport.SCALING_3D_MODE_FSR,
		"ssao_quality": RenderingServer.ENV_SSAO_QUALITY_VERY_LOW, "ssr_steps": 16, "fog_size": 64, "fog_depth": 64,
		"sdfgi_rays": RenderingServer.ENV_SDFGI_RAY_COUNT_8, "sdfgi_cascades": 4, "dir_shadow_splits": 2,
	},
	{ # MEDIUM
		"sdfgi": true, "ssr": true, "ssao": true, "ssil": false, "fog": true, "glow": true,
		"dir_shadow_size": 4096, "pos_shadow_size": 4096, "shadow_filter": RenderingServer.SHADOW_QUALITY_SOFT_LOW,
		"msaa": Viewport.MSAA_DISABLED, "taa": true, "fxaa": false, "scale": 1.0, "scaling": Viewport.SCALING_3D_MODE_BILINEAR,
		"ssao_quality": RenderingServer.ENV_SSAO_QUALITY_LOW, "ssr_steps": 32, "fog_size": 96, "fog_depth": 96,
		"sdfgi_rays": RenderingServer.ENV_SDFGI_RAY_COUNT_16, "sdfgi_cascades": 4, "dir_shadow_splits": 4,
	},
	{ # HIGH
		"sdfgi": true, "ssr": true, "ssao": true, "ssil": true, "fog": true, "glow": true,
		"dir_shadow_size": 4096, "pos_shadow_size": 4096, "shadow_filter": RenderingServer.SHADOW_QUALITY_SOFT_MEDIUM,
		"msaa": Viewport.MSAA_DISABLED, "taa": true, "fxaa": false, "scale": 1.0, "scaling": Viewport.SCALING_3D_MODE_BILINEAR,
		"ssao_quality": RenderingServer.ENV_SSAO_QUALITY_MEDIUM, "ssr_steps": 64, "fog_size": 128, "fog_depth": 128,
		"sdfgi_rays": RenderingServer.ENV_SDFGI_RAY_COUNT_32, "sdfgi_cascades": 6, "dir_shadow_splits": 4,
	},
	{ # ULTRA
		"sdfgi": true, "ssr": true, "ssao": true, "ssil": true, "fog": true, "glow": true,
		"dir_shadow_size": 8192, "pos_shadow_size": 8192, "shadow_filter": RenderingServer.SHADOW_QUALITY_SOFT_HIGH,
		"msaa": Viewport.MSAA_4X, "taa": true, "fxaa": false, "scale": 1.0, "scaling": Viewport.SCALING_3D_MODE_BILINEAR,
		"ssao_quality": RenderingServer.ENV_SSAO_QUALITY_HIGH, "ssr_steps": 96, "fog_size": 160, "fog_depth": 160,
		"sdfgi_rays": RenderingServer.ENV_SDFGI_RAY_COUNT_64, "sdfgi_cascades": 8, "dir_shadow_splits": 4,
	},
]

const DEFAULTS: Dictionary = {
	"graphics": {"quality": Quality.HIGH, "vsync": true, "max_fps": 0, "fullscreen": false, "msaa_override": -1, "fov": 70.0},
	"audio": {"master": 1.0, "music": 0.7, "sfx": 1.0},
	"input": {"mouse_sensitivity": 0.0025, "invert_y": false, "gamepad_sensitivity": 3.0},
	"game": {"skill": 2, "shoulder": "right", "show_fps": false},
}

var _cfg: ConfigFile = ConfigFile.new()
## When false (tests), save() is a no-op and nothing is written to disk.
var persist: bool = true

func _ready() -> void:
	load_settings()
	apply()

# ───────────────────────────── access ─────────────────────────────
func get_value(section: String, key: String) -> Variant:
	var def: Variant = DEFAULTS.get(section, {}).get(key, null)
	return _cfg.get_value(section, key, def)

func set_value(section: String, key: String, value: Variant, apply_now: bool = true) -> void:
	_cfg.set_value(section, key, value)
	if apply_now:
		apply()
	save()

var quality: int:
	get: return clampi(int(get_value("graphics", "quality")), Quality.LOW, Quality.ULTRA)
	set(v): set_value("graphics", "quality", clampi(v, Quality.LOW, Quality.ULTRA))

var mouse_sensitivity: float:
	get: return float(get_value("input", "mouse_sensitivity"))
	set(v): set_value("input", "mouse_sensitivity", clampf(v, 0.0001, 0.05), false)

var skill: int:
	get: return clampi(int(get_value("game", "skill")), 0, 3)
	set(v): set_value("game", "skill", clampi(v, 0, 3), false)

func preset() -> Dictionary:
	return PRESETS[quality]

# ───────────────────────────── persistence ─────────────────────────────
func load_settings(path: String = PATH) -> void:
	_cfg = ConfigFile.new()
	if FileAccess.file_exists(path):
		var err: Error = _cfg.load(path)
		if err != OK:
			push_warning("Settings: could not load %s (%s); using defaults" % [path, error_string(err)])
			_cfg = ConfigFile.new()

func save(path: String = PATH) -> Error:
	if not persist:
		return OK
	return _cfg.save(path)

func reset_to_defaults() -> void:
	_cfg = ConfigFile.new()
	apply()
	save()

# ───────────────────────────── apply ─────────────────────────────
func apply() -> void:
	var p: Dictionary = preset()
	# Global rendering-server quality knobs.
	RenderingServer.directional_shadow_atlas_set_size(int(p["dir_shadow_size"]), true)
	RenderingServer.directional_soft_shadow_filter_set_quality(p["shadow_filter"])
	RenderingServer.positional_soft_shadow_filter_set_quality(p["shadow_filter"])
	RenderingServer.environment_set_ssao_quality(p["ssao_quality"], true, 0.5, 2, 50.0, 300.0)
	RenderingServer.environment_set_sdfgi_ray_count(p["sdfgi_rays"])
	RenderingServer.environment_set_volumetric_fog_volume_size(int(p["fog_size"]), int(p["fog_depth"]))
	# Window / main viewport.
	if is_inside_tree():
		var vp: Viewport = get_tree().root
		apply_to_viewport(vp)
		for env_node: Node in get_tree().root.find_children("*", "WorldEnvironment", true, false):
			var we: WorldEnvironment = env_node as WorldEnvironment
			if we and we.environment:
				apply_to_environment(we.environment)
		for light: Node in get_tree().root.find_children("*", "DirectionalLight3D", true, false):
			apply_to_light(light as Light3D)
	if DisplayServer.get_name() != "headless":
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if bool(get_value("graphics", "vsync")) else DisplayServer.VSYNC_DISABLED)
	Engine.max_fps = int(get_value("graphics", "max_fps"))
	_apply_display()
	_apply_audio()
	if is_inside_tree() and has_node("/root/Events"):
		get_node("/root/Events").settings_changed.emit()

func apply_to_viewport(vp: Viewport) -> void:
	var p: Dictionary = preset()
	var msaa: int = int(get_value("graphics", "msaa_override"))
	vp.msaa_3d = (p["msaa"] if msaa < 0 else msaa) as Viewport.MSAA
	vp.use_taa = bool(p["taa"])
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if bool(p["fxaa"]) else Viewport.SCREEN_SPACE_AA_DISABLED
	vp.scaling_3d_mode = p["scaling"]
	vp.scaling_3d_scale = float(p["scale"])
	vp.positional_shadow_atlas_size = int(p["pos_shadow_size"])
	vp.use_debanding = true

## Toggle the expensive effects of an Environment for the current preset. Keeps the level's own tuning
## (colors, densities, energies); only switches features and step counts.
func apply_to_environment(env: Environment) -> void:
	var p: Dictionary = preset()
	env.sdfgi_enabled = bool(p["sdfgi"])
	env.sdfgi_cascades = int(p["sdfgi_cascades"])
	env.ssr_enabled = bool(p["ssr"])
	env.ssr_max_steps = int(p["ssr_steps"])
	env.ssao_enabled = bool(p["ssao"])
	env.ssil_enabled = bool(p["ssil"])
	env.volumetric_fog_enabled = bool(p["fog"])
	env.glow_enabled = bool(p["glow"])

func apply_to_light(light: Light3D) -> void:
	if light == null:
		return
	var p: Dictionary = preset()
	if light is DirectionalLight3D:
		(light as DirectionalLight3D).directional_shadow_mode = (
			DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if int(p["dir_shadow_splits"]) >= 4 else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS)

func _apply_audio() -> void:
	for bus_name: String in ["Master", "Music", "SFX"]:
		var idx: int = AudioServer.get_bus_index(bus_name)
		if idx < 0:
			continue
		var key: String = "master" if bus_name == "Master" else bus_name.to_lower()
		var v: float = clampf(float(get_value("audio", key)), 0.0, 1.0)
		AudioServer.set_bus_volume_db(idx, linear_to_db(maxf(v, 0.0001)))


## Fullscreen / resolution (resolution lives in UIPrefs; SettingsMenu.apply_display does both).
func _apply_display() -> void:
	if DisplayServer.get_name() == "headless":
		return
	const MENU: String = "res://scripts/ui/settings_menu.gd"
	if ResourceLoader.exists(MENU):
		var scr: GDScript = load(MENU) as GDScript
		if scr != null and scr.has_method("apply_display"):
			scr.call("apply_display")

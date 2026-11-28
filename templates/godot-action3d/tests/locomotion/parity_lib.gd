extends RefCounted
## Scenario runner for spec/v4/parity/{locomotion3d,camera3d}/*.json. Runs the deterministic GDScript cores
## (no engine physics) and compares against the `expected` block the JS reference produced (spec/v4/parity/README.md).

const LocoCore := preload("res://scripts/locomotion/locomotion_core.gd")
const CamCore := preload("res://scripts/camera/camera_core.gd")


static func parity_dir() -> String:
	var env: String = OS.get_environment("FACTORY_PARITY_DIR")
	if env != "":
		return env
	return ProjectSettings.globalize_path("res://").path_join("../../spec/v4/parity").simplify_path()


static func read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))


static func resolve_config(scn: Dictionary, scn_path: String) -> Dictionary:
	var c: Variant = scn.get("config", {})
	if c is String:
		c = read_json(scn_path.get_base_dir().path_join(c))
	return c if c is Dictionary else {}


## World environment callbacks, identical rules to factory-core/locomotion3d buildWorld (flat floor y = 0).
static func build_env(w: Variant) -> Dictionary:
	var kind: String = w if w is String else str(w.get("kind", "flat"))
	var wd: Dictionary = w if w is Dictionary else {}
	var env: Dictionary = {}
	match kind:
		"ice":
			var fr: float = float(wd.get("friction", 0.08))
			env["surface"] = func(p: Array, _n: Variant) -> Variant: return {"friction": fr} if p[2] < -5.0 else null
		"conveyor":
			var fl: Array = wd.get("flow", [0.0, 0.0, -3.0])
			env["surface"] = func(p: Array, _n: Variant) -> Variant: return {"flow": fl} if p[2] < -5.0 else null
		"river":
			var sy: float = float(wd.get("surfaceY", 2.0))
			var flow: Array = wd.get("flow", [3.0, 0.0, 0.0])
			env["water"] = func(p: Array) -> Variant: return {"surfaceY": sy, "flow": flow} if p[2] < -5.0 else null
		"platform":
			var vv: Array = wd.get("velocity", [2.0, 0.0, 0.0])
			env["platform"] = func(p: Array, _n: Variant) -> Variant: return vv if absf(p[0]) < 2.0 and absf(p[2]) < 2.0 else null
	return env


static func supported_world(w: Variant) -> bool:
	var kind: String = w if w is String else str(w.get("kind", "flat"))
	return kind in ["flat", "ice", "conveyor", "river", "platform"]


## Runs a locomotion scenario; returns {steps, samples:{step:{...}}, events:[{step,event}], final}.
static func run_locomotion(scn: Dictionary, scn_path: String) -> Dictionary:
	var cfg: Dictionary = resolve_config(scn, scn_path)
	var core := LocoCore.new(cfg, scn.get("start", [0.0, 0.0, 0.0]), float(scn.get("yaw", 0.0)))
	var env: Dictionary = build_env(scn.get("world", "flat"))
	var dt: float = LocoCore.DT
	for i in int(scn.get("settle", 30)):
		core.step({}, dt, env)
	core.t = 0.0
	var samples: Dictionary = {}
	var events: Array = []
	var step: int = 0
	for seg: Dictionary in scn.get("script", []):
		var n: int = int(seg["frames"]) if seg.has("frames") else roundi(float(seg.get("seconds", 1.0)) / dt)
		if seg.has("impulse"):
			core.apply_impulse(seg["impulse"], float(seg["stun"]) if seg.has("stun") else -1.0)
		for k in n:
			var inp: Dictionary = {
				"move": seg.get("move", [0.0, 0.0]), "camYaw": float(seg.get("camYaw", 0.0)), "sprint": bool(seg.get("sprint", false)),
				"jump": k == 0 and bool(seg.get("jump", false)), "jumpHeld": bool(seg.get("jumpHeld", false)), "dodge": k == 0 and bool(seg.get("dodge", false)),
			}
			var o: Dictionary = core.step(inp, dt, env)
			for e: String in o.events:
				events.append({"step": step, "event": e})
			samples[step] = {"state": o.locomotionState, "pos": o.pos, "speed": o.speed, "vy": o.verticalVelocity, "yaw": o.yaw, "grounded": o.grounded, "invulnerable": o.invulnerable}
			step += 1
	return {"steps": step, "samples": samples, "events": events}


static func _plane_sweeper(wall_z: float) -> Callable:
	# axis-aligned wall occupying z >= wall_z (box from wall_z to wall_z + 1): sphere sweep against its -Z face.
	return func(o: Array, r: float, d: Array) -> float:
		if d[2] <= 1e-12 or o[2] + r > wall_z:
			return -1.0
		var t: float = (wall_z - r - o[2]) / d[2]
		return t if t < 1.0 else -1.0


static func run_camera(scn: Dictionary, scn_path: String) -> Dictionary:
	var cfg: Dictionary = resolve_config(scn, scn_path)
	var start: Array = scn.get("start", [0.0, 0.0, 0.0])
	var cam := CamCore.new(cfg, start, float(scn.get("yaw", 0.0)), float(scn["pitch"]) if scn.has("pitch") else NAN)
	var world: Variant = scn.get("world", null)
	if world is Dictionary and str(world.get("kind", "")) == "wallZ":
		cam.sweep = _plane_sweeper(float(world.get("z", 3.0)))
	var dt: float = float(scn.get("dt", 1.0 / 60.0))
	var tpos: Array = [float(start[0]), float(start[1]), float(start[2])]
	var samples: Dictionary = {}
	var step: int = 0
	for seg: Dictionary in scn.get("script", []):
		if seg.has("target"):
			tpos = [float(seg.target[0]), float(seg.target[1]), float(seg.target[2])]
		var vel: Array = seg.get("velocity", [0.0, 0.0, 0.0])
		for k in int(seg.get("frames", 1)):
			tpos = [tpos[0] + vel[0] * dt, tpos[1] + vel[1] * dt, tpos[2] + vel[2] * dt]
			if k == 0 and seg.has("trauma"):
				cam.add_trauma(float(seg.trauma))
			if k == 0 and seg.has("fovKick"):
				cam.kick_fov(float(seg.fovKick))
			cam.step({"target": tpos, "yawDelta": float(seg.get("yawDelta", 0.0)), "pitchDelta": float(seg.get("pitchDelta", 0.0)), "lock": seg.get("lock", null), "aim": bool(seg.get("aim", false))}, dt)
			samples[step] = {"pos": cam.out.pos, "target": cam.out.target, "fov": cam.out.fov, "distance": cam.out.distance, "roll": cam.out.roll, "collided": cam.collided}
			step += 1
	return {"steps": step, "samples": samples, "events": []}


static func run_scenario(scn: Dictionary, scn_path: String) -> Dictionary:
	return run_camera(scn, scn_path) if str(scn.get("kind", "locomotion3d")) == "camera3d" else run_locomotion(scn, scn_path)


static func _num_diff(a: Variant, b: Variant) -> float:
	if a is Array:
		var m: float = 0.0
		for i in a.size():
			m = maxf(m, absf(float(a[i]) - float(b[i])))
		return m
	return absf(float(a) - float(b))


## Compares a Godot run with scn.expected. Returns {ok, errors[], maxErr:{key:value}}.
static func compare(scn: Dictionary, got: Dictionary) -> Dictionary:
	var exp: Dictionary = scn.get("expected", {})
	var tol: Dictionary = scn.get("tolerance", {})
	var errors: PackedStringArray = []
	var max_err: Dictionary = {}
	if int(exp.get("steps", -1)) != int(got.steps):
		errors.append("step count: expected %s got %s" % [exp.get("steps"), got.steps])
	for s: Dictionary in exp.get("samples", []):
		var step: int = int(s["step"])
		if not got.samples.has(step):
			errors.append("missing step %d" % step)
			continue
		var g: Dictionary = got.samples[step]
		for key: String in s:
			if key == "step":
				continue
			var ev: Variant = s[key]
			var gv: Variant = g[key]
			if ev is bool or ev is String:
				if ev != gv:
					errors.append("step " + str(step) + " " + key + ": expected " + str(ev) + " got " + str(gv))
			else:
				var d: float = _num_diff(ev, gv)
				if d > float(tol.get(key, tol.get("default", 1e-6))):
					errors.append("step " + str(step) + " " + key + ": |diff| " + str(d) + " > tol (exp " + str(ev) + " got " + str(gv) + ")")
				max_err[key] = maxf(float(max_err.get(key, 0.0)), d)
		if errors.size() > 12:
			errors.append("... truncated")
			break
	if exp.has("events"):
		var a: String = ",".join(Array(exp.events).map(func(e: Dictionary) -> String: return "%d:%s" % [int(e.step), e.event]))
		var b: String = ",".join(Array(got.events).map(func(e: Dictionary) -> String: return "%d:%s" % [int(e.step), e.event]))
		if a != b:
			errors.append("events differ:\n  expected %s\n  got      %s" % [a, b])
	return {"ok": errors.is_empty(), "errors": errors, "maxErr": max_err}

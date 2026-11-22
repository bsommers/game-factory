extends RefCounted
## Deterministic third-person camera stepper: a port of templates/web-project/src/lib/camera3d.js (spec/v4/camera3d.md).
## Plain 64-bit floats and Arrays, fixed/variable dt, no engine physics. The boom collision probe is a pluggable
## `sweep` Callable(origin: Array, radius: float, delta: Array) -> float returning the hit fraction t in [0,1], or -1.0 for no hit.
## yaw 0 puts the camera at +Z of the pivot looking toward -Z. No class_name: preload("res://scripts/camera/camera_core.gd").

const DEFAULTS: Dictionary = {
	"follow": {"distance": 4.5, "minDistance": 0.6, "height": 1.6, "shoulder": 0.0, "pitch": 0.25, "minPitch": -0.45, "maxPitch": 1.2, "positionLag": 0.08, "rotationLag": 0.05, "probeRadius": 0.25, "collisionRecoverLag": 0.25},
	"lockOn": {"maxRange": 18.0, "maxAngle": 1.2, "rotationLag": 0.12, "blendLag": 0.15, "framing": 0.5, "framingDistancePerMetre": 0.15, "maxExtraDistance": 3.0, "pitch": 0.3, "angleWeight": 1.0, "distanceWeight": 0.05},
	"aim": {"distance": 2.2, "shoulder": 0.6, "offset": [0.2, 0.0], "fov": 55.0, "blendLag": 0.08},
	"fov": {"base": 70.0, "kickDecay": 0.18, "max": 110.0},
	"shake": {"maxYaw": 0.05, "maxPitch": 0.05, "maxRoll": 0.04, "maxOffset": 0.15, "frequency": 18.0, "decay": 1.2, "power": 2.0, "seed": 1},
}

var cfg: Dictionary
var yaw: float = 0.0
var pitch: float = 0.0
var pivot: Array = [0.0, 0.0, 0.0]
var boom_scale: float = 1.0
var collided: bool = false
var lock_blend: float = 0.0
var aim_blend: float = 0.0
var fov_kick: float = 0.0
var trauma: float = 0.0
var time: float = 0.0
var seed_i: int = 1
## out = {pos, target, up, fov, roll, distance}
var out: Dictionary = {}
var sweep: Callable = Callable()


static func merge_config(partial: Dictionary = {}) -> Dictionary:
	var c: Dictionary = DEFAULTS.duplicate(true)
	for k: String in partial:
		if partial[k] is Dictionary and c.has(k) and c[k] is Dictionary:
			for kk: String in partial[k]:
				c[k][kk] = partial[k][kk]
	for s: String in DEFAULTS:
		for kk: String in DEFAULTS[s]:
			var d: Variant = DEFAULTS[s][kk]
			if d is float and typeof(c[s][kk]) == TYPE_INT:
				c[s][kk] = float(c[s][kk])
			elif d is Array:
				var arr: Array = []
				for v: Variant in c[s][kk]:
					arr.append(float(v))
				c[s][kk] = arr
	return c


static func load_config_file(path: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return merge_config(parsed if parsed is Dictionary else {})


func _init(config: Dictionary = {}, target: Array = [0.0, 0.0, 0.0], yaw0: float = 0.0, pitch0: float = NAN) -> void:
	cfg = merge_config(config)
	yaw = yaw0
	pitch = cfg.follow.pitch if is_nan(pitch0) else pitch0
	seed_i = int(cfg.shake.seed)
	pivot = [float(target[0]), float(target[1]) + float(cfg.follow.height), float(target[2])]
	out = {"pos": [0.0, 0.0, 0.0], "target": [0.0, 0.0, 0.0], "up": [0.0, 1.0, 0.0], "fov": cfg.fov.base, "roll": 0.0, "distance": cfg.follow.distance}
	step({"target": target}, 0.0)


static func _sub(a: Array, b: Array) -> Array:
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


static func _add(a: Array, b: Array) -> Array:
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


static func _mul(a: Array, k: float) -> Array:
	return [a[0] * k, a[1] * k, a[2] * k]


static func _len(a: Array) -> float:
	return sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


static func _lerp3(a: Array, b: Array, k: float) -> Array:
	return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]


static func _wrap(a: float) -> float:
	a = fposmod(a + PI, TAU)
	return a - PI


static func _k_of(lag: float, dt: float) -> float:
	return 1.0 - exp(-dt / lag) if lag > 0.0 else 1.0


# ---- seeded value noise (32-bit integer hash, identical to the JS Math.imul version) ----
static func _hash(seed_: int, ch: int, i: int) -> float:
	var m: int = 0xFFFFFFFF
	var h: int = (((seed_ & m) * 0x9e3779b1) & m) ^ (((ch + 1) * 0x85ebca6b) & m) ^ (((i & m) * 0xc2b2ae35) & m)
	h ^= h >> 15
	h = (h * 0x2c1b3c6d) & m
	h ^= h >> 12
	h = (h * 0x297a2d39) & m
	h ^= h >> 15
	return (float(h & m) / 4294967296.0) * 2.0 - 1.0


static func noise1(seed_: int, ch: int, x: float) -> float:
	var i: float = floorf(x)
	var f: float = x - i
	var u: float = f * f * (3.0 - 2.0 * f)
	var a: float = _hash(seed_, ch, int(i))
	var b: float = _hash(seed_, ch, int(i) + 1)
	return a + (b - a) * u


func add_trauma(amount: float) -> void:
	trauma = clampf(trauma + amount, 0.0, 1.0)


func kick_fov(deg: float) -> void:
	fov_kick += deg


## input = {target:[x,y,z], yawDelta, pitchDelta, lock:[x,y,z]|null, aim:bool}
func step(input: Dictionary, dt: float) -> void:
	var F: Dictionary = cfg.follow
	var L: Dictionary = cfg.lockOn
	var A: Dictionary = cfg.aim
	var V: Dictionary = cfg.fov
	var S: Dictionary = cfg.shake
	var tgt: Array = input.target
	var lock: Variant = input.get("lock", null)
	var has_lock: bool = lock != null
	var dtk: float = dt if dt > 0.0 else 1e9
	# 1. pivot
	var base: Array = [tgt[0], float(tgt[1]) + F.height, tgt[2]]
	pivot = _lerp3(pivot, base, _k_of(F.positionLag, dt)) if dt > 0.0 else base
	# 2. lock-on / orbit
	lock_blend += ((1.0 if has_lock else 0.0) - lock_blend) * _k_of(L.blendLag, dtk)
	if has_lock:
		var to_p: Array = _sub(tgt, lock)
		var want_yaw: float = atan2(to_p[0], to_p[2])
		yaw += _wrap(want_yaw - yaw) * _k_of(L.rotationLag, dtk)
		pitch += (L.pitch - pitch) * _k_of(L.rotationLag, dtk)
	else:
		yaw = _wrap(yaw + float(input.get("yawDelta", 0.0)))
		pitch += float(input.get("pitchDelta", 0.0))
	pitch = clampf(pitch, F.minPitch, F.maxPitch)
	# 3. aim blend
	aim_blend += ((1.0 if bool(input.get("aim", false)) else 0.0) - aim_blend) * _k_of(A.blendLag, dtk)
	var ab: float = aim_blend
	var lb: float = lock_blend
	var dist: float = F.distance + (A.distance - F.distance) * ab
	if has_lock:
		dist += clampf(_len(_sub(lock, tgt)) * L.framingDistancePerMetre, 0.0, L.maxExtraDistance) * lb
	var shoulder: float = (F.shoulder + (A.shoulder - F.shoulder) * ab) + A.offset[0] * ab
	var y_off: float = A.offset[1] * ab
	# 4. boom
	var cy: float = cos(yaw)
	var sy: float = sin(yaw)
	var cp: float = cos(pitch)
	var sp: float = sin(pitch)
	var dir: Array = [sy * cp, sp, cy * cp]
	var rgt: Array = [cy, 0.0, -sy]
	var P: Array = [pivot[0] + rgt[0] * shoulder, pivot[1] + y_off, pivot[2] + rgt[2] * shoulder]
	var want: float = 1.0
	var hit_flag: bool = false
	if sweep.is_valid():
		var ht: float = sweep.call(P, F.probeRadius, _mul(dir, dist))
		if ht >= 0.0:
			want = clampf(ht, 0.0, 1.0)
			hit_flag = true
	want = maxf(want, minf(1.0, F.minDistance / dist))
	boom_scale = minf(want, boom_scale + (want - boom_scale) * _k_of(F.collisionRecoverLag, dtk))
	if boom_scale > want:
		boom_scale = want
	collided = hit_flag and boom_scale < 1.0 - 1e-6
	var L2: float = dist * boom_scale
	var pos: Array = _add(P, _mul(dir, L2))
	var look: Array = P
	if has_lock:
		look = _lerp3(P, lock, L.framing * lb)
	# 5. fov
	if dt > 0.0:
		fov_kick *= exp(-dt / maxf(V.kickDecay, 1e-6))
	var fov: float = clampf(V.base + (A.fov - V.base) * ab + fov_kick, 1.0, V.max)
	# 6. shake (output only)
	time += dt
	trauma = maxf(0.0, trauma - S.decay * dt)
	var sh: float = pow(trauma, S.power)
	var x: float = time * S.frequency
	var f: Array = _sub(look, pos)
	var fl: float = _len(f)
	if fl == 0.0:
		fl = 1.0
	f = _mul(f, 1.0 / fl)
	var o_pos: Array = pos
	var o_tgt: Array = look
	var o_up: Array = [0.0, 1.0, 0.0]
	var o_roll: float = 0.0
	if sh > 0.0:
		var yw: float = atan2(f[0], f[2]) + sh * S.maxYaw * noise1(seed_i, 0, x)
		var pt: float = clampf(asin(clampf(f[1], -1.0, 1.0)) + sh * S.maxPitch * noise1(seed_i, 1, x), -1.5, 1.5)
		var f2: Array = [sin(yw) * cos(pt), sin(pt), cos(yw) * cos(pt)]
		var r2: Array = [cos(yw), 0.0, -sin(yw)]
		var u2: Array = [-sin(pt) * sin(yw), cos(pt), -sin(pt) * cos(yw)]
		var roll: float = sh * S.maxRoll * noise1(seed_i, 2, x)
		var off: Array = [sh * S.maxOffset * noise1(seed_i, 3, x), sh * S.maxOffset * noise1(seed_i, 4, x)]
		var p2: Array = _add(_add(pos, _mul(r2, off[0])), _mul(u2, off[1]))
		o_pos = p2
		o_tgt = _add(p2, _mul(f2, fl))
		o_up = _add(_mul(u2, cos(roll)), _mul(r2, sin(roll)))
		o_roll = roll
	out = {"pos": o_pos, "target": o_tgt, "up": o_up, "fov": fov, "roll": o_roll, "distance": L2}

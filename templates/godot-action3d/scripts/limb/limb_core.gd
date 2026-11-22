extends RefCounted
## Deterministic procedural limb stepper. Mirror of templates/web-project/src/lib/limb3d.js (spec/v4/limb3d.md).
## Pure data in/out: cfg is the parsed limb JSON (Dictionary); state is a Dictionary from create(). No nodes, no engine time.
## Apply step()["pose"]["bones"] to a Skeleton3D (bone i: position pos, rotation q = [x,y,z,w]); use ["capsules"] for hitboxes.
const FPS: int = 60
const DT: float = 1.0 / 60.0
const TAU_F: float = 6.283185307179586
const M32: int = 0xFFFFFFFF

static func _f(s: float) -> int:
	return maxi(0, int(roundf(s * FPS)))

static func _num(d: Dictionary, k: String, fb: float) -> float:
	return float(d[k]) if d.has(k) else fb

static func _v3(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))

static func _ease(name: String, u: float) -> float:
	u = clampf(u, 0.0, 1.0)
	if name == "easeIn":
		return u * u * u
	if name == "easeOut":
		var v: float = 1.0 - u
		return 1.0 - v * v * v
	if name == "easeInOut":
		return u * u * (3.0 - 2.0 * u)
	return u

static func _imul(a: int, b: int) -> int:
	return (a * b) & M32

static func _rng_next(st: Dictionary) -> float:
	st["rng"] = (int(st["rng"]) + 0x6d2b79f5) & M32
	var t: int = int(st["rng"])
	t = _imul(t ^ (t >> 15), t | 1)
	t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & M32)) & M32
	return float((t ^ (t >> 14)) & M32) / 4294967296.0

static func _norm(a: Vector3, fb: Vector3) -> Vector3:
	var l: float = a.length()
	return fb if l < 1e-9 else a / l

static func _perp(a: Vector3) -> Vector3:
	var t: Vector3 = Vector3(1, 0, 0) if absf(a.x) < 0.9 else Vector3(0, 0, 1)
	return _norm(a.cross(t), Vector3(0, 0, 1))

static func _rot_between(a: Vector3, b: Vector3) -> Array:
	var c: float = a.dot(b)
	if c < -0.999999:
		var p: Vector3 = _perp(a)
		return [p.x, p.y, p.z, 0.0]
	var x: Vector3 = a.cross(b)
	var l: float = sqrt(x.x * x.x + x.y * x.y + x.z * x.z + (1.0 + c) * (1.0 + c))
	return [x.x / l, x.y / l, x.z / l, (1.0 + c) / l]

static func _qmul(a: Array, b: Array) -> Array:
	return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]

# ---------------------------------------------------------------- config
static func seg_lengths(cfg: Dictionary) -> Array:
	var n: int = int(cfg["segments"])
	var out: Array = []
	if cfg.has("segmentLengths"):
		for i: int in range(n):
			out.append(float(cfg["segmentLengths"][i]))
		return out
	var L: float = _num(cfg, "segmentLength", 1.0)
	var taper: float = _num(cfg, "lengthTaper", 1.0)
	for i: int in range(n):
		out.append(L * ((1.0 + (taper - 1.0) * (float(i) / float(n - 1))) if n > 1 else 1.0))
	return out

static func seg_radius(cfg: Dictionary, i: int) -> float:
	var n: int = int(cfg["segments"])
	var r: Variant = cfg["radius"]
	if typeof(r) != TYPE_DICTIONARY:
		return float(r)
	var b: float = _num(r, "base", 0.3)
	var t: float = _num(r, "tip", b)
	return b + (t - b) * (float(i) / float(n - 1) if n > 1 else 0.0)

static func root_pos(cfg: Dictionary) -> Vector3:
	return _v3(cfg["root"]["pos"]) if cfg.has("root") and cfg["root"].has("pos") else Vector3.ZERO

static func root_dir(cfg: Dictionary) -> Vector3:
	return _norm(_v3(cfg["root"]["dir"]), Vector3.UP) if cfg.has("root") and cfg["root"].has("dir") else Vector3.UP

static func total_reach(cfg: Dictionary, count: int) -> float:
	var ls: Array = seg_lengths(cfg)
	var s: float = 0.0
	for i: int in range(count):
		s += float(ls[i])
	return s

# ---------------------------------------------------------------- state
static func create(cfg: Dictionary, seed_v: int = 1) -> Dictionary:
	var st: Dictionary = {"f": 0, "rng": (seed_v & M32) if (seed_v & M32) != 0 else 1, "count": int(cfg["segments"]), "joints": [], "goal": Vector3.ZERO, "motion": null, "regrow": null, "phase": []}
	for i: int in range(3):
		st["phase"].append(_rng_next(st) * TAU_F)
	var ls: Array = seg_lengths(cfg)
	var d: Vector3 = root_dir(cfg)
	var p: Vector3 = root_pos(cfg)
	st["joints"].append(p)
	for i: int in range(int(cfg["segments"])):
		p = p + d * float(ls[i])
		st["joints"].append(p)
	st["goal"] = _rest_goal(cfg, st)
	return st

static func _rest_goal(cfg: Dictionary, st: Dictionary) -> Vector3:
	return root_pos(cfg) + root_dir(cfg) * (total_reach(cfg, int(st["count"])) * _num(cfg, "restFrac", 0.9))

static func _sway(cfg: Dictionary, st: Dictionary) -> Vector3:
	if not cfg.has("sway") or not (_num(cfg["sway"], "amp", 0.0) > 0.0):
		return Vector3.ZERO
	var s: Dictionary = cfg["sway"]
	var a: float = float(s["amp"]) * total_reach(cfg, int(st["count"]))
	var w: float = TAU_F * _num(s, "freq", 0.3) * (float(st["f"]) / float(FPS))
	var ph: Array = st["phase"]
	return Vector3(a * sin(w + ph[0]), 0.5 * a * sin(w * 0.7 + ph[1]), a * cos(w * 1.3 + ph[2]))

static func _idle_goal(cfg: Dictionary, st: Dictionary, target: Variant) -> Vector3:
	var root: Vector3 = root_pos(cfg)
	var R: float = total_reach(cfg, int(st["count"]))
	var g: Vector3 = _rest_goal(cfg, st)
	if cfg.has("seek") and target != null:
		var v: Vector3 = (target as Vector3) - root
		var dist: float = v.length()
		if dist <= _num(cfg["seek"], "range", R * 1.5):
			g = root + _norm(v, root_dir(cfg)) * minf(dist, R * 0.9)
			g.y += _num(cfg["seek"], "height", 0.0)
	return g + _sway(cfg, st)

static func _clamp_reach(cfg: Dictionary, st: Dictionary, g: Vector3) -> Vector3:
	var root: Vector3 = root_pos(cfg)
	var v: Vector3 = g - root
	var l: float = v.length()
	var R: float = total_reach(cfg, int(st["count"])) * 0.999
	return root + v * (R / l) if l > R else g

static func _clamp_angle(d: Vector3, ref: Vector3, max_rad: float) -> Vector3:
	var c: float = clampf(d.dot(ref), -1.0, 1.0)
	if acos(c) <= max_rad:
		return d
	var pv: Vector3 = d - ref * c
	var pl: float = pv.length()
	pv = _perp(ref) if pl < 1e-9 else pv * (1.0 / pl)
	return ref * cos(max_rad) + pv * sin(max_rad)

static func solve(cfg: Dictionary, st: Dictionary, goal: Vector3) -> void:
	var n: int = int(st["count"])
	var ls: Array = seg_lengths(cfg)
	var root: Vector3 = root_pos(cfg)
	var rd: Vector3 = root_dir(cfg)
	var p: Array = []
	for i: int in range(n + 1):
		p.append(st["joints"][i])
	var iters: int = 1 if String(cfg.get("solver", "fabrik")) == "follow" else int(_num(cfg, "iterations", 8.0))
	var mb: float = deg_to_rad(_num(cfg, "maxBend", 35.0))
	var m0: float = deg_to_rad(_num(cfg, "maxBase", 60.0))
	for it: int in range(iters):
		p[n] = goal
		for i: int in range(n - 1, -1, -1):
			var bd: Vector3 = _norm(p[i] - p[i + 1], rd)
			if i < n - 1:
				bd = _clamp_angle(bd, _norm(p[i + 1] - p[i + 2], rd), mb)
			p[i] = p[i + 1] + bd * float(ls[i])
		p[0] = root
		var prev: Vector3 = rd
		for i: int in range(n):
			var d: Vector3 = _clamp_angle(_norm(p[i + 1] - p[i], prev), prev, m0 if i == 0 else mb)
			p[i + 1] = p[i] + d * float(ls[i])
			prev = d
	st["joints"] = p

# ---------------------------------------------------------------- motions
static func _phase_of(m: Dictionary, f: int) -> Dictionary:
	var w: int = _f(float(m["windup"]))
	var s: int = _f(float(m["strike"]))
	var r: int = _f(float(m["recover"]))
	if f < w:
		return {"name": "windup", "u": float(f) / float(w) if w > 0 else 1.0}
	if f < w + s:
		return {"name": "strike", "u": float(f - w) / float(s) if s > 0 else 1.0}
	if f < w + s + r:
		return {"name": "recover", "u": float(f - w - s) / float(r) if r > 0 else 1.0}
	return {"name": "done", "u": 1.0}

static func _sweep_pt(mo: Dictionary, a: float) -> Vector3:
	var root: Vector3 = mo["root"]
	var B: Vector3 = mo["B"]
	var rr: float = Vector2(B.x - root.x, B.z - root.z).length()
	return Vector3(root.x + rr * cos(a), B.y, root.z + rr * sin(a))

static func _start_motion(cfg: Dictionary, st: Dictionary, id: String, target: Variant, events: Array) -> void:
	var motions: Dictionary = cfg.get("motions", {})
	if not motions.has(id):
		events.append({"type": "commandRejected", "f": st["f"], "motion": id, "reason": "unknown"})
		return
	if st["motion"] != null or int(st["count"]) < int(cfg["segments"]):
		events.append({"type": "commandRejected", "f": st["f"], "motion": id, "reason": "busy" if st["motion"] != null else "severed"})
		return
	var m: Dictionary = motions[id]
	var root: Vector3 = root_pos(cfg)
	var R: float = total_reach(cfg, int(st["count"]))
	var lock: Vector3 = (target as Vector3) if target != null else root + root_dir(cfg) * (R * 0.9)
	var v: Vector3 = lock - root
	var aim: float = atan2(v.z, v.x)
	var tip: Vector3 = st["joints"][int(st["count"])]
	var dist: float = minf(v.length(), R * 0.95)
	var hd: float = Vector2(v.x, v.z).length()
	var dx: float = 1.0
	var dz: float = 0.0
	if hd >= 1e-6:
		dx = v.x / hd
		dz = v.z / hd
	var ret: float = _num(m, "retract", 0.5) * R
	var lift: float = _num(m, "lift", R * 0.5)
	var B: Vector3
	var C: Vector3
	var kind: String = String(m["kind"])
	if kind == "sweep":
		var rr: float = _num(m, "radius", dist)
		var h: float = _num(m, "height", root.y + 0.5)
		var a0: float = aim + deg_to_rad(float(m["arc"][0]))
		B = Vector3(root.x + rr * cos(a0), h, root.z + rr * sin(a0))
		C = Vector3(lock.x, h, lock.z)
	elif kind == "slam":
		B = Vector3(lock.x, lock.y + _num(m, "height", R * 0.8), lock.z)
		C = lock
	else:
		B = Vector3(root.x - dx * ret, root.y + lift, root.z - dz * ret)
		C = lock
	st["motion"] = {"id": id, "f": 0, "phase": "windup", "from": tip, "B": B, "C": C, "aim": aim, "root": root, "lock": lock}
	events.append({"type": "telegraph", "f": st["f"], "motion": id, "kind": kind})

static func _motion_goal(cfg: Dictionary, st: Dictionary, events: Array, idle: Vector3) -> Dictionary:
	var mo: Dictionary = st["motion"]
	var m: Dictionary = cfg["motions"][mo["id"]]
	var ph: Dictionary = _phase_of(m, int(mo["f"]))
	var cv: Dictionary = m.get("curves", {})
	var pname: String = ph["name"]
	var u: float = ph["u"]
	if pname != mo["phase"] and pname != "done":
		mo["phase"] = pname
		events.append({"type": pname, "f": st["f"], "motion": mo["id"]})
	if pname == "done":
		events.append({"type": "done", "f": st["f"], "motion": mo["id"]})
		st["motion"] = null
		return {"goal": idle, "damaging": false}
	var g: Vector3
	if pname == "windup":
		g = (mo["from"] as Vector3).lerp(mo["B"], _ease(String(cv.get("windup", "easeInOut")), u))
	elif pname == "strike":
		var e: float = _ease(String(cv.get("strike", "easeIn")), u)
		if String(m["kind"]) == "sweep":
			g = _sweep_pt(mo, float(mo["aim"]) + deg_to_rad(float(m["arc"][0]) + (float(m["arc"][1]) - float(m["arc"][0])) * e))
		else:
			g = (mo["B"] as Vector3).lerp(mo["C"], e)
	else:
		var from: Vector3 = mo["C"]
		if String(m["kind"]) == "sweep":
			from = _sweep_pt(mo, float(mo["aim"]) + deg_to_rad(float(m["arc"][1])))
		g = from.lerp(idle, _ease(String(cv.get("recover", "easeInOut")), u))
	mo["f"] = int(mo["f"]) + 1
	return {"goal": g, "damaging": pname == "strike", "damage": _num(m, "damage", 0.0), "hitSegments": int(_num(m, "hitSegments", 2.0)), "motion": mo["id"]}

# ---------------------------------------------------------------- sever / regrow
static func sever(cfg: Dictionary, st: Dictionary, keep: int) -> Variant:
	var sv: Dictionary = cfg.get("sever", {})
	if sv.has("allowed") and not bool(sv["allowed"]):
		return null
	keep = maxi(int(_num(sv, "minKeep", 1.0)), keep)
	if keep >= int(st["count"]):
		return null
	var lost: int = int(st["count"]) - keep
	st["count"] = keep
	st["joints"] = (st["joints"] as Array).slice(0, keep + 1)
	if cfg.has("regrow"):
		st["regrow"] = {"delay": _f(_num(cfg["regrow"], "delay", 5.0)), "acc": 0}
	var cancelled: bool = st["motion"] != null
	st["motion"] = null
	return {"type": "sever", "f": st["f"], "keep": keep, "lost": lost, "cancelledMotion": cancelled}

static func _regrow_step(cfg: Dictionary, st: Dictionary, events: Array) -> void:
	var rg: Variant = st["regrow"]
	if rg == null or int(st["count"]) >= int(cfg["segments"]):
		return
	if int(rg["delay"]) > 0:
		rg["delay"] = int(rg["delay"]) - 1
		return
	rg["acc"] = int(rg["acc"]) + 1
	if int(rg["acc"]) >= _f(_num(cfg["regrow"], "interval", 1.0)):
		rg["acc"] = 0
		var i: int = int(st["count"])
		var ls: Array = seg_lengths(cfg)
		var p: Array = st["joints"]
		var d: Vector3 = _norm(p[i] - p[i - 1], root_dir(cfg))
		p.append(p[i] + d * float(ls[i]))
		st["count"] = i + 1
		events.append({"type": "regrow", "f": st["f"], "segments": st["count"]})
		if int(st["count"]) >= int(cfg["segments"]):
			st["regrow"] = null
			events.append({"type": "regrown", "f": st["f"]})

# ---------------------------------------------------------------- outputs
static func capsules(cfg: Dictionary, st: Dictionary, hit_segments: int = 0, damage: float = 0.0) -> Array:
	var out: Array = []
	var n: int = int(st["count"])
	for i: int in range(n):
		var dmg: bool = hit_segments > 0 and i >= n - hit_segments
		out.append({"seg": i, "a": st["joints"][i], "b": st["joints"][i + 1], "r": seg_radius(cfg, i), "tip": i == n - 1, "stump": n < int(cfg["segments"]) and i == n - 1, "damaging": dmg, "damage": damage if dmg else 0.0})
	return out

static func pose(cfg: Dictionary, st: Dictionary) -> Dictionary:
	var n: int = int(st["count"])
	var bones: Array = []
	var q: Variant = null
	var prev: Vector3 = Vector3.UP
	for i: int in range(n):
		var d: Vector3 = _norm(st["joints"][i + 1] - st["joints"][i], prev)
		var r: Array = _rot_between(prev, d)
		q = r if q == null else _qmul(r, q)
		prev = d
		bones.append({"i": i, "pos": st["joints"][i], "q": q})
	return {"bones": bones, "tip": st["joints"][n], "count": n}

## input keys: target (Vector3), command ({motion, target?}), sever ({keep}). Returns {events, capsules, pose, tip}.
static func step(st: Dictionary, cfg: Dictionary, input: Dictionary = {}) -> Dictionary:
	var events: Array = []
	if input.has("sever"):
		var ev: Variant = sever(cfg, st, int(input["sever"]["keep"]))
		if ev != null:
			events.append(ev)
	var target: Variant = input.get("target", null)
	if input.has("command"):
		var cmd: Dictionary = input["command"]
		_start_motion(cfg, st, String(cmd["motion"]), cmd.get("target", target), events)
	var idle: Vector3 = _idle_goal(cfg, st, target)
	var goal: Vector3
	var hit: Dictionary = {"damaging": false}
	if st["motion"] != null:
		hit = _motion_goal(cfg, st, events, idle)
		goal = hit["goal"]
		st["goal"] = goal
	else:
		var sp: float = (float(cfg["seek"]["speed"]) if cfg.has("seek") and cfg["seek"].has("speed") else 4.0) * DT
		var v: Vector3 = idle - (st["goal"] as Vector3)
		var l: float = v.length()
		st["goal"] = idle if l <= sp else (st["goal"] as Vector3) + v * (sp / l)
		goal = st["goal"]
	solve(cfg, st, _clamp_reach(cfg, st, goal))
	_regrow_step(cfg, st, events)
	var caps: Array = capsules(cfg, st, int(hit["hitSegments"]), float(hit["damage"])) if hit["damaging"] else capsules(cfg, st)
	st["f"] = int(st["f"]) + 1
	return {"events": events, "capsules": caps, "pose": pose(cfg, st), "tip": st["joints"][int(st["count"])]}

# ---------------------------------------------------------------- scripted simulation (parity driver)
static func _at(keys: Array, f: int) -> Variant:
	if keys.is_empty():
		return null
	if f <= int(keys[0]["f"]):
		return _v3(keys[0]["pos"])
	for i: int in range(1, keys.size()):
		if f <= int(keys[i]["f"]):
			var a: Dictionary = keys[i - 1]
			var b: Dictionary = keys[i]
			var t: float = float(f - int(a["f"])) / float(maxi(1, int(b["f"]) - int(a["f"])))
			return _v3(a["pos"]).lerp(_v3(b["pos"]), t)
	return _v3(keys[keys.size() - 1]["pos"])

## Same script format as limb3d.simulate. Returns {trajectory:[{f,tip,count}], eventTypes:[...], finalTip, finalCount, finalQuats:[...], maxLenError}.
static func simulate(cfg: Dictionary, script: Dictionary) -> Dictionary:
	var st: Dictionary = create(cfg, int(script.get("seed", 1)))
	var steps: int = int(script.get("steps", 600))
	var sample: int = int(script.get("sample", 30))
	var ls: Array = seg_lengths(cfg)
	var cmds: Dictionary = {}
	for c: Dictionary in script.get("commands", []):
		cmds[int(c["f"])] = c
	var sevs: Dictionary = {}
	for c: Dictionary in script.get("severs", []):
		sevs[int(c["f"])] = c
	var traj: Array = []
	var etypes: Array = []
	var max_err: float = 0.0
	var out: Dictionary = {}
	for f: int in range(steps):
		var inp: Dictionary = {}
		var tg: Variant = _at(script.get("targets", []), f)
		if tg != null:
			inp["target"] = tg
		if cmds.has(f):
			var c: Dictionary = cmds[f]
			inp["command"] = {"motion": c["motion"]}
			if c.has("target"):
				inp["command"]["target"] = _v3(c["target"])
		if sevs.has(f):
			inp["sever"] = {"keep": int(sevs[f]["keep"])}
		out = step(st, cfg, inp)
		for e: Dictionary in out["events"]:
			etypes.append(e["type"])
		for i: int in range(int(st["count"])):
			max_err = maxf(max_err, absf((st["joints"][i + 1] - st["joints"][i]).length() - float(ls[i])))
		if f % sample == 0:
			var t: Vector3 = out["tip"]
			traj.append({"f": f, "tip": [t.x, t.y, t.z], "count": int(st["count"])})
	var ft: Vector3 = out["tip"]
	var quats: Array = []
	for b: Dictionary in out["pose"]["bones"]:
		quats.append(b["q"])
	return {"trajectory": traj, "eventTypes": etypes, "finalTip": [ft.x, ft.y, ft.z], "finalCount": int(st["count"]), "finalQuats": quats, "maxLenError": max_err}

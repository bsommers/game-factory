extends RefCounted
## GDScript mirror of templates/web-project/src/lib/combat3d.js (spec/v4/combat3d.md). Same JSON data, same algorithm, same
## event log, so `duel_hash` of the shipped duel is 6fedb1fe on both runtimes. State is plain Dictionaries/Arrays (no Vector3:
## it is float32). Field access uses d["key"] throughout (dot access collides with Dictionary methods).
## Usage: var r = Combat.simulate_duel(def_a, def_b, {"script": {...}, "frames": 240, "distance": 1.4, "seed": 7})
const J := preload("res://scripts/combat/js_compat.gd")
const FD := preload("res://scripts/combat/fdlibm.gd")
const C := preload("res://scripts/combat/collision3d.gd")

const DT: float = 1.0 / 60.0
const DAMAGE_TYPES: Array = ["physical", "fire", "water", "toxic"]


static func default_statuses() -> Dictionary:
	return {
		"poison": {"duration": 300, "tickEvery": 30, "damage": 2, "damageType": "toxic", "maxStacks": 3, "stackMode": "stack"},
		"burn": {"duration": 180, "tickEvery": 20, "damage": 3, "damageType": "fire", "maxStacks": 1, "stackMode": "refresh", "extinguishedBy": ["water"]},
		"slow": {"duration": 240, "speedMult": 0.5, "maxStacks": 1, "stackMode": "refresh"},
	}


static func default_hurt() -> Array:
	return [{"id": "body", "shape": {"type": "capsule", "a": [0.0, 0.4, 0.0], "b": [0.0, 1.4, 0.0], "r": 0.4}, "mult": 1}]


# ---------------- small math ----------------
static func yaw_quat(yaw: float) -> Array:
	return [0.0, FD.fsin(yaw / 2.0), 0.0, FD.fcos(yaw / 2.0)]


static func rot_yaw(v: Array, yaw: float) -> Array:
	var s: float = FD.fsin(yaw)
	var c: float = FD.fcos(yaw)
	return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]


static func forward(yaw: float) -> Array:
	return [FD.fsin(yaw), 0.0, FD.fcos(yaw)]


static func quat_rot(q: Array, v: Array) -> Array:
	var n: float = J.hypn([q[0], q[1], q[2], q[3]])
	if n == 0.0:
		n = 1.0
	var x: float = q[0] / n
	var y: float = q[1] / n
	var z: float = q[2] / n
	var w: float = q[3] / n
	var t: Array = J.vmul(J.vcross([x, y, z], v), 2.0)
	return J.vadd(J.vadd(v, J.vmul(t, w)), J.vcross([x, y, z], t))


static func _xf(T: Dictionary, p: Array) -> Array:
	return J.vadd(T["pos"], quat_rot(T["quat"], p))


static func _clamp(v: float, a: float, b: float) -> float:
	return minf(b, maxf(a, v))


# ---------------- shapes ----------------
static func world_shape(s: Dictionary, T: Dictionary, offset) -> Dictionary:
	var o: Array = [0.0, 0.0, 0.0] if offset == null else offset
	var t: String = s["type"]
	if t == "sphere":
		return {"type": "sphere", "c": _xf(T, o), "r": float(s["r"])}
	if t == "capsule":
		return {"type": "capsule", "a": _xf(T, J.vadd(o, s["a"])), "b": _xf(T, J.vadd(o, s["b"])), "r": float(s["r"])}
	if t == "box":
		var ob: Dictionary = C.obb_from_quat(_xf(T, o), s["h"], T["quat"])
		ob["type"] = "box"
		return ob
	push_error("unknown shape type " + t)
	return {}


static func shape_bounds(s: Dictionary) -> Dictionary:
	var t: String = s["type"]
	if t == "sphere":
		var c: Array = s["c"]
		var r: float = s["r"]
		return {"min": [c[0] - r, c[1] - r, c[2] - r], "max": [c[0] + r, c[1] + r, c[2] + r]}
	if t == "capsule":
		var a: Array = s["a"]
		var b: Array = s["b"]
		var r2: float = s["r"]
		return {"min": [minf(a[0], b[0]) - r2, minf(a[1], b[1]) - r2, minf(a[2], b[2]) - r2], "max": [maxf(a[0], b[0]) + r2, maxf(a[1], b[1]) + r2, maxf(a[2], b[2]) + r2]}
	var ax: Array = s["axes"]
	var h: Array = s["h"]
	var e: Array = []
	for i in 3:
		e.append(absf(ax[0][i]) * h[0] + absf(ax[1][i]) * h[1] + absf(ax[2][i]) * h[2])
	var bc: Array = s["c"]
	return {"min": [bc[0] - e[0], bc[1] - e[1], bc[2] - e[2]], "max": [bc[0] + e[0], bc[1] + e[1], bc[2] + e[2]]}


static func _capsule_spheres(cp: Dictionary) -> Array:
	var ab: Array = J.vsub(cp["b"], cp["a"])
	var ln: float = J.vlen(ab)
	var n: int = int(maxf(1.0, ceilf(ln / maxf(cp["r"], 1e-3))))
	var out: Array = []
	for i in range(0, n + 1):
		out.append({"c": J.vadd(cp["a"], J.vmul(ab, float(i) / float(n))), "r": cp["r"]})
	return out


static func shape_overlap(A: Dictionary, B: Dictionary) -> float:
	if String(A["type"]) > String(B["type"]):
		var tmp: Dictionary = A
		A = B
		B = tmp
	match String(A["type"]) + "/" + String(B["type"]):
		"sphere/sphere":
			return C.sphere_sphere(A, B)
		"capsule/sphere":
			return C.sphere_capsule(B, A)
		"capsule/capsule":
			return C.capsule_capsule(A, B)
		"box/sphere":
			return C.sphere_obb(B, A)
		"box/box":
			return C.obb_obb(A, B)
		"box/capsule":
			var m: float = 0.0
			for sp in _capsule_spheres(B):
				m = maxf(m, C.sphere_obb(sp, A))
			return m
	return 0.0


# ---------------- definitions ----------------
static func move_total(m: Dictionary) -> int:
	return int(m["startup"]) + int(m["active"]) + int(m["recovery"])


static func in_win(w, f) -> bool:
	return w != null and f >= w["from"] and f <= w["to"]


static func _active_from(m: Dictionary) -> int:
	return int(m["startup"]) + 1


static func _active_to(m: Dictionary) -> int:
	return int(m["startup"]) + int(m["active"])


# ---------------- fighters / world ----------------
static func create_fighter(def: Dictionary, o: Dictionary = {}) -> Dictionary:
	var d: Dictionary = def.duplicate(true)
	var team = o["team"] if o.get("team") != null else (d["team"] if d.get("team") != null else d["id"])
	var pos: Array = J.vec(o["pos"]) if o.get("pos") != null else [0.0, 0.0, 0.0]
	return {
		"id": o["id"] if o.get("id") != null else d["id"], "team": team,
		"pos": pos, "yaw": float(o["yaw"]) if o.get("yaw") != null else 0.0, "kb": [0.0, 0.0, 0.0], "frozen": false,
		"hp": J.num(d, "maxHp", 100), "maxHp": J.num(d, "maxHp", 100), "poise": J.num(d, "maxPoise", 50), "maxPoise": J.num(d, "maxPoise", 50), "poiseRegen": 0,
		"def": d, "state": "idle", "stun": 0, "hitstop": 0, "move": null,
		"blockFrames": 0, "buffer": [], "status": [], "combo": 0, "tempo": 0.0,
		"dealt": 0, "taken": 0, "hits": 0, "wantBlock": false,
	}


static func create_world(o: Dictionary = {}) -> Dictionary:
	var statuses: Dictionary = default_statuses()
	var passed = o.get("statuses")
	if passed != null:
		for k in passed.keys():
			statuses[k] = passed[k].duplicate(true)
	var world: Dictionary = {
		"frame": 0, "rng": int(J.num(o, "seed", 1)) & 0xFFFFFFFF, "groundY": o.get("groundY"), "friendlyFire": J.num(o, "friendlyFire", false), "hostility": o.get("hostility"),
		"maxEvents": int(J.num(o, "maxEvents", 20000)), "kbDecay": J.num(o, "kbDecay", 0.85), "statuses": statuses,
		"fighters": [], "projectiles": [], "events": [], "eventsDropped": 0, "nextProj": 1,
	}
	for f in o.get("fighters", []):
		world["fighters"].append(f if f.has("def") else create_fighter(f))
	return world


static func fighter_of(world: Dictionary, id) -> Variant:
	for f in world["fighters"]:
		if f["id"] == id:
			return f
	return null


static func _hostile(world: Dictionary, a: Dictionary, b: Dictionary) -> bool:
	if a["id"] == b["id"]:
		return false
	var h = world["hostility"]
	if h != null:
		var lst = h.get(a["team"])
		return lst != null and lst.has(b["team"])
	return a["team"] != b["team"]


static func _emit(world: Dictionary, type: String, data: Dictionary) -> void:
	var e: Dictionary = {"f": world["frame"], "type": type}
	for k in data.keys():
		e[k] = data[k]
	world["events"].append(e)
	if world["events"].size() > world["maxEvents"]:
		world["events"].pop_front()
		world["eventsDropped"] += 1


static func speed_mult(world: Dictionary, f: Dictionary) -> float:
	var m: float = 1.0
	for s in f["status"]:
		var sd = world["statuses"].get(s["type"])
		m = m * float(J.num(sd, "speedMult", 1))
	return m


# ---------------- transforms ----------------
static func _root_t(f: Dictionary, poses) -> Dictionary:
	var p = poses.get(f["id"]) if poses != null else null
	var pos = p.get("pos") if p != null else null
	var yaw = p.get("yaw") if p != null else null
	return {"pos": pos if pos != null else f["pos"], "quat": yaw_quat(float(yaw) if yaw != null else f["yaw"])}


static func _bone_t(f: Dictionary, bone, poses) -> Dictionary:
	if bone == null or bone == "":
		return _root_t(f, poses)
	var p = poses.get(f["id"]) if poses != null else null
	var bones = p.get("bones") if p != null else null
	var b = bones.get(bone) if bones != null else null
	if b == null:
		return _root_t(f, poses)
	var q = b.get("quat")
	return {"pos": b["pos"], "quat": q if q != null else [0.0, 0.0, 0.0, 1.0]}


static func hitbox_offset(hb: Dictionary, frame: float) -> Array:
	var k = hb.get("keys")
	if k == null or k.is_empty():
		var off = hb.get("offset")
		return [0.0, 0.0, 0.0] if off == null else off
	if frame <= k[0]["frame"]:
		return k[0]["offset"]
	for i in range(1, k.size()):
		if frame <= k[i]["frame"]:
			var dn: float = float(k[i]["frame"]) - float(k[i - 1]["frame"])
			var t: float = (frame - float(k[i - 1]["frame"])) / (dn if dn != 0.0 else 1.0)
			return J.vadd(J.vmul(k[i - 1]["offset"], 1.0 - t), J.vmul(k[i]["offset"], t))
	return k[k.size() - 1]["offset"]


static func hurtboxes_world(f: Dictionary, poses) -> Array:
	var hs = f["def"].get("hurtboxes")
	var list: Array = hs if (hs != null and not hs.is_empty()) else default_hurt()
	var out: Array = []
	for i in list.size():
		var h: Dictionary = list[i]
		out.append({"i": i, "id": h.get("id"), "mult": J.num(h, "mult", 1), "weak": bool(h.get("weak", false)), "shape": world_shape(h["shape"], _bone_t(f, h.get("bone"), poses), h.get("offset"))})
	return out


# ---------------- moves ----------------
static func _start_move(world: Dictionary, f: Dictionary, move_id, via: String) -> bool:
	var m = f["def"]["moves"].get(move_id)
	if m == null:
		return false
	f["move"] = {"id": move_id, "frame": 0, "hit": {}, "connected": null, "spawned": {}}
	f["state"] = "move"
	f["stun"] = 0
	f["tempo"] = 0.0
	f["blockFrames"] = 0
	_emit(world, "move", {"who": f["id"], "move": move_id, "via": via})
	return true


static func _buffered(f: Dictionary, action) -> bool:
	var buf: Array = f["buffer"]
	for i in buf.size():
		if buf[i]["action"] == action:
			buf.remove_at(i)
			return true
	return false


static func _has_buf(f: Dictionary, action) -> bool:
	for b in f["buffer"]:
		if b["action"] == action:
			return true
	return false


static func apply_damage(f: Dictionary, amount: float, type: String) -> float:
	var res: float = _clamp(float(J.num(f["def"].get("resist"), type, 0)), -10.0, 1.0)
	var dmg: float = J.r6(maxf(0.0, amount * (1.0 - res)))
	f["hp"] = J.r6(f["hp"] - dmg)
	f["taken"] = J.r6(f["taken"] + dmg)
	return dmg


static func _die(world: Dictionary, f: Dictionary, by) -> void:
	f["hp"] = maxf(0.0, f["hp"])
	f["state"] = "dead"
	f["move"] = null
	f["stun"] = 0
	f["status"] = []
	f["kb"] = [0.0, 0.0, 0.0]
	_emit(world, "death", {"who": f["id"], "by": by})


static func apply_status(world: Dictionary, f: Dictionary, id, opts: Dictionary = {}) -> bool:
	var sd = world["statuses"].get(id)
	if sd == null or f["state"] == "dead":
		return false
	var dur = opts["duration"] if opts.get("duration") != null else J.num(sd, "duration", 60)
	var cur = null
	for s in f["status"]:
		if s["type"] == id:
			cur = s
			break
	if cur != null:
		if sd.get("stackMode") == "ignore":
			return false
		cur["left"] = maxf(cur["left"], dur)
		if sd.get("stackMode") == "stack" and cur["stacks"] < J.num(sd, "maxStacks", 1):
			cur["stacks"] += 1
	else:
		f["status"].append({"type": id, "left": dur, "stacks": 1, "age": 0, "src": opts.get("src")})
	var shown = cur if cur != null else f["status"][f["status"].size() - 1]
	_emit(world, "status", {"who": f["id"], "status": id, "op": "refresh" if cur != null else "apply", "stacks": shown["stacks"]})
	return true


static func _tick_status(world: Dictionary, f: Dictionary) -> void:
	for s in f["status"].duplicate():
		var sd = world["statuses"].get(s["type"])
		s["age"] += 1
		s["left"] -= 1
		var te = sd.get("tickEvery") if sd != null else null
		if te != null and te != 0 and int(s["age"]) % int(te) == 0 and f["state"] != "dead":
			var dmg: float = apply_damage(f, float(J.num(sd, "damage", 0)) * s["stacks"], String(J.num(sd, "damageType", "physical")))
			_emit(world, "dot", {"who": f["id"], "status": s["type"], "damage": dmg, "hp": f["hp"]})
			if f["hp"] <= 0:
				_die(world, f, s["src"])
				return
		if s["left"] <= 0:
			_remove_status(f, s["type"])
			_emit(world, "status", {"who": f["id"], "status": s["type"], "op": "expire"})


static func _remove_status(f: Dictionary, type) -> void:
	var lst: Array = f["status"]
	for i in lst.size():
		if lst[i]["type"] == type:
			lst.remove_at(i)
			return


static func _extinguish(world: Dictionary, f: Dictionary, type) -> void:
	for s in f["status"].duplicate():
		var sd = world["statuses"].get(s["type"])
		var eb = sd.get("extinguishedBy") if sd != null else null
		if eb != null and eb.has(type):
			_remove_status(f, s["type"])
			_emit(world, "status", {"who": f["id"], "status": s["type"], "op": "extinguish"})


# ---------------- hit pipeline ----------------
static func _stagger(world: Dictionary, v: Dictionary, base: Dictionary, guard_break: bool) -> void:
	v["move"] = null
	v["state"] = "stagger"
	v["stun"] = J.num(v["def"], "staggerFrames", 60)
	v["poise"] = v["maxPoise"]
	v["combo"] += 1
	var d: Dictionary = base.duplicate()
	d["guardBreak"] = guard_break
	d["frames"] = v["stun"]
	_emit(world, "stagger", d)


static func resolve_hit(world: Dictionary, attacker, victim: Dictionary, part: Dictionary, h: Dictionary) -> void:
	if victim["state"] == "dead":
		return
	var cr = attacker
	if cr == null and h.get("owner") != null:
		cr = fighter_of(world, h["owner"])
	var base: Dictionary = {"who": attacker["id"] if attacker != null else h.get("owner"), "victim": victim["id"], "move": h.get("moveId"), "part": part.get("id")}
	if victim["move"] != null and in_win(victim["def"]["moves"][victim["move"]["id"]].get("iframes"), victim["move"]["frame"]):
		_emit(world, "evade", base)
		return
	var bdef = victim["def"].get("block")
	var src: Array = h["srcPos"]
	var toSrc: Array = J.vnorm(J.vsub([src[0], 0.0, src[2]], [victim["pos"][0], 0.0, victim["pos"][2]]))
	var facing: bool = J.vlen(toSrc) < 1e-9
	if not facing:
		var arc: float = float(J.num(bdef, "arc", 180))
		facing = J.vdot(forward(victim["yaw"]), toSrc) >= FD.fcos((arc * PI / 180.0) / 2.0) - 1e-12
	var blocking: bool = victim["state"] == "block" and bdef != null and facing and not h["unblockable"]
	var kb: Array = h["knockback"] if h.get("knockback") != null else [0.0, 0.0, 0.0]
	if blocking:
		if victim["blockFrames"] <= J.num(bdef, "parryWindow", 0):
			if attacker != null and attacker["state"] != "dead":
				attacker["move"] = null
				attacker["state"] = "stagger"
				attacker["stun"] = J.num(bdef, "parryStun", 45)
				attacker["hitstop"] = h["hitstop"]
				attacker["kb"] = [0.0, 0.0, 0.0]
			victim["hitstop"] = h["hitstop"]
			_emit(world, "parry", base)
			return
		var dmg: float = apply_damage(victim, h["damage"] * float(J.num(bdef, "chip", 0.1)) * part["mult"] * float(J.num(victim["def"], "chipMult", 1)), h["damageType"])
		victim["poise"] = J.r6(victim["poise"] - h["poiseDamage"] * float(J.num(bdef, "poiseMult", 0.5)))
		victim["poiseRegen"] = 0
		victim["hitstop"] = h["hitstop"]
		if attacker != null:
			attacker["hitstop"] = h["hitstop"]
		victim["kb"] = J.vmul(kb, float(J.num(bdef, "kbMult", 0.5)))
		victim["stun"] = h["blockstun"]
		if cr != null:
			cr["dealt"] = J.r6(cr["dealt"] + dmg)
		if attacker != null and attacker["move"] != null:
			attacker["move"]["connected"] = "block"
		var d1: Dictionary = base.duplicate()
		d1["damage"] = dmg
		d1["hp"] = victim["hp"]
		_emit(world, "block", d1)
		if victim["hp"] <= 0:
			_die(world, victim, base["who"])
			return
		if victim["poise"] <= 0 or h["guardBreak"]:
			_stagger(world, victim, base, true)
		return
	# clean hit
	var scale: float = 1.0
	if victim["combo"] > 0:
		var cs = victim["def"].get("comboScaling")
		if cs != null:
			var idx: int = mini(int(victim["combo"]), cs.size()) - 1
			scale = float(cs[idx]) if (idx >= 0 and idx < cs.size()) else 1.0
	var dmg2: float = apply_damage(victim, h["damage"] * part["mult"] * scale, h["damageType"])
	if cr != null:
		cr["dealt"] = J.r6(cr["dealt"] + dmg2)
		cr["hits"] += 1
	if attacker != null and attacker["move"] != null:
		attacker["move"]["connected"] = "hit"
	_extinguish(world, victim, h["damageType"])
	victim["poise"] = J.r6(victim["poise"] - h["poiseDamage"] * (1.5 if part["weak"] else 1.0))
	victim["poiseRegen"] = 0
	var am = null
	if victim["move"] != null:
		am = victim["def"]["moves"][victim["move"]["id"]].get("armor")
	var armored: bool = am != null and in_win(am, victim["move"]["frame"]) and h["poiseDamage"] <= J.num(am, "threshold", INF) and not h["guardBreak"]
	var d2: Dictionary = base.duplicate()
	d2["damage"] = dmg2
	d2["damageType"] = h["damageType"]
	d2["weak"] = part["weak"]
	d2["armored"] = armored
	d2["hp"] = victim["hp"]
	d2["combo"] = victim["combo"] + 1
	_emit(world, "hit", d2)
	victim["hitstop"] = h["hitstop"]
	if attacker != null:
		attacker["hitstop"] = h["hitstop"]
	if victim["hp"] <= 0:
		_die(world, victim, base["who"])
		return
	for st in h["status"]:
		var ch = J.num(st, "chance", 1)
		if ch >= 1 or J.rng_next(world) < ch:
			apply_status(world, victim, st["id"], {"duration": st.get("duration"), "src": base["who"]})
	if victim["hp"] <= 0:
		return
	if victim["poise"] <= 0 and not armored:
		_stagger(world, victim, base, false)
		victim["kb"] = J.vmul(kb, 1.0)
		return
	if not armored:
		victim["move"] = null
		victim["state"] = "hitstun"
		victim["stun"] = h["hitstun"]
		victim["kb"] = kb.duplicate()
		victim["combo"] += 1
		victim["blockFrames"] = 0


# ---------------- per-frame step ----------------
static func step(world: Dictionary, inputs: Dictionary = {}, poses = null) -> Array:
	world["frame"] += 1
	var before: int = world["events"].size() + world["eventsDropped"]
	for f in world["fighters"]:
		var inp = inputs.get(f["id"])
		if inp == null:
			inp = {}
		var bf: float = float(J.num(f["def"], "bufferFrames", 6))
		if inp.get("action") != null and inp.get("action") != "":
			f["buffer"].append({"action": inp["action"], "t": world["frame"]})
		var nb: Array = []
		for b in f["buffer"]:
			if world["frame"] - b["t"] <= bf:
				nb.append(b)
		f["buffer"] = nb
		f["wantBlock"] = bool(inp.get("block", false))
	for f in world["fighters"]:
		if f["state"] != "dead":
			_tick_status(world, f)
	for f in world["fighters"]:
		if f["state"] == "dead":
			continue
		f["frozen"] = false
		if f["hitstop"] > 0:
			f["hitstop"] -= 1
			f["frozen"] = true
			continue
		if J.vlen(f["kb"]) > 1e-4:
			f["pos"] = J.vadd(f["pos"], J.vmul(f["kb"], DT))
			f["kb"] = J.vmul(f["kb"], float(world["kbDecay"]))
			if world["groundY"] != null:
				f["pos"][1] = maxf(world["groundY"], f["pos"][1])
		else:
			f["kb"] = [0.0, 0.0, 0.0]
		if f["state"] == "hitstun" or f["state"] == "stagger":
			f["stun"] -= 1
			if f["stun"] <= 0:
				f["state"] = "idle"
				f["combo"] = 0
		elif f["state"] == "move":
			_advance_move(world, f)
		elif f["state"] == "block":
			f["blockFrames"] += 1
			if f["stun"] > 0:
				f["stun"] -= 1
		if f["state"] == "idle" or f["state"] == "block":
			if f["state"] == "idle" or f["stun"] == 0:
				var act = _first_startable(f)
				if act != null:
					_buffered(f, act["action"])
					_start_move(world, f, act["move"], "input")
					_advance_move_frame(world, f)
				elif f["wantBlock"] and f["def"].get("block") != null:
					if f["state"] != "block":
						f["state"] = "block"
						f["blockFrames"] = 1
				elif f["state"] == "block":
					f["state"] = "idle"
					f["blockFrames"] = 0
		if f["state"] != "hitstun" and f["state"] != "stagger":
			f["poiseRegen"] += 1
		if f["poiseRegen"] > J.num(f["def"], "poiseRegenDelay", 120) and f["poise"] < f["maxPoise"]:
			f["poise"] = minf(f["maxPoise"], f["poise"] + float(J.num(f["def"], "poiseRegenRate", 0.25)))
	var attacks: Array = []
	for f in world["fighters"]:
		if f["state"] == "move" and not f["frozen"]:
			_collect_move(world, f, poses, attacks)
	for a in attacks:
		resolve_hit(world, a["attacker"], a["victim"], a["part"], a["h"])
	_step_projectiles(world, poses)
	for f in world["fighters"]:
		f["wantBlock"] = false
	var n: int = world["events"].size() + world["eventsDropped"] - before
	if n <= 0:
		return []
	var evs: Array = world["events"]
	return evs.slice(maxi(0, evs.size() - n))


static func _first_startable(f: Dictionary) -> Variant:
	var acts = f["def"].get("actions")
	if acts == null:
		return null
	for b in f["buffer"]:
		var mid = acts.get(b["action"])
		if mid != null and f["def"]["moves"].get(mid) != null:
			return {"action": b["action"], "move": mid}
	return null


static func _advance_move(world: Dictionary, f: Dictionary) -> void:
	f["tempo"] += speed_mult(world, f)
	if f["tempo"] < 1.0 - 1e-9:
		return
	f["tempo"] -= 1.0
	_advance_move_frame(world, f)


static func _advance_move_frame(world: Dictionary, f: Dictionary) -> void:
	var mv: Dictionary = f["move"]
	var m: Dictionary = f["def"]["moves"][mv["id"]]
	mv["frame"] += 1
	if mv["frame"] > move_total(m):
		_emit(world, "move-end", {"who": f["id"], "move": mv["id"]})
		f["move"] = null
		f["state"] = "idle"
		return
	for mo in m.get("motion", []):
		if in_win(mo, mv["frame"]):
			f["pos"] = J.vadd(f["pos"], J.vmul(rot_yaw(mo["vel"], f["yaw"]), DT * speed_mult(world, f)))
	if world["groundY"] != null:
		f["pos"][1] = maxf(world["groundY"], f["pos"][1])
	for s in m.get("spawns", []):
		if s["frame"] == mv["frame"]:
			spawn_projectile(world, f, s["projectile"], s.get("offset"))
	for c in m.get("cancels", []):
		if not in_win(c, mv["frame"]) or not _has_buf(f, c["action"]):
			continue
		var on = c.get("on")
		var conn = mv["connected"]
		var ok_: bool = on == "any" or (on if on != null else "hit") == conn or (on == "contact" and conn != null) or (on == "whiff" and conn == null)
		if not ok_ or f["def"]["moves"].get(c["into"]) == null:
			continue
		_buffered(f, c["action"])
		_emit(world, "cancel", {"who": f["id"], "from": mv["id"], "into": c["into"]})
		_start_move(world, f, c["into"], "cancel")
		_advance_move_frame(world, f)
		return


static func _collect_move(world: Dictionary, f: Dictionary, poses, out: Array) -> void:
	var mv: Dictionary = f["move"]
	var m: Dictionary = f["def"]["moves"][mv["id"]]
	var fr: int = mv["frame"]
	var af: int = _active_from(m)
	var at_: int = _active_to(m)
	if fr < af or fr > at_:
		return
	var T: Dictionary = _root_t(f, poses)
	var yaw_pose = null
	if poses != null and poses.get(f["id"]) != null:
		yaw_pose = poses[f["id"]].get("yaw")
	var kbv = m.get("knockback")
	var h: Dictionary = {
		"owner": f["id"], "moveId": mv["id"], "damage": J.num(m, "damage", 0), "damageType": J.num(m, "damageType", "physical"), "hitstun": J.num(m, "hitstun", 0), "blockstun": J.num(m, "blockstun", 0),
		"knockback": rot_yaw(kbv if kbv != null else [0.0, 0.0, 0.0], float(yaw_pose) if yaw_pose != null else f["yaw"]), "hitstop": J.num(m, "hitstop", 0), "poiseDamage": J.num(m, "poiseDamage", 0),
		"guardBreak": bool(m.get("guardBreak", false)), "unblockable": bool(m.get("unblockable", false)), "status": m.get("onHit", []), "srcPos": T["pos"],
	}
	var hbs: Array = m.get("hitboxes", [])
	for hi in hbs.size():
		var hb: Dictionary = hbs[hi]
		var wf: int = af
		var wt: int = at_
		if hb.get("from") != null:
			wf = int(hb["from"])
			wt = int(hb["to"]) if hb.get("to") != null else int(hb["from"])
		if fr < wf or fr > wt:
			continue
		var hs: Dictionary = world_shape(hb["shape"], _bone_t(f, hb.get("bone"), poses), hitbox_offset(hb, fr))
		var hbounds: Dictionary = shape_bounds(hs)
		for v in world["fighters"]:
			if is_same(v, f) or v["state"] == "dead" or not (_hostile(world, f, v) or (world["friendlyFire"] and v["id"] != f["id"])):
				continue
			var key = v["id"]
			var last = mv["hit"].get(key)
			if last != null:
				var mh = m.get("multihit")
				if not (mh != null and fr - last >= mh["every"]):
					continue
			var best = null
			for hu in hurtboxes_world(v, poses):
				var hb2: Dictionary = shape_bounds(hu["shape"])
				var disjoint: bool = false
				for i in 3:
					if hbounds["min"][i] > hb2["max"][i] or hbounds["max"][i] < hb2["min"][i]:
						disjoint = true
						break
				if disjoint:
					continue
				var dep: float = shape_overlap(hs, hu["shape"])
				if dep > 0.0 and (best == null or dep > best["dep"] + 1e-12):
					best = {"hu": hu, "dep": dep}
			if best != null:
				out.append({"attacker": f, "victim": v, "part": best["hu"], "h": h})
				mv["hit"][key] = fr


# ---------------- projectiles ----------------
static func spawn_projectile(world: Dictionary, owner, spec: Dictionary, offset) -> Dictionary:
	var yaw: float = owner["yaw"] if owner != null else 0.0
	var dl: Array = J.vnorm(spec["dir"] if spec.get("dir") != null else [0.0, 0.0, 1.0])
	var dir: Array = rot_yaw(dl, yaw) if owner != null else dl
	var pos: Array
	if spec.get("pos") != null:
		pos = J.vec(spec["pos"])
	else:
		var off = offset if offset != null else (spec["offset"] if spec.get("offset") != null else [0.0, 1.0, 0.6])
		pos = J.vadd(owner["pos"], rot_yaw(off, yaw))
	var h: Dictionary = spec["hit"] if spec.get("hit") != null else {}
	var kind = spec["kind"] if spec.get("kind") != null else "straight"
	var gdef = spec.get("gravity")
	var gravity = (gdef if gdef != null else 20) if spec.get("kind") == "arc" else (gdef if gdef != null else 0)
	var pid: int = world["nextProj"]
	world["nextProj"] += 1
	var p: Dictionary = {
		"id": pid, "kind": kind, "owner": owner["id"] if owner != null else spec.get("owner"), "team": owner["team"] if owner != null else spec.get("team"),
		"pos": pos, "vel": J.vmul(dir, float(J.num(spec, "speed", 10))), "radius": J.num(spec, "radius", 0.2), "life": J.num(spec, "life", 120), "gravity": gravity,
		"pierce": J.num(spec, "pierce", 0), "turn": J.num(spec, "turn", 0.05), "target": spec.get("target"), "hitSet": [], "age": 0,
		"hit": {"damage": J.num(h, "damage", 0), "damageType": J.num(h, "damageType", "physical"), "hitstun": J.num(h, "hitstun", 0), "blockstun": J.num(h, "blockstun", 0),
			"knockback": h["knockback"] if h.get("knockback") != null else [0.0, 0.0, 0.0], "hitstop": J.num(h, "hitstop", 0), "poiseDamage": J.num(h, "poiseDamage", 0),
			"guardBreak": bool(h.get("guardBreak", false)), "unblockable": bool(h.get("unblockable", false)), "status": h["status"] if h.get("status") != null else []},
	}
	world["projectiles"].append(p)
	_emit(world, "projectile-spawn", {"id": pid, "owner": p["owner"], "kind": kind})
	return p


static func _rotate_toward(cur: Array, want: Array, max_ang: float) -> Array:
	var c: float = _clamp(J.vdot(cur, want), -1.0, 1.0)
	var ang: float = FD.facos(c)
	if ang <= max_ang:
		return want
	var axis: Array = J.vcross(cur, want)
	if J.vlen(axis) < 1e-9:
		axis = [0.0, 1.0, 0.0]
	axis = J.vnorm(axis)
	var co: float = FD.fcos(max_ang)
	var si: float = FD.fsin(max_ang)
	return J.vnorm(J.vadd(J.vadd(J.vmul(cur, co), J.vmul(J.vcross(axis, cur), si)), J.vmul(axis, J.vdot(axis, cur) * (1.0 - co))))


static func _step_projectiles(world: Dictionary, poses) -> void:
	var keep: Array = []
	for p in world["projectiles"]:
		var owner = fighter_of(world, p["owner"])
		var me: Dictionary = owner if owner != null else {"id": p["owner"], "team": p["team"], "state": "alive"}
		if p["kind"] == "homing":
			var tgt = fighter_of(world, p["target"]) if p["target"] != null else null
			if tgt == null or tgt["state"] == "dead":
				tgt = null
				var bd: float = INF
				for f in world["fighters"]:
					if f["state"] != "dead" and _hostile(world, me, f):
						var d: float = J.vlen(J.vsub(f["pos"], p["pos"]))
						if d < bd:
							bd = d
							tgt = f
				p["target"] = tgt["id"] if tgt != null else null
			if tgt != null:
				var sp: float = J.vlen(p["vel"])
				var want: Array = J.vnorm(J.vsub(J.vadd(tgt["pos"], [0.0, 1.0, 0.0]), p["pos"]))
				if sp > 0.0 and J.vlen(want) > 0.0:
					p["vel"] = J.vmul(_rotate_toward(J.vnorm(p["vel"]), want, p["turn"]), sp)
		p["vel"][1] -= p["gravity"] * DT
		var from: Array = p["pos"]
		var to: Array = J.vadd(from, J.vmul(p["vel"], DT))
		var dist: float = J.vlen(J.vsub(to, from))
		var n: int = int(maxf(1.0, ceilf(dist / maxf(p["radius"], 1e-3))))
		var dead: bool = false
		var s: int = 1
		while s <= n and not dead:
			var c: Array = J.vadd(from, J.vmul(J.vsub(to, from), float(s) / float(n)))
			var sh: Dictionary = {"type": "sphere", "c": c, "r": float(p["radius"])}
			for v in world["fighters"]:
				if v["state"] == "dead" or p["hitSet"].has(v["id"]) or v["id"] == p["owner"] or not _hostile(world, me, v):
					continue
				var best = null
				for hu in hurtboxes_world(v, poses):
					var dep: float = shape_overlap(sh, hu["shape"])
					if dep > 0.0 and (best == null or dep > best["dep"] + 1e-12):
						best = {"hu": hu, "dep": dep}
				if best == null:
					continue
				p["hitSet"].append(v["id"])
				var pv: Array = p["vel"]
				var kbp: Array = rot_yaw(p["hit"]["knockback"], FD.fatan2(pv[0], pv[2])) if J.vlen(pv) > 0.0 else p["hit"]["knockback"]
				var hh: Dictionary = p["hit"].duplicate()
				hh["owner"] = p["owner"]
				hh["knockback"] = kbp
				hh["srcPos"] = c
				hh["moveId"] = "projectile#" + str(p["id"])
				resolve_hit(world, null, v, best["hu"], hh)
				var was: float = p["pierce"]
				p["pierce"] -= 1
				if was <= 0:
					dead = true
					break
			s += 1
		p["pos"] = to
		p["age"] += 1
		p["life"] -= 1
		if not dead and p["life"] <= 0:
			dead = true
			_emit(world, "projectile-expire", {"id": p["id"], "why": "life"})
		elif not dead and world["groundY"] != null and p["pos"][1] < world["groundY"]:
			dead = true
			_emit(world, "projectile-expire", {"id": p["id"], "why": "ground"})
		elif dead:
			_emit(world, "projectile-expire", {"id": p["id"], "why": "hit"})
		if not dead:
			keep.append(p)
	world["projectiles"] = keep


# ---------------- hashing ----------------
static func hash_events(events: Array) -> String:
	return J.hash_json(events)


static func hash_world(world: Dictionary) -> String:
	var fs: Array = []
	for f in world["fighters"]:
		var pos: Array = []
		for c in f["pos"]:
			pos.append(J.r6(c))
		var mv = null
		if f["move"] != null:
			mv = {"id": f["move"]["id"], "frame": f["move"]["frame"]}
		fs.append({"id": f["id"], "hp": f["hp"], "pos": pos, "state": f["state"], "move": mv, "poise": f["poise"], "status": f["status"]})
	return J.hash_json({"f": world["frame"], "rng": world["rng"], "fighters": fs, "projectiles": world["projectiles"], "events": world["events"]})


# ---------------- scripted duel ----------------
static func simulate_duel(def_a: Dictionary, def_b: Dictionary, o: Dictionary = {}) -> Dictionary:
	var script: Dictionary = o.get("script", {})
	var frames: int = int(J.num(o, "frames", 600))
	var distance: float = float(J.num(o, "distance", 1.6))
	var seed: int = int(J.num(o, "seed", 1))
	var a: Dictionary = create_fighter(def_a, {"pos": [0.0, 0.0, -distance / 2.0], "yaw": 0.0, "team": def_a["team"] if def_a.get("team") != null else "a"})
	var b: Dictionary = create_fighter(def_b, {"pos": [0.0, 0.0, distance / 2.0], "yaw": PI, "team": def_b["team"] if def_b.get("team") != null else "b"})
	if a["team"] == b["team"]:
		b["team"] = str(b["team"]) + "-2"
	if a["id"] == b["id"]:
		b["id"] = str(b["id"]) + "-2"
	var world: Dictionary = create_world({"fighters": [a, b], "seed": seed, "statuses": o.get("statuses"), "groundY": 0.0, "friendlyFire": o.get("friendlyFire", false), "hostility": o.get("hostility"), "kbDecay": o.get("kbDecay", 0.85)})
	var id_of: Dictionary = {"A": a["id"], "B": b["id"]}
	id_of[a["id"]] = a["id"]
	id_of[b["id"]] = b["id"]
	var poses_by_id = null
	var poses_in = o.get("poses")
	if poses_in != null:
		poses_by_id = {}
		for k in poses_in.keys():
			if id_of.has(k):
				poses_by_id[id_of[k]] = poses_in[k]
	var pose_frames = null
	var pf_in = o.get("poseFrames")
	if pf_in != null:
		pose_frames = []
		for m in pf_in:
			var mm = null
			if m != null:
				mm = {}
				for k in m.keys():
					if id_of.has(k):
						mm[id_of[k]] = m[k]
			pose_frames.append(mm)
	for i in frames:
		var fr: int = world["frame"] + 1
		var inputs: Dictionary = {}
		for who in script.keys():
			if not id_of.has(who):
				continue
			var id = id_of[who]
			for s in script[who]:
				if s.get("at") != null and int(s["at"]) == fr:
					if not inputs.has(id):
						inputs[id] = {}
					inputs[id]["action"] = s.get("action")
				if bool(s.get("block", false)) and fr >= s["from"] and fr <= s["to"]:
					if not inputs.has(id):
						inputs[id] = {}
					inputs[id]["block"] = true
		var step_poses = poses_by_id
		if pose_frames != null:
			step_poses = pose_frames[mini(fr - 1, pose_frames.size() - 1)] if pose_frames.size() > 0 else null
		step(world, inputs, step_poses)
		var any_dead: bool = false
		for f in world["fighters"]:
			if f["state"] == "dead":
				any_dead = true
		if any_dead:
			break
	var counts: Dictionary = {"hit": 0, "block": 0, "parry": 0, "stagger": 0, "death": 0, "evade": 0}
	for e in world["events"]:
		if counts.has(e["type"]):
			counts[e["type"]] += 1
	var totals: Dictionary = {}
	var alive: Array = []
	for f in world["fighters"]:
		totals[f["id"]] = {"dealt": f["dealt"], "taken": f["taken"], "hp": f["hp"], "state": f["state"], "hits": f["hits"]}
		if f["state"] != "dead":
			alive.append(f)
	return {"world": world, "frames": world["frame"], "totals": totals, "winner": alive[0]["id"] if alive.size() == 1 else null, "counts": counts, "hash": hash_events(world["events"])}

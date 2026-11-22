extends RefCounted
## ai3d core: behaviour tree + perception + steering + groups/tokens + scripted simulation.
## Port of templates/web-project/src/lib/ai3d.js (normative: spec/v4/ai3d.md). Deterministic: float64 math only (Arrays, not
## Vector3, which is float32), per-agent uint32 mulberry32 rng, fixed step. Positions are [x, y, z] Arrays, ids are Strings.
## Usage: var A = load("res://scripts/ai3d/ai3d_core.gd"); var res = A.simulate(scenario_dict); res.hash == JS hash.

const NAV := preload("res://scripts/ai3d/ai3d_nav.gd")
const DT: float = 1.0 / 60.0
const EPS: float = 1e-9
const S := "success"
const F := "failure"
const R := "running"


# ---------- numbers / rng ----------
static func rnd(v: float, k: float = 1e4) -> float:
	return floor(v * k + 0.5) / k


static func d2(a: Array, b: Array) -> float:
	var x: float = a[0] - b[0]
	var z: float = a[2] - b[2]
	return sqrt(x * x + z * z)


static func dir2(a: Array, b: Array) -> Array:
	var x: float = b[0] - a[0]
	var z: float = b[2] - a[2]
	var l: float = sqrt(x * x + z * z)
	if l < EPS:
		return [0.0, 0.0, 0.0]
	return [x / l, 0.0, z / l]


static func unit2(v: Array) -> Array:
	var l: float = sqrt(v[0] * v[0] + v[2] * v[2])
	if l < EPS:
		return [0.0, 0.0, 0.0]
	return [v[0] / l, 0.0, v[2] / l]


static func _imul(a: int, b: int) -> int:
	return (a * b) & 0xFFFFFFFF


## mulberry32 on obj["rng"] (uint32); returns [0,1).
static func rng_next(o: Dictionary) -> float:
	o["rng"] = (int(o["rng"]) + 0x6D2B79F5) & 0xFFFFFFFF
	var t: int = o["rng"]
	t = _imul(t ^ (t >> 15), t | 1)
	t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
	return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


static func fnv_mix(h: int, s: String) -> int:
	for b: int in s.to_utf8_buffer():
		h = ((h ^ b) * 16777619) & 0xFFFFFFFF
	return h


static func hash_str(s: String) -> String:
	return "%08x" % fnv_mix(2166136261, s)


## JS-style printing of rnd(v) (v rounded to 4 decimals): shortest decimal, "-0" prints "0".
static func num4(v: float) -> String:
	var n: int = int(floor(v * 1e4 + 0.5))
	var neg: bool = n < 0
	var a: int = absi(n)
	var ip: int = a / 10000
	var fp: int = a % 10000
	var s: String = str(ip)
	if fp != 0:
		var f: String = "%04d" % fp
		while f.ends_with("0"):
			f = f.substr(0, f.length() - 1)
		s += "." + f
	return ("-" + s) if (neg and n != 0) else s


# ---------- steering ----------
static func seek(pos: Array, target: Array) -> Dictionary:
	return {"dir": dir2(pos, target), "speed": 1.0}


static func arrive(pos: Array, target: Array, slow: float = 2.0, stop: float = 0.2) -> Dictionary:
	var d: float = d2(pos, target)
	if d <= stop:
		return {"dir": [0.0, 0.0, 0.0], "speed": 0.0}
	return {"dir": dir2(pos, target), "speed": ((d - stop) / (slow - stop)) if (slow > stop and d < slow) else 1.0}


static func flee(pos: Array, threat: Array) -> Dictionary:
	var d: Array = dir2(pos, threat)
	return {"dir": [0.0 - d[0], 0.0, 0.0 - d[2]], "speed": 1.0}


static func separation(pos: Array, others: Array, radius: float = 1.2) -> Dictionary:
	var x: float = 0.0
	var z: float = 0.0
	for o: Array in others:
		var d: float = d2(pos, o)
		if d >= radius:
			continue
		var away: Array = [1.0, 0.0, 0.0] if d < EPS else dir2(o, pos)
		var w: float = 1.0 - d / radius
		x += away[0] * w
		z += away[2] * w
	var l: float = sqrt(x * x + z * z)
	if l < EPS:
		return {"dir": [0.0, 0.0, 0.0], "speed": 0.0}
	return {"dir": [x / l, 0.0, z / l], "speed": minf(1.0, l)}


static func orbit(pos: Array, target: Array, radius: float, sign_: float = 1.0) -> Dictionary:
	var d: float = d2(pos, target)
	var r: Array = [1.0, 0.0, 0.0] if d < EPS else dir2(target, pos)
	var tan_: Array = [r[2] * sign_, 0.0, -r[0] * sign_]
	var k: float = clampf((radius - d) / maxf(radius, EPS), -1.0, 1.0)
	var v: Array = [tan_[0] + r[0] * k * 2.0, 0.0, tan_[2] + r[2] * k * 2.0]
	return {"dir": unit2(v), "speed": 1.0}


static func keep_distance(pos: Array, target: Array, mn: float, mx: float) -> Dictionary:
	var d: float = d2(pos, target)
	if d < mn:
		var f: Dictionary = flee(pos, target)
		f["speed"] = clampf((mn - d) / maxf(mn * 0.5, EPS), 0.3, 1.0)
		return f
	if d > mx:
		return {"dir": dir2(pos, target), "speed": clampf((d - mx) / maxf(mx * 0.5, EPS), 0.3, 1.0)}
	return {"dir": [0.0, 0.0, 0.0], "speed": 0.0}


static func combine(parts: Array, cap: float = 1.0) -> Dictionary:
	var x: float = 0.0
	var z: float = 0.0
	var top: float = 0.0
	for p: Dictionary in parts:
		var w: float = float(p.get("weight", 1.0)) * float(p["speed"])
		x += p["dir"][0] * w
		z += p["dir"][2] * w
		if p["speed"] > top:
			top = p["speed"]
	var l: float = sqrt(x * x + z * z)
	if l < EPS:
		return {"dir": [0.0, 0.0, 0.0], "speed": 0.0}
	return {"dir": [x / l, 0.0, z / l], "speed": minf(l, maxf(cap, top))}


# ---------- line of sight ----------
## world.los (Callable(from,to)->bool) wins; else world.walls boxes ({min,max}) raycast; else clear.
static func line_of_sight(world: Dictionary, from: Array, to: Array) -> bool:
	if world.has("los"):
		return bool((world["los"] as Callable).call(from, to))
	if not world.has("bvh"):
		return true
	var dx: float = to[0] - from[0]
	var dy: float = to[1] - from[1]
	var dz: float = to[2] - from[2]
	var l: float = sqrt(dx * dx + dy * dy + dz * dz)
	if l < EPS:
		return true
	var d: Array = [dx / l, dy / l, dz / l]
	var tmax: float = l - 1e-4
	for b: Dictionary in world["bvh"]:
		if _ray_box(from, d, tmax, b):
			return false
	return true


static func _ray_box(o: Array, d: Array, tmax: float, b: Dictionary) -> bool:
	var tn: float = 0.0
	var tf: float = tmax
	for i in 3:
		if d[i] == 0.0:
			if o[i] < b["min"][i] or o[i] > b["max"][i]:
				return false
			continue
		var t1: float = (b["min"][i] - o[i]) / d[i]
		var t2: float = (b["max"][i] - o[i]) / d[i]
		if t1 > t2:
			var s: float = t1
			t1 = t2
			t2 = s
		if t1 > tn:
			tn = t1
		if t2 < tf:
			tf = t2
	return tn <= tf


# ---------- config / agents ----------
const DEF_STATS := {"moveSpeed": 3.5, "turnRate": 8.0, "radius": 0.4, "eyeHeight": 1.6}
const DEF_PERC := {"sightRange": 15.0, "fovDeg": 110.0, "awareness": 1.5, "hearRadius": 8.0, "memorySec": 6.0, "targetEyeHeight": 1.4}
const DEF_THREAT := {"sightGain": 1.0, "hearGain": 0.5, "damageGain": 1.0, "decay": 0.1, "switchRatio": 1.25}
const DEF_SEP := {"radius": 1.2, "weight": 0.8}


static func _merge(def: Dictionary, over: Variant) -> Dictionary:
	var o: Dictionary = def.duplicate(true)
	if over is Dictionary:
		for k in over:
			o[k] = over[k]
	return o


static func normalize_config(c: Dictionary) -> Dictionary:
	var out: Dictionary = c.duplicate(false)
	out["role"] = c.get("role", "melee")
	out["stats"] = _merge(DEF_STATS, c.get("stats"))
	out["perception"] = _merge(DEF_PERC, c.get("perception"))
	out["threat"] = _merge(DEF_THREAT, c.get("threat"))
	var st: Dictionary = {}
	if c.get("steering") is Dictionary:
		st = (c["steering"] as Dictionary).duplicate(false)
	st["separation"] = _merge(DEF_SEP, st.get("separation"))
	out["steering"] = st
	out["moves"] = c.get("moves", {})
	return out


static func create_agent(o: Dictionary) -> Dictionary:
	var pos: Array = (o["pos"] as Array).duplicate()
	var seed_v: int = int(o.get("seed", 1)) & 0xFFFFFFFF
	var hp: float = float(o.get("hp", 100.0))
	return {
		"id": o["id"], "config": o["config"], "role": o.get("role"), "pos": pos,
		"facing": unit2(o.get("facing", [0.0, 0.0, 1.0])), "hp": hp, "maxHp": float(o.get("maxHp", hp)),
		"spawn": pos.duplicate(), "rng": seed_v if seed_v != 0 else 1, "time": 0.0,
		"perc": {"known": {}, "heardPos": null, "heardT": -1e9}, "threat": {}, "target": null,
		"cd": {}, "mem": {}, "slot": null, "state": "idle",
	}


# ---------- perception & threat ----------
static func _new_known(pos: Array) -> Dictionary:
	return {"pos": pos.duplicate(), "t": -1e9, "seen": false, "how": null}


static func perceive(a: Dictionary, cfg: Dictionary, world: Dictionary, dt: float) -> void:
	var P: Dictionary = cfg["perception"]
	var T: Dictionary = cfg["threat"]
	var now: float = a["time"]
	var apos: Array = a["pos"]
	var eye: Array = [apos[0], apos[1] + float(cfg["stats"]["eyeHeight"]), apos[2]]
	var cos_h: float = cos(float(P["fovDeg"]) * PI / 360.0)
	var targets: Array = (world.get("targets", []) as Array).duplicate()
	targets.sort_custom(func(p: Dictionary, q: Dictionary) -> bool: return p["id"] < q["id"])
	var known: Dictionary = a["perc"]["known"]
	var threat: Dictionary = a["threat"]
	for t: Dictionary in targets:
		var d: float = d2(apos, t["pos"])
		if not known.has(t["id"]):
			known[t["id"]] = _new_known(t["pos"])
		var kn: Dictionary = known[t["id"]]
		var seen: bool = false
		if d <= float(P["sightRange"]):
			var dr: Array = dir2(apos, t["pos"])
			var dot: float = a["facing"][0] * dr[0] + a["facing"][2] * dr[2]
			if (d <= float(P["awareness"]) or dot >= cos_h) and line_of_sight(world, eye, [t["pos"][0], t["pos"][1] + float(P["targetEyeHeight"]), t["pos"][2]]):
				seen = true
		var heard: bool = (not seen) and d <= float(P["hearRadius"]) * float(t.get("noise", 0.0))
		kn["seen"] = seen
		if seen or heard:
			kn["pos"] = (t["pos"] as Array).duplicate()
			kn["t"] = now
			kn["how"] = "sight" if seen else "sound"
			if heard:
				a["perc"]["heardPos"] = (t["pos"] as Array).duplicate()
				a["perc"]["heardT"] = now
		if seen:
			threat[t["id"]] = float(threat.get(t["id"], 0.0)) + float(T["sightGain"]) * dt * (1.0 - 0.5 * (d / float(P["sightRange"])))
		elif heard:
			threat[t["id"]] = float(threat.get(t["id"], 0.0)) + float(T["hearGain"]) * dt
	for s: Dictionary in world.get("sounds", []):
		var d: float = d2(apos, s["pos"])
		if d > float(P["hearRadius"]) * float(s.get("loudness", 1.0)):
			continue
		a["perc"]["heardPos"] = (s["pos"] as Array).duplicate()
		a["perc"]["heardT"] = now
		if s.has("source"):
			if not known.has(s["source"]):
				known[s["source"]] = _new_known(s["pos"])
			var kn: Dictionary = known[s["source"]]
			if not kn["seen"]:
				kn["pos"] = (s["pos"] as Array).duplicate()
				kn["t"] = now
				kn["how"] = "sound"
			threat[s["source"]] = float(threat.get(s["source"], 0.0)) + float(T["hearGain"]) * float(s.get("loudness", 1.0)) * 0.5
	for e: Dictionary in world.get("events", []):
		if e.get("type") == "damage" and e.get("target") == a["id"]:
			add_threat(a, cfg, e["source"], float(e["amount"]) * float(T["damageGain"]), world)
	for id: String in known.keys():
		if now - float(known[id]["t"]) > float(P["memorySec"]) and not known[id]["seen"]:
			known.erase(id)
	var ids: Array = threat.keys()
	ids.sort()
	for id: String in ids:
		threat[id] = maxf(0.0, float(threat[id]) * (1.0 - float(T["decay"]) * dt))
		if threat[id] < 1e-6 or not known.has(id):
			if not known.has(id):
				threat.erase(id)
	var best: Variant = null
	var bv: float = 0.0
	var ids2: Array = threat.keys()
	ids2.sort()
	for id: String in ids2:
		if known.has(id) and threat[id] > bv:
			bv = threat[id]
			best = id
	if a["target"] != null and known.has(a["target"]) and best != a["target"] and float(threat.get(a["target"], 0.0)) * float(T["switchRatio"]) >= bv:
		best = a["target"]
	a["target"] = best


static func add_threat(a: Dictionary, _cfg: Dictionary, id: String, amount: float, world: Dictionary) -> void:
	a["threat"][id] = float(a["threat"].get(id, 0.0)) + amount
	var tw: Variant = null
	for t: Dictionary in world.get("targets", []):
		if t["id"] == id:
			tw = t
			break
	var known: Dictionary = a["perc"]["known"]
	if not known.has(id) and tw != null:
		known[id] = {"pos": (tw["pos"] as Array).duplicate(), "t": a["time"], "seen": false, "how": "damage"}
	elif known.has(id) and not known[id]["seen"]:
		known[id]["t"] = a["time"]
		if tw != null:
			known[id]["pos"] = (tw["pos"] as Array).duplicate()
		known[id]["how"] = "damage"


# ---------- groups: attack tokens + surround slots ----------
static func create_group(o: Dictionary = {}) -> Dictionary:
	return {"id": o.get("id", "group"), "maxAttackers": int(o.get("maxAttackers", 2)), "ttl": float(o.get("ttl", 2.0)), "tokens": {}, "rotate": 0.0, "slotBase": 0.0}


static func group_expire(g: Dictionary, time: float) -> void:
	for k: String in g["tokens"].keys():
		if g["tokens"][k] <= time:
			g["tokens"].erase(k)


static func group_holds(g: Dictionary, id: String, time: float) -> bool:
	return float(g["tokens"].get(id, -1.0)) > time


static func group_free(g: Dictionary, time: float) -> bool:
	var n: int = 0
	for k: String in g["tokens"]:
		if g["tokens"][k] > time:
			n += 1
	return n < int(g["maxAttackers"])


static func group_request(g: Dictionary, id: String, time: float, ttl: Variant = null) -> bool:
	group_expire(g, time)
	if group_holds(g, id, time):
		return true
	if not group_free(g, time):
		return false
	g["tokens"][id] = time + (float(ttl) if ttl != null else float(g["ttl"]))
	return true


static func group_release(g: Dictionary, id: String) -> void:
	g["tokens"].erase(id)


static func group_update(g: Dictionary, agents: Array, target_pos: Variant, time: float, dt: float = DT) -> void:
	group_expire(g, time)
	g["slotBase"] = float(g["slotBase"]) + float(g["rotate"]) * dt
	var melee: Array = agents.filter(func(a: Dictionary) -> bool: return a["role"] == "melee")
	melee.sort_custom(func(p: Dictionary, q: Dictionary) -> bool: return p["id"] < q["id"])
	var n: int = melee.size()
	for a: Dictionary in agents:
		if a["role"] != "melee":
			a["slot"] = null
	if n == 0 or target_pos == null:
		for a: Dictionary in melee:
			a["slot"] = null
		return
	var tau: float = PI * 2.0
	var ang: Array = []
	for a: Dictionary in melee:
		ang.append(atan2(a["pos"][2] - target_pos[2], a["pos"][0] - target_pos[0]))
	var ord: Array = range(n)
	ord.sort_custom(func(p: int, q: int) -> bool: return ang[p] < ang[q] or (ang[p] == ang[q] and p < q))
	var base: float = ang[0] + float(g["slotBase"])
	var best_r: int = 0
	var best_c: float = INF
	for r in n:
		var c: float = 0.0
		for k in n:
			var ai: int = ord[k]
			var sl: float = base + (tau * float((k + r) % n)) / float(n)
			var dd: float = fmod(absf(ang[ai] - sl), tau)
			if dd > PI:
				dd = tau - dd
			c += dd
		if c < best_c - 1e-12:
			best_c = c
			best_r = r
	for k in n:
		(melee[ord[k]] as Dictionary)["slot"] = base + (tau * float((k + best_r) % n)) / float(n)


# ---------- behaviour tree ----------
static func _mk(a: Dictionary, cfg: Dictionary, world: Dictionary, dt: float) -> Dictionary:
	var kn: Variant = a["perc"]["known"].get(a["target"]) if a["target"] != null else null
	var tw: Variant = null
	if a["target"] != null:
		for t: Dictionary in world.get("targets", []):
			if t["id"] == a["target"]:
				tw = t
				break
	var tgt: Variant = null
	if kn != null:
		tgt = {"id": a["target"], "pos": (tw["pos"] if (kn["seen"] and tw != null) else kn["pos"]), "visible": kn["seen"], "how": kn["how"], "age": a["time"] - float(kn["t"])}
		tgt["dist"] = d2(a["pos"], tgt["pos"])
	return {
		"a": a, "cfg": cfg, "world": world, "dt": dt, "time": a["time"], "group": world.get("group"), "target": tgt, "touched": {}, "steer": [],
		"intent": {"moveDir": [0.0, 0.0, 0.0], "speed": 0.0, "wantAttack": null, "lookAt": null, "state": "idle", "target": (tgt["id"] if tgt != null else null), "tell": null},
	}


static func _point_for(c: Dictionary, to: String) -> Variant:
	var a: Dictionary = c["a"]
	if to == "lastKnown":
		if a["target"] != null and a["perc"]["known"].has(a["target"]):
			return a["perc"]["known"][a["target"]]["pos"]
		return null
	if to == "spawn":
		return a["spawn"]
	if to == "heard":
		return a["perc"]["heardPos"]
	return c["target"]["pos"] if c["target"] != null else null


static func _move(c: Dictionary, st: Dictionary, label: String) -> void:
	var m: Dictionary = st.duplicate()
	m["weight"] = 1.0
	c["steer"].append(m)
	c["intent"]["state"] = label


static func _move_ready(c: Dictionary, id: String) -> bool:
	return float(c["a"]["cd"].get("move:" + id, -1.0)) <= c["time"]


static func _in_range(m: Dictionary, d: float) -> bool:
	var r: Dictionary = m.get("range", {})
	return d >= float(r.get("min", 0.0)) and d <= float(r.get("max", 2.0))


static func _cond(c: Dictionary, n: Dictionary) -> bool:
	var a: Dictionary = c["a"]
	var tg: Variant = c["target"]
	match String(n["test"]):
		"always":
			return true
		"never":
			return false
		"hasTarget":
			return tg != null
		"canSee":
			return tg != null and tg["visible"]
		"remembers":
			return tg != null and not tg["visible"]
		"heard":
			return c["time"] - float(a["perc"]["heardT"]) <= float(n.get("within", 1.0))
		"inRange":
			return tg != null and tg["dist"] >= float(n.get("min", 0.0)) and tg["dist"] <= float(n.get("max", INF))
		"healthBelow":
			return a["hp"] / a["maxHp"] < float(n["pct"])
		"outsideLeash":
			var lr: float = float(n["radius"]) if n.has("radius") else (float(c["cfg"]["leash"]["radius"]) if (c["cfg"].has("leash") and c["cfg"]["leash"].has("radius")) else 30.0)
			return d2(a["pos"], a["spawn"]) > lr
		"nearSpawn":
			return d2(a["pos"], a["spawn"]) <= float(n.get("radius", 1.0))
		"hasToken":
			return c["group"] != null and group_holds(c["group"], a["id"], c["time"])
		"tokenAvailable":
			return c["group"] != null and (group_holds(c["group"], a["id"], c["time"]) or group_free(c["group"], c["time"]))
		"moveReady":
			return _move_ready(c, n["move"])
		"roll":
			return rng_next(a) < float(n["p"])
		"timeSinceSeen":
			var t: float = INF
			if a["target"] != null and a["perc"]["known"].has(a["target"]):
				t = c["time"] - float(a["perc"]["known"][a["target"]]["t"])
			return (not n.has("gt") or t > float(n["gt"])) and (not n.has("lt") or t < float(n["lt"]))
		"hasSlot":
			return a["slot"] != null
		"role":
			return a["role"] == n["is"]
	push_error("unknown condition " + str(n["test"]))
	return false


static func _input(c: Dictionary, name: String) -> float:
	var a: Dictionary = c["a"]
	var tg: Variant = c["target"]
	match name:
		"dist":
			return tg["dist"] if tg != null else 1e9
		"healthPct":
			return a["hp"] / a["maxHp"]
		"visible":
			return 1.0 if (tg != null and tg["visible"]) else 0.0
		"hasToken":
			return 1.0 if (c["group"] != null and group_holds(c["group"], a["id"], c["time"])) else 0.0
		"tokenFree":
			return 1.0 if (c["group"] != null and group_free(c["group"], c["time"])) else 0.0
		"timeSinceSeen":
			return tg["age"] if tg != null else 1e9
		"threat":
			return float(a["threat"].get(a["target"], 0.0)) if a["target"] != null else 0.0
		"hasTarget":
			return 1.0 if tg != null else 0.0
	return 0.0


static func _go_to(c: Dictionary, n: Dictionary, mem: Dictionary, nav: bool, slow: float) -> String:
	var p: Variant = _point_for(c, String(n.get("to", "target")))
	if p == null:
		return F
	var stop: float = float(n.get("stop", 0.2))
	var d: float = d2(c["a"]["pos"], p)
	var label: String = "path" if nav else "seek"
	if d <= stop:
		c["intent"]["state"] = label
		return S
	var aim: Array = p
	var aim_is_p: bool = true
	var prov: Variant = c["world"].get("nav")
	if nav and prov != null and not (prov.has_is_clear() and prov.is_clear(c["a"]["pos"], p)):
		var gk: String = "%d,%d" % [int(floor(p[0] + 0.5)), int(floor(p[2] + 0.5))]
		if not mem.has("pts") or mem["pts"] == null or mem["gk"] != gk or c["time"] - float(mem["t0"]) >= float(n.get("repath", 0.5)):
			mem["pts"] = prov.find_path(c["a"]["pos"], p)
			mem["gk"] = gk
			mem["t0"] = c["time"]
			mem["i"] = 0
		if mem["pts"] == null:
			return F
		var pts: Array = mem["pts"]
		while mem["i"] < pts.size() - 1 and d2(c["a"]["pos"], pts[mem["i"]]) < float(n.get("reach", 0.4)):
			mem["i"] += 1
		aim = pts[mem["i"]]
		aim_is_p = false
	var st: Dictionary = arrive(c["a"]["pos"], aim, slow, stop) if aim_is_p else seek(c["a"]["pos"], aim)
	st["speed"] = float(st["speed"]) * float(n.get("speed", 1.0))
	_move(c, st, label)
	if c["intent"]["lookAt"] == null and n.get("face", true):
		c["intent"]["lookAt"] = aim.duplicate()
	return R


static func _action(c: Dictionary, n: Dictionary, mem: Dictionary) -> String:
	var a: Dictionary = c["a"]
	var I: Dictionary = c["intent"]
	var tg: Variant = c["target"]
	match String(n["do"]):
		"idle":
			I["state"] = "idle"
			return S
		"wander":
			var r: float = float(n.get("radius", 4.0))
			if not mem.has("goal") or c["time"] >= mem["until"]:
				var gx: float = a["spawn"][0] + (rng_next(a) * 2.0 - 1.0) * r
				var gz: float = a["spawn"][2] + (rng_next(a) * 2.0 - 1.0) * r
				mem["goal"] = [gx, a["spawn"][1], gz]
				mem["until"] = c["time"] + float(n.get("interval", 3.0))
			if d2(a["pos"], mem["goal"]) < 0.3:
				I["state"] = "wander"
				return S
			var st: Dictionary = arrive(a["pos"], mem["goal"], 1.5, 0.2)
			st["speed"] = 1.0 * float(n.get("speed", 0.4)) * float(st["speed"])
			_move(c, st, "wander")
			return R
		"seek":
			return _go_to(c, n, mem, false, 0.0)
		"arrive":
			return _go_to(c, n, mem, false, float(n.get("slow", 2.0)))
		"path":
			return _go_to(c, n, mem, true, float(n.get("slow", 1.0)))
		"flee":
			var p: Variant = _point_for(c, String(n.get("from", "target")))
			if p == null:
				return F
			if d2(a["pos"], p) >= float(n.get("dist", 8.0)):
				return S
			var f: Dictionary = flee(a["pos"], p)
			f["speed"] = float(n.get("speed", 1.0))
			_move(c, f, "flee")
			return R
		"keepDistance":
			var p2: Variant = _point_for(c, String(n.get("to", "target")))
			if p2 == null:
				return F
			var kd: Dictionary = keep_distance(a["pos"], p2, float(n.get("min", 6.0)), float(n.get("max", 10.0)))
			I["lookAt"] = (p2 as Array).duplicate()
			if kd["speed"] == 0.0:
				I["state"] = "hold"
				return S
			kd["speed"] = float(kd["speed"]) * float(n.get("speed", 1.0))
			_move(c, kd, "keepDistance")
			return R
		"orbit":
			var p3: Variant = _point_for(c, String(n.get("to", "target")))
			if p3 == null:
				return F
			if not mem.has("sign"):
				var dr: String = String(n.get("dir", "random"))
				if dr == "cw":
					mem["sign"] = -1.0
				elif dr == "ccw":
					mem["sign"] = 1.0
				else:
					mem["sign"] = -1.0 if rng_next(a) < 0.5 else 1.0
				mem["t0"] = c["time"]
			if n.has("duration") and c["time"] - float(mem["t0"]) >= float(n["duration"]):
				return S
			var o: Dictionary = orbit(a["pos"], p3, float(n.get("radius", 4.0)), mem["sign"])
			o["speed"] = float(n.get("speed", 0.6))
			_move(c, o, "orbit")
			I["lookAt"] = (p3 as Array).duplicate()
			return R
		"surround":
			if tg == null or a["slot"] == null:
				return F
			var rr: float = float(n.get("radius", 2.5))
			var tp: Array = tg["pos"]
			var goal: Array = [tp[0] + cos(a["slot"]) * rr, tp[1], tp[2] + sin(a["slot"]) * rr]
			I["lookAt"] = tp.duplicate()
			if d2(a["pos"], goal) < 0.4:
				I["state"] = "surround"
				return S
			var sa: Dictionary = arrive(a["pos"], goal, 2.0, 0.3)
			sa["speed"] = float(n.get("speed", 0.8)) * float(sa["speed"])
			_move(c, sa, "surround")
			return R
		"face":
			var p4: Variant = _point_for(c, String(n.get("to", "target")))
			if p4 == null:
				return F
			I["lookAt"] = (p4 as Array).duplicate()
			return S
		"attack":
			var m: Variant = c["cfg"]["moves"].get(n["move"])
			if m == null or tg == null:
				return F
			if not _in_range(m, tg["dist"]) or not _move_ready(c, n["move"]):
				return F
			if m.get("needsLos", false) and not tg["visible"]:
				return F
			if float(m.get("tokens", 0.0)) > 0.0 and c["group"] != null:
				if not group_request(c["group"], a["id"], c["time"], float(m.get("duration", 0.5))):
					return F
				c["group"]["tokens"][a["id"]] = c["time"] + float(m.get("duration", 0.5))
			a["cd"]["move:" + String(n["move"])] = c["time"] + float(m.get("cooldown", 1.0))
			I["wantAttack"] = n["move"]
			I["lookAt"] = (tg["pos"] as Array).duplicate()
			I["state"] = "attack"
			return S
		"charge":
			if tg == null:
				return F
			var wind: float = float(n.get("windup", 0.8))
			var tp2: Array = tg["pos"]
			if not mem.has("phase"):
				mem["phase"] = "windup"
				mem["t0"] = c["time"]
			if mem["phase"] == "windup":
				I["lookAt"] = tp2.duplicate()
				I["state"] = "windup"
				I["tell"] = n.get("tell", "charge")
				if c["time"] - float(mem["t0"]) >= wind:
					mem["phase"] = "dash"
					mem["dir"] = dir2(a["pos"], tp2)
					mem["from"] = (a["pos"] as Array).duplicate()
				return R
			if mem["phase"] == "dash":
				var traveled: float = d2(a["pos"], mem["from"])
				var hit: bool = tg["dist"] <= float(n.get("hitDist", 1.2))
				if traveled >= float(n.get("maxDist", 12.0)) or hit:
					if hit and n.has("hitMove"):
						I["wantAttack"] = n["hitMove"]
					mem["phase"] = "recover"
					mem["t0"] = c["time"]
					return R
				c["steer"].append({"dir": mem["dir"], "speed": float(n.get("speed", 3.0)), "weight": 1.0})
				I["state"] = "dash"
				I["lookAt"] = [a["pos"][0] + mem["dir"][0], a["pos"][1], a["pos"][2] + mem["dir"][2]]
				return R
			I["state"] = "recover"
			if c["time"] - float(mem["t0"]) >= float(n.get("recover", 0.6)):
				return S
			return R
		"dropAggro":
			a["threat"] = {}
			a["perc"]["known"] = {}
			a["target"] = null
			c["target"] = null
			I["target"] = null
			I["state"] = "reset"
			return S
	push_error("unknown action " + str(n["do"]))
	return F


static func run_node(node: Dictionary, path: String, c: Dictionary) -> String:
	c["touched"][path] = true
	var a: Dictionary = c["a"]
	match String(node["type"]):
		"selector", "sequence":
			var sel: bool = node["type"] == "selector"
			var stop: String = F if sel else S
			var mem: Variant = null
			if node.get("memory", false):
				if not a["mem"].has(path):
					a["mem"][path] = {}
				mem = a["mem"][path]
			var start: int = int(mem["idx"]) if (mem != null and mem.has("idx")) else 0
			var kids: Array = node["children"]
			for i in range(start, kids.size()):
				var r: String = run_node(kids[i], "%s.%d" % [path, i], c)
				if r == R and mem != null:
					mem["idx"] = i
				if r != stop:
					if mem != null and r != R:
						mem.erase("idx")
					return r
			if mem != null:
				mem.erase("idx")
			return stop
		"invert":
			var r2: String = run_node(node["child"], path + ".0", c)
			return F if r2 == S else (S if r2 == F else R)
		"succeeder":
			var r3: String = run_node(node["child"], path + ".0", c)
			return R if r3 == R else S
		"condition":
			var v: bool = _cond(c, node)
			return S if ((not v) if node.get("not", false) else v) else F
		"cooldown":
			var key: String = "cd:" + String(node.get("id", path))
			if float(a["cd"].get(key, -1.0)) > c["time"]:
				return F
			var r4: String = run_node(node["child"], path + ".0", c)
			if r4 == S or (node.get("on") == "done" and r4 == F):
				a["cd"][key] = c["time"] + float(node["seconds"])
			return r4
		"weighted":
			if not a["mem"].has(path):
				a["mem"][path] = {}
			var wm: Dictionary = a["mem"][path]
			var kids2: Array = node["children"]
			var w: Array = []
			for i in kids2.size():
				if node.has("weights"):
					w.append(maxf(0.0, float(node["weights"][i]) if i < node["weights"].size() else 0.0))
				else:
					w.append(maxf(0.0, float(kids2[i].get("weight", 1.0))))
			if not wm.has("idx") or (c["time"] >= float(wm.get("until", 0.0)) and not wm.get("running", false)):
				var tot: float = 0.0
				for x: float in w:
					tot += x
				if tot <= 0.0:
					return F
				var rv: float = rng_next(a) * tot
				var k: int = 0
				while k < w.size() - 1:
					if rv < w[k]:
						break
					rv -= w[k]
					k += 1
				wm["idx"] = k
				wm["until"] = c["time"] + float(node.get("hold", 0.0))
			var res: String = run_node(kids2[wm["idx"]], "%s.%d" % [path, wm["idx"]], c)
			wm["running"] = res == R
			if res != R and c["time"] >= float(wm["until"]):
				wm.erase("idx")
			return res
		"utility":
			if not a["mem"].has(path):
				a["mem"][path] = {}
			var um: Dictionary = a["mem"][path]
			var best: int = -1
			var bs: float = 0.0
			var opts: Array = node["options"]
			for i in opts.size():
				var o: Dictionary = opts[i]
				var s: float = float(o.get("weight", 1.0))
				for k2: Dictionary in o.get("consider", []):
					var x: float = _input(c, String(k2["input"]))
					var lo: float = float(k2.get("min", 0.0))
					var hi: float = float(k2.get("max", 1.0))
					var den: float = hi - lo
					if den == 0.0:
						den = 1.0
					var vv: float = clampf((x - lo) / den, 0.0, 1.0)
					if k2.get("invert", false):
						vv = 1.0 - vv
					if k2.has("power") and float(k2["power"]) != 0.0:
						vv = pow(vv, float(k2["power"]))
					s *= vv
				if um.has("idx") and um["idx"] == i:
					s *= float(node.get("stickiness", 1.2))
				if s > bs + 1e-12:
					bs = s
					best = i
			if best < 0:
				um.erase("idx")
				return F
			um["idx"] = best
			return run_node(opts[best]["node"], "%s.%d" % [path, best], c)
		"action":
			if not a["mem"].has(path):
				a["mem"][path] = {}
			var am: Dictionary = a["mem"][path]
			var ar: String = _action(c, node, am)
			if ar != R:
				a["mem"].erase(path)
			return ar
	push_error("unknown node type at " + path)
	return F


## One AI step. Mutates `a`; returns the intent {moveDir, speed, wantAttack, lookAt, state, target, tell}.
static func tick_agent(a: Dictionary, cfg_in: Dictionary, world: Dictionary, dt: float = DT) -> Dictionary:
	var cfg: Dictionary = cfg_in if (cfg_in.has("stats") and cfg_in.has("perception") and cfg_in.has("threat")) else normalize_config(cfg_in)
	a["time"] = float(a["time"]) + dt
	perceive(a, cfg, world, dt)
	var c: Dictionary = _mk(a, cfg, world, dt)
	c["time"] = a["time"]
	if cfg.has("tree"):
		run_node(cfg["tree"], "r", c)
	for k: String in a["mem"].keys():
		if not c["touched"].has(k):
			a["mem"].erase(k)
	var parts: Array = c["steer"].duplicate()
	var sep: Variant = cfg["steering"].get("separation")
	if sep != null and world.has("agents"):
		var near: Array = []
		for o: Dictionary in world["agents"]:
			if o["id"] != a["id"]:
				near.append(o["pos"])
		var s: Dictionary = separation(a["pos"], near, float(sep["radius"]))
		if s["speed"] > 0.0:
			s["weight"] = float(sep["weight"])
			parts.append(s)
	var m: Dictionary = combine(parts, 1.0)
	var I: Dictionary = c["intent"]
	I["moveDir"] = m["dir"]
	I["speed"] = rnd(m["speed"], 1e6)
	a["state"] = I["state"]
	if I["lookAt"] == null and c["target"] != null:
		I["lookAt"] = (c["target"]["pos"] as Array).duplicate()
	return I


static func tick_all(agents: Array, configs: Dictionary, world: Dictionary, dt: float = DT) -> Dictionary:
	var sorted: Array = agents.duplicate()
	sorted.sort_custom(func(p: Dictionary, q: Dictionary) -> bool: return p["id"] < q["id"])
	var out: Dictionary = {}
	for a: Dictionary in sorted:
		if a["role"] == null:
			a["role"] = normalize_config(configs[a["config"]])["role"]
	var w: Dictionary = world.duplicate(false)
	w["agents"] = sorted
	if world.has("group"):
		var ts: Array = world.get("targets", [])
		var tp: Variant = ts[0]["pos"] if ts.size() > 0 else null
		group_update(world["group"], sorted, tp, (sorted[0]["time"] + dt) if sorted.size() > 0 else 0.0, dt)
	for a: Dictionary in sorted:
		out[a["id"]] = tick_agent(a, configs[a["config"]], w, dt)
	return out


## Kinematic stand-in for locomotion: moves along moveDir at speed*moveSpeed, turns facing toward lookAt.
static func integrate(a: Dictionary, cfg: Dictionary, I: Dictionary, dt: float = DT) -> void:
	var n: Dictionary = cfg if cfg.has("stats") else normalize_config(cfg)
	var v: float = float(I["speed"]) * float(n["stats"]["moveSpeed"]) * dt
	a["pos"][0] += I["moveDir"][0] * v
	a["pos"][2] += I["moveDir"][2] * v
	var want: Variant = null
	if I["lookAt"] != null:
		want = dir2(a["pos"], I["lookAt"])
	elif I["speed"] > 0.0:
		want = I["moveDir"]
	if want != null and (want[0] != 0.0 or want[2] != 0.0):
		var k: float = minf(1.0, float(n["stats"]["turnRate"]) * dt)
		var f: Array = a["facing"]
		a["facing"] = unit2([f[0] + (want[0] - f[0]) * k, 0.0, f[2] + (want[2] - f[2]) * k])
		if a["facing"][0] == 0.0 and a["facing"][2] == 0.0:
			a["facing"] = want


static func _target_at(path: Array, t: float) -> Array:
	if path.is_empty():
		return [0.0, 0.0, 0.0]
	if t <= path[0]["t"]:
		return (path[0]["pos"] as Array).duplicate()
	for i in range(1, path.size()):
		if t <= path[i]["t"]:
			var a: Dictionary = path[i - 1]
			var b: Dictionary = path[i]
			var den: float = float(b["t"]) - float(a["t"])
			if den == 0.0:
				den = 1.0
			var k: float = (t - float(a["t"])) / den
			return [a["pos"][0] + (b["pos"][0] - a["pos"][0]) * k, a["pos"][1] + (b["pos"][1] - a["pos"][1]) * k, a["pos"][2] + (b["pos"][2] - a["pos"][2]) * k]
	return (path[path.size() - 1]["pos"] as Array).duplicate()


## Headless scenario (same shape as ai3d.simulate). Returns {duration, steps, hash, timeline, attacks, stats, final}.
static func simulate(sc: Dictionary) -> Dictionary:
	var dt: float = float(sc.get("dt", DT))
	var steps: int = int(floor(float(sc["duration"]) / dt + 0.5))
	var seed_v: int = int(sc.get("seed", 1))
	var configs: Dictionary = {}
	for k: String in sc["configs"]:
		configs[k] = normalize_config(sc["configs"][k])
	var walls: Array = sc.get("world", {}).get("walls", [])
	var world0: Dictionary = {}
	if not walls.is_empty():
		world0["bvh"] = walls
	var wd: Dictionary = sc.get("world", {})
	if wd.has("grid"):
		world0["nav"] = NAV.grid_from_boxes(walls, wd["grid"])
	elif wd.has("waypoints"):
		world0["nav"] = NAV.create_waypoints(wd["waypoints"])
	if sc.has("group"):
		world0["group"] = create_group(sc["group"])
	var agents: Array = []
	for i in (sc["agents"] as Array).size():
		var s: Dictionary = (sc["agents"] as Array)[i].duplicate(false)
		if not s.has("seed"):
			s["seed"] = (seed_v * 7919 + i * 104729) & 0xFFFFFFFF
		agents.append(create_agent(s))
	var sorted_agents: Array = agents.duplicate()
	sorted_agents.sort_custom(func(p: Dictionary, q: Dictionary) -> bool: return p["id"] < q["id"])
	var tl: Array = []
	var last: Dictionary = {}
	var attacks: Dictionary = {}
	var tgt: Variant = sc.get("target")
	var stat: Dictionary = {"maxTokens": 0, "maxSimultaneousAttacks": 0, "ticks": steps}
	var h: int = 2166136261
	for s_i in steps:
		var t: float = rnd(s_i * dt, 1e9)
		var world: Dictionary = world0.duplicate(false)
		world["time"] = t
		world["targets"] = [{"id": tgt["id"], "pos": _target_at(tgt["path"], t), "noise": float(tgt.get("noise", 0.0))}] if tgt != null else []
		var snd: Array = []
		for e: Dictionary in sc.get("sounds", []):
			if e["t"] >= t - 1e-9 and e["t"] < t + dt - 1e-9:
				snd.append(e)
		var evs: Array = []
		for e: Dictionary in sc.get("events", []):
			if e["t"] >= t - 1e-9 and e["t"] < t + dt - 1e-9:
				evs.append(e)
		world["sounds"] = snd
		world["events"] = evs
		var intents: Dictionary = tick_all(agents, configs, world, dt)
		var atk: int = 0
		for a: Dictionary in sorted_agents:
			var I: Dictionary = intents[a["id"]]
			integrate(a, configs[a["config"]], I, dt)
			var wa: String = I["wantAttack"] if I["wantAttack"] != null else ""
			var key: String = "%s|%s|%s" % [I["state"], wa, I["target"] if I["target"] != null else ""]
			if I["wantAttack"] != null:
				atk += 1
				attacks[a["id"]] = int(attacks.get(a["id"], 0)) + 1
			if last.get(a["id"]) != key:
				last[a["id"]] = key
				var pp: Array = []
				for v: float in a["pos"]:
					pp.append(rnd(v, 1e3))
				tl.append({"t": rnd(t + dt, 1e6), "agent": a["id"], "state": I["state"], "wantAttack": I["wantAttack"], "target": I["target"], "pos": pp})
			h = fnv_mix(h, "%s|%s|%s|%s|%s|" % [a["id"], I["state"], wa, num4(a["pos"][0]), num4(a["pos"][2])])
		stat["maxSimultaneousAttacks"] = maxi(int(stat["maxSimultaneousAttacks"]), atk)
		if world0.has("group"):
			var cnt: int = 0
			for k: String in world0["group"]["tokens"]:
				if world0["group"]["tokens"][k] > t + dt:
					cnt += 1
			stat["maxTokens"] = maxi(int(stat["maxTokens"]), cnt)
	var final: Array = []
	for a: Dictionary in agents:
		var pp2: Array = []
		for v: float in a["pos"]:
			pp2.append(rnd(v, 1e3))
		final.append({"id": a["id"], "pos": pp2, "state": a["state"], "target": a["target"]})
	return {"duration": sc["duration"], "steps": steps, "hash": "%08x" % h, "timeline": tl, "attacks": attacks, "stats": stat, "final": final}

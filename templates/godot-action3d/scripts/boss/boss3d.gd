extends RefCounted
## GDScript mirror of templates/web-project/src/lib/boss3d.js (spec/v4/boss3d.md): same JSON boss data, same seeded sim,
## same event log, so run_fight()/simulate() reproduce the JS logHash / hash. Frame counters are ints, everything else is
## double; field access uses d["key"] (dot access collides with Dictionary methods).
const J := preload("res://scripts/combat/js_compat.gd")
const FD := preload("res://scripts/combat/fdlibm.gd")

const DT: float = 1.0 / 60.0
const FPS: float = 60.0
const NOJUMP: float = 1e9
const ZONE_SHAPES: Array = ["circle", "cone", "line", "ring", "sweep"]
const DEFAULT_PROFILE: Dictionary = {"hp": 100, "moveSpeed": 6.5, "reactionMs": 300, "dodgeDistance": 4, "iframeMs": 300, "dodgeCooldownMs": 900, "dodgeSkill": 0.92, "attackDamage": 10, "attackIntervalMs": 600, "range": 3, "weakAwareness": 0.8, "radius": 0.4, "healItems": 0}
const ORACLE_PROFILE: Dictionary = {"hp": 100, "moveSpeed": 6.5, "reactionMs": 350, "dodgeDistance": 4, "iframeMs": 300, "dodgeCooldownMs": 900, "dodgeSkill": 1, "attackDamage": 10, "attackIntervalMs": 600, "range": 3, "weakAwareness": 1, "radius": 0.4, "healItems": 0}


static func F(sec) -> int:
	return maxi(0, int(J.round_js(float(sec) * FPS)))


static func _rad(d) -> float:
	return float(d) * PI / 180.0


static func _wrap(a: float) -> float:
	a = fmod(a, TAU)
	if a > PI:
		a -= TAU
	if a < -PI:
		a += TAU
	return a


static func _hyp(a: float, b: float) -> float:
	return J.hyp2(a, b)


static func _g(d, k: String, dflt):
	return J.num(d, k, dflt)


# ---------------------------------------------------------------- zones
static func resolve_zone(spec: Dictionary, owner: Array, target: Array, aim: float) -> Dictionary:
	var dir: Array = [FD.fcos(aim), FD.fsin(aim)]
	var off: Array = spec["offset"] if spec.get("offset") != null else [0.0, 0.0]
	var sh = spec.get("shape")
	var base: Array = [target[0], target[2]] if (spec.get("at") == "target" and (sh == "circle" or sh == "ring")) else [owner[0], owner[2]]
	var o: Array = [base[0] + dir[0] * off[1] - dir[1] * off[0], base[1] + dir[1] * off[1] + dir[0] * off[0]]
	var r = spec.get("r")
	if r == null:
		r = spec.get("length")
	if r == null:
		r = spec.get("rOuter")
	if r == null:
		r = 0
	var rout = spec.get("rOuter")
	if rout == null:
		rout = spec.get("r")
	if rout == null:
		rout = 0
	var arc = spec.get("arc")
	return {"shape": sh, "o": [J.r4(o[0]), J.r4(o[1])], "aim": J.r4(aim), "r": r, "angle": _rad(_g(spec, "angle", 360)), "length": _g(spec, "length", 0), "width": _g(spec, "width", 0),
		"rInner": _g(spec, "rInner", 0), "rOuter": rout, "arc": [_rad(arc[0] if arc != null and arc[0] != null else -90), _rad(arc[1] if arc != null and arc[1] != null else 90)], "maxY": _g(spec, "maxY", NOJUMP)}


static func sweep_angle(z: Dictionary, t: float) -> float:
	return z["aim"] + z["arc"][0] + (z["arc"][1] - z["arc"][0]) * t


static func zone_contains(z: Dictionary, p: Array, pad: float = 0.0, t0: float = 0.0, t1: float = 1.0) -> bool:
	if p[1] > z["maxY"]:
		return false
	var dx: float = p[0] - z["o"][0]
	var dz: float = p[2] - z["o"][1]
	var d: float = _hyp(dx, dz)
	match z["shape"]:
		"circle":
			return d <= z["r"] + pad
		"ring":
			return d >= z["rInner"] - pad and d <= z["rOuter"] + pad
		"cone":
			return d <= z["r"] + pad and (d < 1e-6 or absf(_wrap(FD.fatan2(dz, dx) - z["aim"])) <= z["angle"] / 2.0 + FD.fatan2(pad, maxf(d, pad)))
		"line":
			var c: float = FD.fcos(z["aim"])
			var s: float = FD.fsin(z["aim"])
			var lx: float = dx * c + dz * s
			var ly: float = -dx * s + dz * c
			return lx >= -pad and lx <= z["length"] + pad and absf(ly) <= z["width"] / 2.0 + pad
		"sweep":
			if d > z["r"] + pad:
				return false
			var a: float = sweep_angle(z, t0)
			var b: float = sweep_angle(z, t1)
			var mid: float = (a + b) / 2.0
			var span: float = absf(b - a) / 2.0
			var half: float = FD.fatan2(z["width"] / 2.0 + pad, maxf(d, 0.01))
			return absf(_wrap(FD.fatan2(dz, dx) - mid)) <= span + half or span + half >= PI
	return false


# ---------------------------------------------------------------- state
static func _parts(def: Dictionary) -> Array:
	var p = def.get("parts")
	return p if p != null else []


static func _find_part(def: Dictionary, id) -> Variant:
	for p in _parts(def):
		if p["id"] == id:
			return p
	return null


static func owner_pos(def: Dictionary, id) -> Array:
	var b: Array = def["pos"] if def.get("pos") != null else [0.0, 0.0, 0.0]
	var o: Array = [0.0, 0.0, 0.0]
	if id == "body":
		var c = def.get("core")
		if c != null and c.get("pos") != null:
			o = c["pos"]
	else:
		var p = _find_part(def, id)
		if p != null and p.get("pos") != null:
			o = p["pos"]
	return [b[0] + o[0], b[1] + o[1], b[2] + o[2]]


static func core_hp(def: Dictionary):
	var c = def.get("core")
	if c != null and c.get("hp") != null:
		return c["hp"]
	return _g(def, "hp", 1)


static func create_boss(def: Dictionary, seed: int = 1) -> Dictionary:
	var parts: Dictionary = {}
	for p in _parts(def):
		parts[p["id"]] = {"hp": p["hp"], "alive": true, "stunUntil": 0, "regrowAt": -1, "stagger": 0.0, "severed": false, "deaths": 0}
	var s0: int = seed & 0xFFFFFFFF
	var ph0: Dictionary = def["phases"][0]
	return {"v": 1, "id": def["id"], "rng": s0 if s0 != 0 else 1, "frame": 0, "phaseIdx": 0, "phaseId": ph0["id"], "phaseFrame": 0, "hp": core_hp(def), "parts": parts, "flags": {}, "attacks": [], "nextId": 1,
		"cd": {}, "nextStartF": F(_g(ph0, "openingDelay", 1)), "invulnUntil": 0, "stunAllUntil": 0, "defeated": false, "enraged": false, "enrage": {"speed": 1.0, "damage": 1.0, "windup": 1.0},
		"partEnrage": 1.0, "hazards": {}, "firedAdds": {}, "firedHazards": {}, "partsDown": 0, "log": [], "logDropped": 0, "stats": {"damageDealt": 0.0, "maxThreats": 0}}


static func _emit(s: Dictionary, evs: Array, type: String, data: Dictionary = {}) -> Dictionary:
	var e: Dictionary = {"f": s["frame"], "type": type}
	for k in data.keys():
		e[k] = data[k]
	evs.append(e)
	if s["log"].size() < 60000:
		s["log"].append(e)
	else:
		s["logDropped"] += 1
	return e


static func _speed(s: Dictionary) -> float:
	return s["enrage"]["speed"] * s["partEnrage"]


static func _exposed_stage(s: Dictionary, owner) -> String:
	for a in s["attacks"]:
		if a["owner"] == owner and a["stage"] != "done":
			return a["stage"]
	return "idle"


static func part_stunned(s: Dictionary, id) -> bool:
	var ps = s["parts"].get(id)
	return s["frame"] < s["stunAllUntil"] or s["frame"] < (ps["stunUntil"] if ps != null else 0)


static func weak_open(def: Dictionary, s: Dictionary, part_id) -> bool:
	var p = _find_part(def, part_id)
	if p == null or p.get("weakPoint") == null or not s["parts"][part_id]["alive"]:
		return false
	var open = p["weakPoint"].get("open")
	if open == null:
		open = ["recovery", "stun"]
	if open is String and open == "always":
		return true
	return (open.has("stun") and part_stunned(s, part_id)) or open.has(_exposed_stage(s, part_id))


static func core_exposed(def: Dictionary, s: Dictionary) -> bool:
	var c = def.get("core")
	var e = c.get("exposedWhen") if c != null else null
	if e == null or (e is String and e == "always"):
		return true
	if e.get("partsDownAtLeast") != null and s["partsDown"] >= e["partsDownAtLeast"]:
		return true
	if e.get("phase") != null and e["phase"] != "" and s["phaseId"] == e["phase"]:
		return true
	if e.get("phaseIndexAtLeast") != null and s["phaseIdx"] >= e["phaseIndexAtLeast"]:
		return true
	if bool(e.get("stunned", false)) and s["frame"] < s["stunAllUntil"]:
		return true
	if e.get("flag") != null and e["flag"] != "" and bool(s["flags"].get(e["flag"], false)):
		return true
	return false


static func hp_frac(def: Dictionary, s: Dictionary) -> float:
	return s["hp"] / float(core_hp(def))


static func total_hp_frac(def: Dictionary, s: Dictionary) -> float:
	var m: float = float(core_hp(def))
	var c: float = maxf(0.0, s["hp"])
	for p in _parts(def):
		m += p["hp"]
		c += maxf(0.0, s["parts"][p["id"]]["hp"])
	return c / m


# ---------------------------------------------------------------- damage in
static func _cancel_owner_attacks(s: Dictionary, evs: Array, owner) -> void:
	for a in s["attacks"]:
		if a["owner"] == owner and a["stage"] != "done":
			a["stage"] = "done"
			_emit(s, evs, "cancel", {"attack": a["attack"], "owner": owner, "id": a["id"]})


static func _kill_part(def: Dictionary, s: Dictionary, evs: Array, p: Dictionary, why: String) -> void:
	var ps: Dictionary = s["parts"][p["id"]]
	ps["alive"] = false
	ps["hp"] = 0
	ps["deaths"] += 1
	s["partsDown"] += 1
	_cancel_owner_attacks(s, evs, p["id"])
	_emit(s, evs, "partDown", {"part": p["id"], "why": why})
	var rg = p.get("regrow")
	if rg != null and not (why == "sever" and bool(rg.get("noRegrowOnSever", false))):
		ps["regrowAt"] = s["frame"] + F(rg["time"])
	var d = p.get("onDeath")
	if d == null:
		return
	if d.get("coreDamageFrac") != null and d["coreDamageFrac"] != 0:
		s["hp"] = maxf(0.0, s["hp"] - d["coreDamageFrac"] * core_hp(def))
		_emit(s, evs, "coreDamaged", {"by": p["id"], "hp": J.r4(s["hp"])})
	if d.get("stagger") != null and d["stagger"] != 0:
		s["stunAllUntil"] = maxi(s["stunAllUntil"], s["frame"] + F(d["stagger"]))
		_emit(s, evs, "stagger", {"scope": "all", "seconds": d["stagger"], "cause": p["id"]})
	if d.get("enrageSpeed") != null and d["enrageSpeed"] != 0:
		s["partEnrage"] *= d["enrageSpeed"]
		_emit(s, evs, "enrage", {"cause": p["id"], "speed": J.r4(_speed(s))})
	if bool(d.get("clearAttacks", false)):
		for a in s["attacks"]:
			if a["stage"] != "done" and not a["hazard"]:
				a["stage"] = "done"
				_emit(s, evs, "cancel", {"attack": a["attack"], "owner": a["owner"], "id": a["id"]})
	if d.get("spawn") != null:
		_spawn_adds(def, s, evs, d["spawn"], p["id"])
	if d.get("hazard") != null and d["hazard"] != "":
		_start_hazard(def, s, evs, d["hazard"])
	if d.get("setFlag") != null and d["setFlag"] != "":
		s["flags"][d["setFlag"]] = true


static func _stun_part(def: Dictionary, s: Dictionary, evs: Array, id, seconds, cause) -> void:
	var ps = s["parts"].get(id)
	if ps == null or not ps["alive"]:
		return
	ps["stunUntil"] = maxi(ps["stunUntil"], s["frame"] + F(seconds))
	_cancel_owner_attacks(s, evs, id)
	_emit(s, evs, "stun", {"part": id, "seconds": seconds, "cause": cause})


static func _apply_hit(def: Dictionary, s: Dictionary, evs: Array, h: Dictionary) -> void:
	if s["defeated"]:
		return
	var hpart = h.get("part")
	if s["frame"] < s["invulnUntil"]:
		_emit(s, evs, "blocked", {"part": hpart if (hpart != null and hpart != "") else "core", "reason": "invuln"})
		return
	var dmg: float = maxf(0.0, float(_g(h, "damage", 0)))
	var id = hpart if (hpart != null and hpart != "" and hpart != "core" and hpart != "body") else null
	var core = def.get("core")
	if id == null:
		if not core_exposed(def, s):
			_emit(s, evs, "blocked", {"part": "core", "reason": "covered"})
			return
		var sm: float = float(_g(core, "stunMult", 1.5)) if s["frame"] < s["stunAllUntil"] else 1.0
		var mult: float = sm * (1.0 - float(_g(core, "armor", 0)))
		var d: float = dmg * mult
		s["hp"] -= d
		s["stats"]["damageDealt"] += d
		_emit(s, evs, "hit", {"part": "core", "dmg": J.r4(d), "hp": J.r4(maxf(0.0, s["hp"]))})
		if s["hp"] <= 0:
			s["hp"] = 0
			s["defeated"] = true
			for a in s["attacks"]:
				a["stage"] = "done"
			_emit(s, evs, "defeated", {})
		return
	var p = _find_part(def, id)
	var ps = s["parts"].get(id)
	if p == null or not ps["alive"]:
		_emit(s, evs, "blocked", {"part": id, "reason": "down"})
		return
	var open: bool = weak_open(def, s, id)
	var mult2: float = 1.0 - float(_g(p, "armor", 0))
	var weak: bool = bool(h.get("weak", false))
	if weak and open:
		mult2 = float(_g(p["weakPoint"], "multiplier", 2))
	elif part_stunned(s, id):
		mult2 *= float(_g(p, "stunMult", 1.25))
	var d2: float = dmg * mult2
	ps["hp"] -= d2
	s["stats"]["damageDealt"] += d2
	_emit(s, evs, "hit", {"part": id, "dmg": J.r4(d2), "weak": weak and open, "hp": J.r4(maxf(0.0, ps["hp"]))})
	var cs = p.get("coreShare")
	if cs != null and cs != 0:
		s["hp"] -= d2 * cs
		if s["hp"] <= 0 and core_exposed(def, s):
			s["hp"] = 0
			s["defeated"] = true
			_emit(s, evs, "defeated", {})
			return
		s["hp"] = maxf(1e-6, s["hp"])
	var stg = p.get("stagger")
	if stg != null:
		ps["stagger"] += d2
		if ps["stagger"] >= stg["threshold"] and ps["alive"] and ps["hp"] > 0:
			ps["stagger"] = 0.0
			_stun_part(def, s, evs, id, stg["duration"], "stagger")
	if ps["hp"] <= 0:
		_kill_part(def, s, evs, p, "damage")


static func _apply_command(def: Dictionary, s: Dictionary, evs: Array, c: Dictionary) -> void:
	var p = _find_part(def, c.get("part"))
	var t = c.get("type")
	if t == "sever" and p != null and s["parts"][p["id"]]["alive"]:
		s["parts"][p["id"]]["severed"] = true
		_kill_part(def, s, evs, p, "sever")
	elif t == "stun" and p != null:
		_stun_part(def, s, evs, p["id"], _g(c, "seconds", 3), _g(c, "cause", "command"))
	elif t == "flag":
		var v: bool = c.get("value") != false
		s["flags"][c["name"]] = v
		_emit(s, evs, "flag", {"name": c["name"], "value": v})
	elif t == "stunAll":
		var sec = _g(c, "seconds", 3)
		s["stunAllUntil"] = maxi(s["stunAllUntil"], s["frame"] + F(sec))
		_emit(s, evs, "stagger", {"scope": "all", "seconds": sec, "cause": "command"})


# ---------------------------------------------------------------- adds, hazards
static func _spawn_adds(def: Dictionary, s: Dictionary, evs: Array, a: Dictionary, cause) -> void:
	var c: Array = a["center"] if a.get("center") != null else (def["pos"] if def.get("pos") != null else [0.0, 0.0, 0.0])
	var n: int = int(a["count"]) if (a.get("count") != null and a["count"] != 0) else 1
	var rad = a.get("radius")
	if rad == null:
		var ar = def.get("arena")
		rad = float(_g(ar, "radius", 10)) * 0.7
	var off: float = J.rng_next(s) * TAU
	var pos: Array = []
	for i in n:
		var ang: float = off + (float(i) * TAU) / float(n)
		pos.append([J.r4(c[0] + FD.fcos(ang) * rad), J.r4(c[1] if (c.size() > 1 and c[1] != null) else 0.0), J.r4(c[2] + FD.fsin(ang) * rad)])
	_emit(s, evs, "spawn", {"kind": a.get("kind"), "count": n, "positions": pos, "cause": cause})


static func _find_hazard(def: Dictionary, id) -> Variant:
	for h in def.get("hazards", []):
		if h["id"] == id:
			return h
	return null


static func _start_hazard(def: Dictionary, s: Dictionary, evs: Array, id) -> void:
	var h = _find_hazard(def, id)
	if h == null or s["hazards"].has(id):
		return
	var dur = h.get("duration")
	s["hazards"][id] = {"startF": s["frame"], "endF": (s["frame"] + F(dur)) if (dur != null and dur != 0) else -1, "level": _g(h, "fromY", 0), "nextSpawn": s["frame"] + F(_g(h, "windup", 0)), "pulseSeen": -1, "phase": s["phaseId"]}
	var ramp = h.get("ramp")
	if ramp == null:
		ramp = _g(h, "windup", 0)
	_emit(s, evs, "hazardStart", {"hazard": id, "kind": h["kind"], "warning": h.get("warning"), "rampSeconds": ramp})


static func hazard_active(s: Dictionary, id) -> bool:
	return s["hazards"].has(id) and not s["hazards"][id].get("ended", false)


static func vortex_force(h: Dictionary, hs: Dictionary, f: int, pos: Array, resisting: bool = false) -> Array:
	var c: Array = h["center"] if h.get("center") != null else [0.0, 0.0, 0.0]
	var dx: float = c[0] - pos[0]
	var dz: float = c[2] - pos[2]
	var d: float = _hyp(dx, dz)
	if d >= h["radius"] or d < 1e-6:
		return [0.0, 0.0, 0.0]
	var amp: float = minf(1.0, float(f - hs["startF"]) / float(maxi(1, F(_g(h, "ramp", 0)))))
	var pulse = h.get("pulse")
	if pulse != null:
		var t: float = float(f - hs["startF"]) / FPS
		var ph: float = fmod(t, float(pulse["period"]))
		amp *= 1.0 if ph < pulse["active"] else float(_g(pulse, "idle", 0.25))
	var k: float = h["strength"] * amp * pow(1.0 - d / h["radius"], float(_g(h, "falloff", 1))) * (float(_g(h, "resistFactor", 0.3)) if resisting else 1.0)
	var ux: float = dx / d
	var uz: float = dz / d
	var sw: float = float(_g(h, "swirl", 0))
	return [J.r4(k * (ux - sw * uz)), 0.0, J.r4(k * (uz + sw * ux))]


static func _step_hazards(def: Dictionary, s: Dictionary, evs: Array, target: Dictionary) -> Dictionary:
	var out: Dictionary = {"force": [0.0, 0.0, 0.0], "damage": 0.0}
	for h in def.get("hazards", []):
		var hid = h["id"]
		if not s["hazards"].has(hid) and not s["firedHazards"].has(hid) and not bool(h.get("manual", false)):
			var hph = h.get("phase")
			var has_ph: bool = hph != null and hph != ""
			var in_phase: bool = (not has_ph) or hph == s["phaseId"]
			var rel: int = s["phaseFrame"] if has_ph else s["frame"]
			if in_phase and rel >= F(_g(h, "start", 0)):
				s["firedHazards"][hid] = true
				_start_hazard(def, s, evs, hid)
		if not s["hazards"].has(hid):
			continue
		var hs: Dictionary = s["hazards"][hid]
		if hs.get("ended", false):
			continue
		var hph2 = h.get("phase")
		var ends_with: bool = _g(h, "endsWithPhase", true) != false
		if (hph2 != null and hph2 != "" and ends_with and hph2 != s["phaseId"]) or (hs["endF"] >= 0 and s["frame"] >= hs["endF"]):
			hs["ended"] = true
			_emit(s, evs, "hazardEnd", {"hazard": hid})
			continue
		var age: int = s["frame"] - hs["startF"]
		var p: Array = target["pos"]
		var kind: String = h["kind"]
		if kind == "flood":
			var t: float = minf(1.0, float(age) / float(maxi(1, F(_g(h, "rise", 10)))))
			hs["level"] = J.r4(h["fromY"] + (h["toY"] - h["fromY"]) * t)
			if p[1] < hs["level"]:
				out["damage"] += float(_g(h, "dps", 10)) * DT
		elif kind == "vortex":
			var f: Array = vortex_force(h, hs, s["frame"], p, bool(target.get("resisting", false)))
			out["force"] = [out["force"][0] + f[0], 0.0, out["force"][2] + f[2]]
			var pulse = h.get("pulse")
			if pulse != null:
				var per: int = F(pulse["period"])
				if per > 0:
					var k: int = age / per
					if (age % per) == maxi(0, per - F(_g(pulse, "telegraph", 1))) and hs["pulseSeen"] != k:
						hs["pulseSeen"] = k
						_emit(s, evs, "hazardPulse", {"hazard": hid, "inSeconds": _g(pulse, "telegraph", 1), "warning": h.get("warning")})
			var c: Array = h["center"] if h.get("center") != null else [0.0, 0.0, 0.0]
			var cr = h.get("coreRadius")
			if cr != null and cr != 0 and _hyp(p[0] - c[0], p[2] - c[2]) < cr:
				out["damage"] += float(_g(h, "coreDps", 20)) * DT
		elif kind == "debris" and s["frame"] >= hs["nextSpawn"]:
			hs["nextSpawn"] = s["frame"] + F(_g(h, "interval", 2))
			var a = h.get("area")
			if a == null:
				var arn = def.get("arena")
				a = {"center": def["pos"] if def.get("pos") != null else [0.0, 0.0, 0.0], "radius": _g(arn, "radius", 10)}
			for i in int(_g(h, "count", 1)):
				var x: float
				var z: float
				if J.rng_next(s) < float(_g(h, "aimAtTarget", 0)):
					x = p[0]
					z = p[2]
				else:
					var ang: float = J.rng_next(s) * TAU
					var rr: float = sqrt(J.rng_next(s)) * a["radius"]
					x = a["center"][0] + FD.fcos(ang) * rr
					z = a["center"][2] + FD.fsin(ang) * rr
				var rz = _g(h, "r", 2)
				var z0: Dictionary = {"shape": "circle", "o": [J.r4(x), J.r4(z)], "aim": 0, "r": rz, "angle": TAU, "length": 0, "width": 0, "rInner": 0, "rOuter": rz, "arc": [0, 0], "maxY": NOJUMP}
				_launch(def, s, evs, {"id": str(hid), "owner": "hazard:" + str(hid), "windupF": F(_g(h, "telegraph", 1.2)), "activeF": 3, "recoveryF": 0, "zone": z0, "damage": _g(h, "damage", 15), "hazard": true, "warning": h.get("warning")})
		elif kind == "gas" and not hs.has("gas") and age >= F(_g(h, "windup", 1.5)):
			hs["gas"] = true
			var gc: Array = h["center"] if h.get("center") != null else [0.0, 0.0, 0.0]
			var gz: Dictionary = {"shape": "circle", "o": [gc[0], gc[2]], "aim": 0, "r": h["radius"], "angle": TAU, "length": 0, "width": 0, "rInner": 0, "rOuter": h["radius"], "arc": [0, 0], "maxY": _g(h, "maxY", NOJUMP)}
			_launch(def, s, evs, {"id": hid, "owner": "hazard:" + str(hid), "windupF": 0, "activeF": (hs["endF"] - s["frame"]) if hs["endF"] >= 0 else 60 * 600, "recoveryF": 0, "hazard": true, "dps": _g(h, "dps", 8),
				"growTo": h["growTo"] if h.get("growTo") != null else h["radius"], "grow": F(_g(h, "grow", 5)), "zone": gz, "r0": h["radius"], "warning": h.get("warning")})
	return out


# ---------------------------------------------------------------- attacks
static func _launch(def: Dictionary, s: Dictionary, evs: Array, a: Dictionary) -> Dictionary:
	var inst: Dictionary = {"id": s["nextId"], "attack": a["id"], "owner": a["owner"], "f0": s["frame"], "stage": "windup" if a["windupF"] > 0 else "active", "t": 0, "windupF": a["windupF"], "activeF": a["activeF"], "recoveryF": a["recoveryF"],
		"zone": a["zone"], "damage": _g(a, "damage", 0), "dps": _g(a, "dps", 0), "hazard": bool(a.get("hazard", false)), "rehitF": _g(a, "rehitF", 0), "lastHit": -1000000000, "hit": false, "lockF": _g(a, "lockF", 0),
		"tracking": a.get("tracking"), "warning": a.get("warning"), "phase": s["phaseId"]}
	s["nextId"] += 1
	if a.get("growTo") != null:
		inst["growTo"] = a["growTo"]
		inst["grow"] = a.get("grow")
		inst["r0"] = a.get("r0")
	s["attacks"].append(inst)
	_emit(s, evs, "telegraph", {"id": inst["id"], "attack": a["id"], "owner": a["owner"], "windup": J.r4(float(a["windupF"]) / FPS), "active": J.r4(float(a["activeF"]) / FPS), "zone": inst["zone"], "warning": inst["warning"], "hazard": inst["hazard"]})
	return inst


static func _owner_alive(s: Dictionary, id) -> bool:
	return id == "body" or (s["parts"].has(id) and s["parts"][id]["alive"])


static func _cond_ok(def: Dictionary, s: Dictionary, a: Dictionary, owner, target: Dictionary) -> bool:
	var c = a.get("requires")
	if c == null:
		c = {}
	var op: Array = owner_pos(def, owner)
	var d: float = _hyp(target["pos"][0] - op[0], target["pos"][2] - op[2])
	if a.get("minDist") != null and d < a["minDist"]:
		return false
	if a.get("maxDist") != null and d > a["maxDist"]:
		return false
	for id in c.get("partsAlive", []):
		if not (s["parts"].has(id) and s["parts"][id]["alive"]):
			return false
	for id in c.get("partsDead", []):
		if s["parts"].has(id) and s["parts"][id]["alive"]:
			return false
	if c.get("hpBelow") != null and hp_frac(def, s) > c["hpBelow"]:
		return false
	if c.get("hpAbove") != null and hp_frac(def, s) < c["hpAbove"]:
		return false
	if c.get("enraged") != null and bool(c["enraged"]) != s["enraged"]:
		return false
	if c.get("flag") != null and c["flag"] != "" and not bool(s["flags"].get(c["flag"], false)):
		return false
	return true


static func _start_attack(def: Dictionary, s: Dictionary, evs: Array, ph: Dictionary, a: Dictionary, target: Dictionary) -> void:
	var owner = a["part"] if (a.get("part") != null and a["part"] != "") else "body"
	var op: Array = owner_pos(def, owner)
	var aim: float = FD.fatan2(target["pos"][2] - op[2], target["pos"][0] - op[0])
	var sp: float = _speed(s)
	var zone: Dictionary = resolve_zone(a["zone"], op, target["pos"], aim)
	var lock_f: int = F(float(_g(a["zone"], "lockFrac", 0)) * float(_g(a, "windup", 1)) * s["enrage"]["windup"])
	_launch(def, s, evs, {"id": a["id"], "owner": owner, "windupF": F(float(_g(a, "windup", 1)) * s["enrage"]["windup"]), "activeF": maxi(1, F(float(_g(a, "active", 0.2)) / sp)), "recoveryF": F(float(_g(a, "recovery", 1)) / sp), "zone": zone,
		"damage": float(_g(a, "damage", 10)) * s["enrage"]["damage"], "dps": float(_g(a, "dps", 0)) * s["enrage"]["damage"], "rehitF": F(_g(a, "rehit", 0)), "lockF": lock_f, "tracking": {"spec": a["zone"], "owner": op} if lock_f > 0 else null, "warning": a.get("warning")})
	s["cd"][str(ph["id"]) + "/" + str(a["id"])] = s["frame"] + F(float(_g(a, "cooldown", 3)) / sp)


static func _pick_attack(def: Dictionary, s: Dictionary, ph: Dictionary, target: Dictionary) -> Variant:
	var conc: int = 0
	for a in s["attacks"]:
		if a["stage"] != "done" and not a["hazard"]:
			conc += 1
	if conc >= int(_g(ph, "maxConcurrent", 1)):
		return null
	var el: Array = []
	for a in ph.get("attacks", []):
		var owner = a["part"] if (a.get("part") != null and a["part"] != "") else "body"
		if not _owner_alive(s, owner) or part_stunned(s, owner):
			continue
		var busy: bool = false
		for x in s["attacks"]:
			if x["owner"] == owner and x["stage"] != "done":
				busy = true
				break
		if busy:
			continue
		if s["cd"].get(str(ph["id"]) + "/" + str(a["id"]), 0) > s["frame"] or not _cond_ok(def, s, a, owner, target):
			continue
		el.append(a)
	if el.is_empty():
		return null
	var tot: float = 0.0
	for a in el:
		tot += float(_g(a, "weight", 1))
	var r: float = J.rng_next(s) * tot
	for a in el:
		r -= float(_g(a, "weight", 1))
		if r < 0.0:
			return a
	return el[el.size() - 1]


static func _step_attacks(def: Dictionary, s: Dictionary, evs: Array, target: Dictionary) -> float:
	var damage: float = 0.0
	var p: Array = target["pos"]
	for a in s["attacks"]:
		if a["stage"] == "done":
			continue
		a["t"] += 1
		if a["tracking"] != null and a["stage"] == "windup":
			if a["t"] <= a["lockF"]:
				var op: Array = a["tracking"]["owner"]
				a["zone"] = resolve_zone(a["tracking"]["spec"], op, p, FD.fatan2(p[2] - op[2], p[0] - op[0]))
			else:
				a["tracking"] = null
				_emit(s, evs, "lock", {"id": a["id"], "attack": a["attack"]})
		if a["stage"] == "windup" and a["t"] >= a["windupF"]:
			a["stage"] = "active"
			a["t"] = 0
			_emit(s, evs, "active", {"id": a["id"], "attack": a["attack"], "owner": a["owner"]})
		elif a["stage"] == "active":
			if a.has("growTo") and a["grow"] != null and a["grow"] != 0:
				var k: float = minf(1.0, float(a["t"]) / float(a["grow"]))
				var nr: float = J.r4(a["r0"] + (a["growTo"] - a["r0"]) * k)
				a["zone"]["r"] = nr
				a["zone"]["rOuter"] = nr
			var inv: bool = bool(target.get("invulnerable", false))
			var t0: float = float(a["t"] - 1) / float(a["activeF"])
			var t1: float = minf(1.0, float(a["t"]) / float(a["activeF"]))
			if not inv and zone_contains(a["zone"], p, float(_g(target, "radius", 0.4)), t0, t1):
				var kind: String = "hazard" if a["hazard"] else "attack"
				if a["dps"] != 0:
					var d: float = a["dps"] * DT
					damage += d
					if s["frame"] % 30 == 0:
						_emit(s, evs, "damage", {"amount": J.r4(d * 30.0), "source": a["attack"], "owner": a["owner"], "kind": kind})
				elif (not a["hit"]) or (a["rehitF"] != 0 and s["frame"] - a["lastHit"] >= a["rehitF"]):
					a["hit"] = true
					a["lastHit"] = s["frame"]
					damage += a["damage"]
					_emit(s, evs, "damage", {"amount": J.r4(a["damage"]), "source": a["attack"], "owner": a["owner"], "kind": kind})
			if a["t"] >= a["activeF"]:
				a["stage"] = "recovery" if a["recoveryF"] > 0 else "done"
				a["t"] = 0
				_emit(s, evs, "attackEnd" if a["stage"] == "done" else "recovery", {"id": a["id"], "attack": a["attack"], "owner": a["owner"], "hit": a["hit"]})
		elif a["stage"] == "recovery" and a["t"] >= a["recoveryF"]:
			a["stage"] = "done"
			_emit(s, evs, "attackEnd", {"id": a["id"], "attack": a["attack"], "owner": a["owner"], "hit": a["hit"]})
	if s["attacks"].size() > 64 or s["frame"] % 120 == 0:
		var keep: Array = []
		for a in s["attacks"]:
			if a["stage"] != "done":
				keep.append(a)
		s["attacks"] = keep
	return damage


# ---------------------------------------------------------------- phases
static func _phase_ready(def: Dictionary, s: Dictionary, ph: Dictionary) -> bool:
	var e = ph.get("enter")
	if e == null:
		return false
	if e.get("hpBelow") != null and hp_frac(def, s) <= e["hpBelow"]:
		return true
	if e.get("totalHpBelow") != null and total_hp_frac(def, s) <= e["totalHpBelow"]:
		return true
	if e.get("time") != null and s["frame"] >= F(e["time"]):
		return true
	if e.get("partsDown") != null and s["partsDown"] >= e["partsDown"]:
		return true
	if e.get("phaseSeconds") != null and s["phaseFrame"] >= F(e["phaseSeconds"]):
		return true
	if e.get("flag") != null and e["flag"] != "" and bool(s["flags"].get(e["flag"], false)):
		return true
	return false


static func _enter_phase(def: Dictionary, s: Dictionary, evs: Array, idx: int) -> void:
	var ph: Dictionary = def["phases"][idx]
	s["phaseIdx"] = idx
	s["phaseId"] = ph["id"]
	s["phaseFrame"] = 0
	s["firedAdds"] = {}
	_emit(s, evs, "phase", {"phase": ph["id"], "index": idx, "music": ph["music"] if (ph.get("music") != null and ph["music"] != "") else null, "camera": ph["camera"] if (ph.get("camera") != null and ph["camera"] != "") else null})
	var t = ph.get("transition")
	if t == null:
		t = {}
	if t.get("invuln") != null and t["invuln"] != 0:
		s["invulnUntil"] = s["frame"] + F(t["invuln"])
	if t.get("heal") != null and t["heal"] != 0:
		s["hp"] = minf(float(core_hp(def)), s["hp"] + t["heal"] * core_hp(def))
		_emit(s, evs, "heal", {"frac": t["heal"]})
	if t.get("clearAttacks") != false:
		for a in s["attacks"]:
			if not a["hazard"] and a["stage"] != "done":
				a["stage"] = "done"
				_emit(s, evs, "cancel", {"attack": a["attack"], "owner": a["owner"], "id": a["id"]})
	for id in ph.get("reviveParts", []):
		var ps = s["parts"].get(id)
		var p = _find_part(def, id)
		if ps != null and not ps["alive"] and p != null:
			ps["alive"] = true
			ps["hp"] = p["hp"]
			ps["regrowAt"] = -1
			s["partsDown"] = maxi(0, s["partsDown"] - 1)
			_emit(s, evs, "regrow", {"part": id, "why": "phase"})
	s["cd"] = {}
	s["nextStartF"] = s["frame"] + F(_g(t, "invuln", 0)) + F(_g(ph, "openingDelay", 1))


static func _check_enrage(def: Dictionary, s: Dictionary, evs: Array) -> void:
	var e = def.get("enrage")
	if e == null or s["enraged"]:
		return
	var hit: bool = false
	if e.get("afterSeconds") != null and s["frame"] >= F(e["afterSeconds"]):
		hit = true
	elif e.get("hpBelow") != null and hp_frac(def, s) <= e["hpBelow"]:
		hit = true
	elif e.get("phase") != null and e["phase"] != "" and s["phaseId"] == e["phase"]:
		hit = true
	if hit:
		s["enraged"] = true
		s["enrage"] = {"speed": float(_g(e, "speedMult", 1.2)), "damage": float(_g(e, "damageMult", 1.2)), "windup": float(_g(e, "windupMult", 1))}
		_emit(s, evs, "enrage", {"cause": "rule", "speed": s["enrage"]["speed"], "damage": s["enrage"]["damage"]})


## One fixed step. input = {"target": {"pos": [x,y,z], "invulnerable": bool, "resisting": bool, "radius": float}, "hits": [{part, damage, weak}], "commands": [...], "flags": {...}}
static func step(s: Dictionary, def: Dictionary, input: Dictionary) -> Dictionary:
	var evs: Array = []
	var target: Dictionary = input["target"]
	s["frame"] += 1
	s["phaseFrame"] += 1
	if s["defeated"]:
		return {"events": evs, "force": [0.0, 0.0, 0.0], "playerDamage": 0.0, "done": true}
	if input.get("flags") != null:
		for k in input["flags"].keys():
			s["flags"][k] = bool(input["flags"][k])
	for c in input.get("commands", []):
		_apply_command(def, s, evs, c)
	for h in input.get("hits", []):
		_apply_hit(def, s, evs, h)
	if s["defeated"]:
		return {"events": evs, "force": [0.0, 0.0, 0.0], "playerDamage": 0.0, "done": true}
	for p in _parts(def):
		var ps: Dictionary = s["parts"][p["id"]]
		if ps["alive"] or ps["regrowAt"] < 0:
			continue
		var rg = p.get("regrow")
		if rg != null and rg.get("blockedBy") != null and rg["blockedBy"] != "" and bool(s["flags"].get(rg["blockedBy"], false)):
			ps["regrowAt"] += 1
			continue
		if s["frame"] >= ps["regrowAt"]:
			ps["alive"] = true
			ps["hp"] = p["hp"] * float(_g(rg, "hpFrac", 1))
			ps["regrowAt"] = -1
			ps["severed"] = false
			s["partsDown"] -= 1
			_emit(s, evs, "regrow", {"part": p["id"], "why": "timer"})
	for p in _parts(def):
		var stg = p.get("stagger")
		if stg != null and s["parts"][p["id"]]["stagger"] > 0:
			s["parts"][p["id"]]["stagger"] = maxf(0.0, s["parts"][p["id"]]["stagger"] - float(_g(stg, "decayPerSec", 0)) * DT)
	_check_enrage(def, s, evs)
	var phs: Array = def["phases"]
	if s["phaseIdx"] + 1 < phs.size() and _phase_ready(def, s, phs[s["phaseIdx"] + 1]):
		_enter_phase(def, s, evs, s["phaseIdx"] + 1)
	var ph: Dictionary = phs[s["phaseIdx"]]
	var adds: Array = ph.get("adds", [])
	for i in adds.size():
		if not s["firedAdds"].has(i) and s["phaseFrame"] >= F(_g(adds[i], "at", 0)):
			s["firedAdds"][i] = true
			_spawn_adds(def, s, evs, adds[i], "schedule")
	var hz: Dictionary = _step_hazards(def, s, evs, target)
	var exclusive_busy: bool = false
	if bool(ph.get("exclusive", false)):
		for a in s["attacks"]:
			if a["stage"] == "active" and not a["hazard"]:
				exclusive_busy = true
				break
	if s["frame"] >= s["nextStartF"] and s["frame"] >= s["invulnUntil"] and not exclusive_busy:
		var a = _pick_attack(def, s, ph, target)
		if a != null:
			_start_attack(def, s, evs, ph, a, target)
			var gp = ph.get("gap")
			var g: float
			if gp is Array:
				g = float(gp[0]) + J.rng_next(s) * (float(gp[1]) - float(gp[0]))
			else:
				g = float(gp) if gp != null else 1.5
			s["nextStartF"] = s["frame"] + F(g / _speed(s))
	var damage: float = _step_attacks(def, s, evs, target)
	if hz["damage"] != 0:
		damage += hz["damage"]
		if s["frame"] % 30 == 0:
			_emit(s, evs, "damage", {"amount": J.r4(hz["damage"] * 30.0), "source": "hazard", "owner": "hazard", "kind": "hazard"})
	var live: int = 0
	for a in s["attacks"]:
		if a["stage"] == "windup" or a["stage"] == "active":
			live += 1
	if live > s["stats"]["maxThreats"]:
		s["stats"]["maxThreats"] = live
	return {"events": evs, "force": hz["force"], "playerDamage": J.r4(damage), "done": s["defeated"]}


# ---------------------------------------------------------------- bot + simulation
static func _dirs() -> Array:
	var out: Array = []
	for i in 16:
		out.append([FD.fcos((float(i) * TAU) / 16.0), FD.fsin((float(i) * TAU) / 16.0)])
	return out


static func _mk_bot(def: Dictionary, prof: Dictionary, seed: int) -> Dictionary:
	var arn = def.get("arena")
	var r: int = ((seed & 0xFFFFFFFF) ^ 0x9e3779b9) & 0xFFFFFFFF
	return {"pos": [0.0, 0.0, float(_g(arn, "radius", 10)) * 0.75], "hp": prof["hp"], "dashReady": 0, "iframeUntil": 0, "atkReady": 0, "ignore": {}, "rng": r if r != 0 else 7, "platform": null, "force": [0.0, 0.0, 0.0], "goal": null, "skill": 0.0}


static func _threats(def: Dictionary, s: Dictionary, f: int, react_f: int, bot: Dictionary) -> Array:
	var out: Array = []
	for a in s["attacks"]:
		if a["stage"] != "windup" and a["stage"] != "active":
			continue
		var extra: int = maxi(0, a["lockF"] - (f - a["f0"])) if a["tracking"] != null else 0
		if f - a["f0"] < react_f + extra:
			continue
		if not bot["ignore"].has(a["id"]):
			bot["ignore"][a["id"]] = 0 if J.rng_next(bot) < bot["skill"] else 1
		if bot["ignore"][a["id"]] != 0:
			continue
		out.append(a)
	return out


static func _in_danger(zs: Array, p: Array, pad: float) -> bool:
	for a in zs:
		if zone_contains(a["zone"], p, pad):
			return true
	return false


static func _in_arena(def: Dictionary, p: Array, m: float) -> bool:
	var c = def.get("pos")
	var cx: float = float(c[0]) if (c != null and c[0] != null) else 0.0
	var cz: float = float(c[2]) if (c != null and c[2] != null) else 0.0
	return _hyp(p[0] - cx, p[2] - cz) <= float(_g(def.get("arena"), "radius", 10)) - m


static func bot_decide(def: Dictionary, s: Dictionary, bot: Dictionary, prof: Dictionary, hits_out: Array, dirs: Array) -> void:
	var f: int = s["frame"]
	var react_f: int = F(float(prof["reactionMs"]) / 1000.0)
	var pad: float = float(prof["radius"]) + 0.25
	var ms: float = float(prof["moveSpeed"]) * DT
	var p: Array = bot["pos"]
	var zs: Array = _threats(def, s, f, react_f, bot)
	var escape_to = null
	var fl = null
	for h in def.get("hazards", []):
		if h["kind"] == "flood" and hazard_active(s, h["id"]):
			fl = h
			break
	var arn = def.get("arena")
	var plats = arn.get("platforms") if arn != null else null
	if fl != null and plats != null and not plats.is_empty():
		var lvl: float = s["hazards"][fl["id"]]["level"]
		if p[1] < lvl + 0.4 or bot["platform"] != null:
			var best_pl = null
			for pl in plats:
				if pl["y"] >= fl["toY"] and (best_pl == null or _hyp(pl["center"][0] - p[0], pl["center"][2] - p[2]) < _hyp(best_pl["center"][0] - p[0], best_pl["center"][2] - p[2])):
					best_pl = pl
			if best_pl != null:
				escape_to = [best_pl["center"][0], 0.0, best_pl["center"][2]]
				if _hyp(p[0] - best_pl["center"][0], p[2] - best_pl["center"][2]) <= best_pl["radius"]:
					bot["platform"] = best_pl
					p[1] = best_pl["y"]
	elif bot["platform"] != null:
		bot["platform"] = null
		p[1] = 0.0
	if zs.size() > 0 and _in_danger(zs, p, pad):
		var best = null
		var bd: float = 1e9
		for d in [1.0, 2.0, 3.0, 4.5, 6.0, 8.0, 10.0]:
			for v in dirs:
				var c: Array = [p[0] + v[0] * d, p[1], p[2] + v[1] * d]
				if not _in_arena(def, c, 0.5) or _in_danger(zs, c, pad + 0.2):
					continue
				if d < bd:
					bd = d
					best = c
			if best != null:
				break
		var tta: float = 1e9
		for a in zs:
			var left: float = float(a["windupF"] - a["t"]) if a["stage"] == "windup" else 0.0
			tta = minf(tta, left)
		if best != null:
			var walkable: bool = bd <= tta * ms + 0.01
			var dash_ok: bool = f >= bot["dashReady"]
			if not walkable and dash_ok and (bd <= prof["dodgeDistance"] or tta <= F(float(prof["iframeMs"]) / 2000.0)):
				var ux: float = (best[0] - p[0]) / bd
				var uz: float = (best[2] - p[2]) / bd
				var dd: float = minf(float(prof["dodgeDistance"]), bd + 0.3)
				p[0] += ux * dd
				p[2] += uz * dd
				bot["iframeUntil"] = f + F(float(prof["iframeMs"]) / 1000.0)
				bot["dashReady"] = f + F(float(prof["dodgeCooldownMs"]) / 1000.0)
			else:
				escape_to = best
		elif f >= bot["dashReady"] and tta <= F(float(prof["iframeMs"]) / 2000.0):
			bot["iframeUntil"] = f + F(float(prof["iframeMs"]) / 1000.0)
			bot["dashReady"] = f + F(float(prof["dodgeCooldownMs"]) / 1000.0)
	if escape_to != null:
		var dx: float = escape_to[0] - p[0]
		var dz: float = escape_to[2] - p[2]
		var d2: float = _hyp(dx, dz)
		if d2 == 0.0:
			d2 = 1.0
		var m: float = minf(ms, d2)
		p[0] += (dx / d2) * m
		p[2] += (dz / d2) * m
		return
	var tgt = null
	var td: float = 1e9
	var weak: bool = false
	var cands: Array = []
	for x in _parts(def):
		if s["parts"][x["id"]]["alive"]:
			cands.append({"id": x["id"], "pos": owner_pos(def, x["id"]), "w": weak_open(def, s, x["id"]), "r": _g(x, "radius", 1)})
	if core_exposed(def, s):
		cands.append({"id": "core", "pos": owner_pos(def, "body"), "w": false, "r": _g(def.get("core"), "radius", 1.5)})
	var aware: bool = J.rng_next(bot) < float(prof["weakAwareness"])
	for c in cands:
		var dist: float = _hyp(c["pos"][0] - p[0], c["pos"][2] - p[2]) - (1000.0 if (aware and c["w"]) else 0.0)
		if dist < td:
			td = dist
			tgt = c
			weak = aware and c["w"]
	if tgt == null:
		tgt = {"id": "core", "pos": owner_pos(def, "body"), "w": false, "r": 1.5, "hold": true}
	var dx2: float = tgt["pos"][0] - p[0]
	var dz2: float = tgt["pos"][2] - p[2]
	var dd2: float = _hyp(dx2, dz2)
	var reach: float = float(prof["range"]) + float(tgt["r"])
	if dd2 > reach * 0.85:
		var m2: float = minf(ms, dd2 - reach * 0.8)
		var np: Array = [p[0] + (dx2 / dd2) * m2, p[1], p[2] + (dz2 / dd2) * m2]
		if not _in_danger(zs, np, pad + 0.1) and _in_arena(def, np, 0.3):
			p[0] = np[0]
			p[2] = np[2]
	if dd2 <= reach and f >= bot["atkReady"] and not tgt.has("hold") and (tgt["id"] != "core" or core_exposed(def, s)):
		bot["atkReady"] = f + F(float(prof["attackIntervalMs"]) / 1000.0)
		hits_out.append({"part": tgt["id"], "damage": prof["attackDamage"], "weak": weak})


static func _merge_profile(profile) -> Dictionary:
	var prof: Dictionary = DEFAULT_PROFILE.duplicate()
	if profile != null:
		for k in profile.keys():
			prof[k] = profile[k]
	return prof


static func run_fight(def: Dictionary, o: Dictionary = {}) -> Dictionary:
	var seed: int = int(_g(o, "seed", 1))
	var prof: Dictionary = _merge_profile(o.get("profile"))
	var max_seconds = _g(o, "maxSeconds", 300)
	var s: Dictionary = create_boss(def, seed)
	var bot: Dictionary = _mk_bot(def, prof, seed)
	bot["skill"] = float(prof["dodgeSkill"])
	var dirs: Array = _dirs()
	var phase_start: Dictionary = {s["phaseId"]: 0}
	var phase_times: Dictionary = {}
	var launches: Dictionary = {}
	var hits: Dictionary = {}
	var damage_taken: float = 0.0
	var lost: bool = false
	var dmg_by_kind: Dictionary = {"attack": 0.0, "hazard": 0.0}
	var cause = null
	var force: Array = [0.0, 0.0, 0.0]
	var max_f: int = F(max_seconds)
	var prev_phase = s["phaseId"]
	var move_speed: float = float(prof["moveSpeed"])
	while s["frame"] < max_f and not s["defeated"]:
		var fm: float = _hyp(force[0], force[2])
		if fm > 1e-9:
			var cnt: float = minf(fm * DT, move_speed * DT * 0.6)
			var k: float = 1.0 - cnt / (fm * DT)
			bot["pos"][0] += force[0] * DT * k
			bot["pos"][2] += force[2] * DT * k
		var hits_out: Array = []
		bot_decide(def, s, bot, prof, hits_out, dirs)
		var r: Dictionary = step(s, def, {"target": {"pos": bot["pos"], "invulnerable": s["frame"] < bot["iframeUntil"], "radius": prof["radius"], "resisting": false}, "hits": hits_out})
		force = r["force"]
		for e in r["events"]:
			var et: String = e["type"]
			if et == "telegraph" and not e["hazard"]:
				launches[e["attack"]] = launches.get(e["attack"], 0) + 1
			if et == "phase":
				phase_times[prev_phase] = J.r4(float(s["frame"] - phase_start[prev_phase]) / FPS)
				phase_start[e["phase"]] = s["frame"]
				prev_phase = e["phase"]
			if et == "damage":
				dmg_by_kind[e["kind"]] += e["amount"]
				if e["kind"] == "attack":
					hits[e["source"]] = hits.get(e["source"], 0) + 1
		if r["playerDamage"] > 0:
			bot["hp"] -= r["playerDamage"]
			damage_taken += r["playerDamage"]
			var cs = "hazard"
			for a in s["attacks"]:
				if a["stage"] == "active":
					cs = a["attack"] if (a["attack"] != null and a["attack"] != "") else "hazard"
					break
			cause = cs
		if bot["hp"] <= 0:
			lost = true
			break
	phase_times[prev_phase] = J.r4(float(s["frame"] - phase_start[prev_phase]) / FPS)
	var res: Dictionary = {"seed": seed, "won": s["defeated"], "died": lost, "timeSeconds": J.r4(float(s["frame"]) / FPS), "damageTaken": J.r4(damage_taken), "damageByKind": {"attack": J.r4(dmg_by_kind["attack"]), "hazard": J.r4(dmg_by_kind["hazard"])},
		"hpLeft": J.r4(maxf(0.0, bot["hp"])), "phaseTimes": phase_times, "launches": launches, "hits": hits, "maxThreats": s["stats"]["maxThreats"], "finalPhase": s["phaseId"], "killedBy": cause if lost else null,
		"logHash": J.hash_json(s["log"]), "events": s["log"].size()}
	if bool(o.get("log", false)):
		res["log"] = s["log"]
	return res


static func _pct(arr: Array, q: float) -> Variant:
	if arr.is_empty():
		return null
	var a: Array = arr.duplicate()
	a.sort()
	return J.r4(a[mini(a.size() - 1, int(floorf(q * a.size())))])


static func _mean(a: Array) -> Variant:
	if a.is_empty():
		return null
	var t: float = 0.0
	for x in a:
		t = t + x
	return J.r4(t / a.size())


static func simulate(def: Dictionary, o: Dictionary = {}) -> Dictionary:
	var runs: int = int(_g(o, "runs", 20))
	var seed: int = int(_g(o, "seed", 1))
	var results: Array = []
	for i in runs:
		results.append(run_fight(def, {"seed": seed + i * 7919, "profile": o.get("profile"), "maxSeconds": _g(o, "maxSeconds", 300)}))
	var wins: Array = []
	var died: int = 0
	var timeouts: int = 0
	for r in results:
		if r["won"]:
			wins.append(r)
		if r["died"]:
			died += 1
		if not r["won"] and not r["died"]:
			timeouts += 1
	var phases: Dictionary = {}
	for r in results:
		for k in r["phaseTimes"].keys():
			if not phases.has(k):
				phases[k] = []
			phases[k].append(r["phaseTimes"][k])
	var launches: Dictionary = {}
	var hits: Dictionary = {}
	for r in results:
		for k in r["launches"].keys():
			launches[k] = launches.get(k, 0) + r["launches"][k]
		for k in r["hits"].keys():
			hits[k] = hits.get(k, 0) + r["hits"][k]
	var deaths: Dictionary = {}
	for r in results:
		if r["killedBy"] != null:
			deaths[r["killedBy"]] = deaths.get(r["killedBy"], 0) + 1
	var win_times: Array = []
	for r in wins:
		win_times.append(r["timeSeconds"])
	var dts: Array = []
	var maxdt: float = -INF
	var mt: int = 0
	for r in results:
		dts.append(r["damageTaken"])
		maxdt = maxf(maxdt, r["damageTaken"])
		mt = maxi(mt, r["maxThreats"])
	var phase_seconds: Dictionary = {}
	for k in phases.keys():
		phase_seconds[k] = _mean(phases[k])
	var hash_in: Array = []
	var slim: Array = []
	for r in results:
		hash_in.append([r["seed"], r["won"], r["timeSeconds"], r["damageTaken"], r["logHash"]])
		slim.append({"seed": r["seed"], "won": r["won"], "died": r["died"], "timeSeconds": r["timeSeconds"], "damageTaken": r["damageTaken"], "logHash": r["logHash"]})
	return {"runs": runs, "winRate": J.r4(float(wins.size()) / float(runs)), "deathRate": J.r4(float(died) / float(runs)), "timeoutRate": J.r4(float(timeouts) / float(runs)),
		"timeToKill": {"mean": _mean(win_times), "median": _pct(win_times, 0.5), "p90": _pct(win_times, 0.9)}, "damageTaken": {"mean": _mean(dts), "p90": _pct(dts, 0.9), "max": J.r4(maxdt)},
		"phaseSeconds": phase_seconds, "attackLaunches": launches, "attackHits": hits, "killedBy": deaths, "maxThreats": mt, "hash": J.hash_json(hash_in), "results": slim}

extends RefCounted
## animgraph core: pure, deterministic stepper for the anim-graph JSON (spec/v4/anim-graph.md). No AnimationPlayer/AnimationTree.
## Port of AnimGraph in templates/web-project/src/lib/anim-graph.js: parameters, 1D blend spaces, transitions (crossfade,
## exitTime, interrupt), layers, events, root motion deltas. Float64 math with plain Arrays (no Vector3/Quaternion).
## clips = {name: {duration: float, root: Callable(t_seconds) -> {p:[x,y,z], q:[x,y,z,w]} (optional), events: [] (optional)}}
## var g = load(".../animgraph_core.gd").new(); g.setup(graph_dict, clips); g.set_param("speed", 2.0); var r = g.step();
## r = {events:[{name,layer,state,t,data?}], transitions:[{layer,from,to}], rootMotion:{x,y,z,yaw}, time}

const FIXED_DT: float = 1.0 / 60.0
const EPS: float = 1e-9

var graph: Dictionary = {}
var clips: Dictionary = {}
var dt: float = FIXED_DT
var params: Dictionary = {}
var time: float = 0.0
var frame: int = 0
## each: {def, cur:{state,p,fresh}, prev:{state,p}|null, fade, fadeLen}
var layers: Array = []


# ---------- quaternion helpers ([x,y,z,w]) ----------
static func qmul(a: Array, b: Array) -> Array:
	return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]


static func qconj(q: Array) -> Array:
	return [-q[0], -q[1], -q[2], q[3]]


static func qrot(q: Array, v: Array) -> Array:
	var r: Array = qmul(qmul(q, [v[0], v[1], v[2], 0.0]), qconj(q))
	return [r[0], r[1], r[2]]


static func qyaw(a: float) -> Array:
	return [0.0, sin(a / 2.0), 0.0, cos(a / 2.0)]


## Heading change (radians about +Y) of a rotation: angle of its +Z axis projected on XZ.
static func yaw_of(q: Array) -> float:
	var f: Array = qrot(q, [0.0, 0.0, 1.0])
	return atan2(f[0], f[2])


static func norm_name(s: String) -> String:
	var out: String = ""
	for ch: String in s.to_lower():
		if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9"):
			out += ch
	return out


# ---------- graph helpers ----------
## Blend-space weights at the param value: [{clip, w}] (1 or 2 entries, ascending by `at`).
static func blend_weights(state: Dictionary, prm: Dictionary) -> Array:
	var pts: Array = (state["blend"]["points"] as Array).duplicate()
	pts.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a["at"] < b["at"])
	var x: float = float(prm.get(state["blend"]["param"], 0.0))
	if x <= pts[0]["at"] or pts.size() == 1:
		return [{"clip": pts[0]["clip"], "w": 1.0}]
	var last: Dictionary = pts[pts.size() - 1]
	if x >= last["at"]:
		return [{"clip": last["clip"], "w": 1.0}]
	var i: int = 0
	while pts[i + 1]["at"] < x:
		i += 1
	var a: Dictionary = pts[i]
	var b: Dictionary = pts[i + 1]
	var den: float = float(b["at"]) - float(a["at"])
	if den == 0.0:
		den = 1.0
	var u: float = (x - float(a["at"])) / den
	if u <= 0.0:
		return [{"clip": a["clip"], "w": 1.0}]
	if u >= 1.0:
		return [{"clip": b["clip"], "w": 1.0}]
	return [{"clip": a["clip"], "w": 1.0 - u}, {"clip": b["clip"], "w": u}]


static func default_params(g: Dictionary) -> Dictionary:
	var p: Dictionary = {}
	var defs: Dictionary = g.get("parameters", {})
	for k: String in defs:
		var d: Dictionary = defs[k]
		if d.has("default"):
			p[k] = d["default"] if (d["type"] == "float") else bool(d["default"])
		else:
			p[k] = 0.0 if d["type"] == "float" else false
	return p


## Reference checks (entry/transition/blend/param/clip existence). `clip_names` empty = skip clip existence. Returns error strings.
static func validate_refs(g: Dictionary, clip_names: Array = []) -> Array:
	var errs: Array = []
	var prm: Dictionary = g.get("parameters", {})
	if (g.get("layers", []) as Array).is_empty():
		errs.append("graph needs at least one layer")
	for L: Dictionary in g.get("layers", []):
		var st: Dictionary = L.get("states", {})
		if not st.has(L.get("entry", "")):
			errs.append("layer %s: entry is not a state" % L.get("name", "?"))
		for sn: String in st:
			var s: Dictionary = st[sn]
			var used: Array = []
			if s.has("clip"):
				used.append(s["clip"])
			if s.has("blend"):
				if not prm.has(s["blend"]["param"]):
					errs.append("%s.%s: blend.param not a parameter" % [L["name"], sn])
				for pt: Dictionary in s["blend"]["points"]:
					used.append(pt["clip"])
			for cn: String in used:
				if not clip_names.is_empty() and not clip_names.has(cn):
					errs.append("%s.%s: clip %s not found" % [L["name"], sn, cn])
		for t: Dictionary in L.get("transitions", []):
			if t["from"] != "*" and not st.has(t["from"]):
				errs.append("%s: transition from %s unknown" % [L["name"], t["from"]])
			if not st.has(t["to"]):
				errs.append("%s: transition to %s unknown" % [L["name"], t["to"]])
			for c: Dictionary in t.get("conditions", []):
				if not prm.has(c["param"]):
					errs.append("%s: condition param %s unknown" % [L["name"], c["param"]])
	return errs


# ---------- runtime ----------
func setup(g: Dictionary, clip_table: Dictionary, opts: Dictionary = {}) -> RefCounted:
	graph = g
	clips = clip_table
	dt = float(opts.get("dt", FIXED_DT))
	params = default_params(g)
	time = 0.0
	frame = 0
	layers = []
	for def: Dictionary in g.get("layers", []):
		layers.append({"def": def, "cur": _enter(def["entry"], 0.0), "prev": null, "fade": 0.0, "fadeLen": 0.0})
	for k: String in opts.get("params", {}):
		params[k] = opts["params"][k]
	return self


func _enter(state: String, p: float) -> Dictionary:
	return {"state": state, "p": p, "fresh": true}


func set_param(pname: String, v: Variant) -> RefCounted:
	var d: Variant = graph.get("parameters", {}).get(pname)
	if d == null:
		push_error("unknown parameter \"%s\"" % pname)
		return self
	params[pname] = bool(v) if (d["type"] == "bool" or d["type"] == "trigger") else float(v)
	return self


func set_trigger(pname: String) -> RefCounted:
	return set_param(pname, true)


func reset_trigger(pname: String) -> RefCounted:
	params[pname] = false
	return self


func state(layer: int = 0) -> String:
	return layers[layer]["cur"]["state"]


func _def(L: Dictionary, sname: String) -> Dictionary:
	return L["def"]["states"][sname]


func _clip_dur(cn: String) -> float:
	return float(clips[cn]["duration"]) if clips.has(cn) else 0.0


func _dur(s: Dictionary) -> float:
	if s.has("empty"):
		return 0.0
	if s.has("clip"):
		return _clip_dur(s["clip"])
	var acc: float = 0.0
	for x: Dictionary in blend_weights(s, params):
		acc += float(x["w"]) * _clip_dur(x["clip"])
	return acc


func _speed(s: Dictionary) -> float:
	return float(s.get("speed", 1.0)) * (float(params.get(s["speedParam"], 0.0)) if s.has("speedParam") else 1.0)


## Normalised phase 0..1 of a layer's current state (loops wrap, one-shots clamp at 1).
func phase(layer: int = 0) -> float:
	var L: Dictionary = layers[layer]
	var s: Dictionary = _def(L, L["cur"]["state"])
	var p: float = L["cur"]["p"]
	return minf(p, 1.0) if s.get("loop", true) == false else p - floor(p)


## Crossfade blend weight of the layer's current state (1 when not fading).
func weight_of(layer: int = 0) -> float:
	var L: Dictionary = layers[layer]
	return clampf(float(L["fade"]) / float(L["fadeLen"]), 0.0, 1.0) if (L["prev"] != null and L["fadeLen"] > 0.0) else 1.0


func layer_weight(layer: int = 0) -> float:
	var d: Dictionary = layers[layer]["def"]
	if d.has("weightParam"):
		return float(params.get(d["weightParam"], 0.0))
	return float(d.get("weight", 1.0))


func _cond(c: Dictionary) -> bool:
	var d: Dictionary = graph["parameters"][c["param"]]
	var v: Variant = params[c["param"]]
	var op: String = String(c.get("op", "=="))
	if d["type"] == "bool" or d["type"] == "trigger":
		var want: bool = bool(c["value"]) if c.has("value") else true
		return (bool(v) != want) if op == "!=" else (bool(v) == want)
	var x: float = float(c["value"])
	var fv: float = float(v)
	match op:
		"==":
			return fv == x
		"!=":
			return fv != x
		"<":
			return fv < x
		"<=":
			return fv <= x
		">":
			return fv > x
		">=":
			return fv >= x
	return false


func _transition(L: Dictionary, out: Array, li: int) -> void:
	var from: String = L["cur"]["state"]
	var fading: bool = L["prev"] != null
	for t: Dictionary in L["def"].get("transitions", []):
		if t["from"] != "*" and t["from"] != from:
			continue
		if t["to"] == from and not t.get("self", false):
			continue
		if fading and not t.get("interrupt", false):
			continue
		if t.has("exitTime"):
			if phase(li) < float(t["exitTime"]) - EPS:
				continue
		var ok: bool = true
		for c: Dictionary in t.get("conditions", []):
			if not _cond(c):
				ok = false
				break
		if not ok:
			continue
		for c: Dictionary in t.get("conditions", []):
			if graph["parameters"][c["param"]]["type"] == "trigger":
				params[c["param"]] = false
		var d: float = float(t.get("duration", 0.0))
		L["prev"] = {"state": from, "p": L["cur"]["p"]} if d > 0.0 else null
		L["fade"] = 0.0
		L["fadeLen"] = d if d > 0.0 else 0.0
		L["cur"] = _enter(t["to"], float(t.get("offset", 0.0)))
		out.append({"layer": L["def"]["name"], "from": from, "to": t["to"]})
		return


func _events(L: Dictionary, s: Dictionary, p0: float, p1: float, fresh: bool, out: Array) -> void:
	var dur: float = _dur(s)
	var raw: Array = (s.get("events", []) as Array).duplicate()
	if s.has("clip"):
		var ce: Variant = null
		if clips.has(s["clip"]) and clips[s["clip"]].has("events"):
			ce = clips[s["clip"]]["events"]
		elif graph.get("clips", {}).has(s["clip"]) and graph["clips"][s["clip"]].has("events"):
			ce = graph["clips"][s["clip"]]["events"]
		if ce != null:
			raw.append_array(ce)
	var evs: Array = []
	for e: Dictionary in raw:
		var at: float = 0.0
		if e.has("at"):
			at = float(e["at"])
		elif dur > 0.0:
			at = float(e["time"]) / dur
		evs.append({"name": e["name"], "at": at, "data": e.get("data")})
	var hits: Array = []
	var loop: bool = s.get("loop", true) != false
	var kmax: int = int(floor(p1)) if loop else 0
	for k in range(int(floor(p0)), kmax + 1):
		for i in evs.size():
			var pos: float = float(k) + evs[i]["at"]
			if (pos >= p0 if fresh else pos > p0) and pos <= p1:
				hits.append({"pos": pos, "i": i, "e": evs[i]})
	hits.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a["pos"] < b["pos"] or (a["pos"] == b["pos"] and a["i"] < b["i"]))
	for h: Dictionary in hits:
		var ev: Dictionary = {"name": h["e"]["name"], "layer": L["def"]["name"], "state": L["cur"]["state"], "t": floor(h["pos"] * 1e9 + 0.5) / 1e9}
		if h["e"]["data"] != null:
			ev["data"] = h["e"]["data"]
		out.append(ev)


func clip_mode(cn: String) -> String:
	var gc: Dictionary = graph.get("clips", {})
	if gc.has(cn) and gc[cn].has("rootMotion"):
		return gc[cn]["rootMotion"]
	return String(graph.get("rootMotion", {}).get("mode", "none"))


func _root_delta(s: Dictionary, p0: float, p1: float) -> Dictionary:
	var acc: Dictionary = {"x": 0.0, "y": 0.0, "z": 0.0, "yaw": 0.0}
	if s.has("empty"):
		return acc
	var items: Array = [{"clip": s["clip"], "w": 1.0}] if s.has("clip") else blend_weights(s, params)
	var loop: bool = s.get("loop", true) != false
	var rm: Dictionary = graph.get("rootMotion", {})
	var axes: String = String(rm.get("axes", "xz"))
	var use_yaw: bool = rm.get("yaw", false)
	for it: Dictionary in items:
		var c: Variant = clips.get(it["clip"])
		if c == null or not c.has("root") or clip_mode(it["clip"]) != "extract" or not (float(c["duration"]) > 0.0):
			continue
		var cd: float = c["duration"]
		var root: Callable = c["root"]
		var a: float = p0
		var end: float = p1 if loop else minf(p1, 1.0)
		if not loop:
			a = minf(a, 1.0)
		while a < end - 1e-12:
			var c0: float = floor(a + 1e-12) if loop else 0.0
			var nx: float = minf(end, (c0 + 1.0) if loop else 1.0)
			var r0: Dictionary = root.call((a - c0) * cd)
			var r1: Dictionary = root.call((nx - c0) * cd)
			acc["x"] += it["w"] * (r1["p"][0] - r0["p"][0])
			acc["y"] += it["w"] * (r1["p"][1] - r0["p"][1])
			acc["z"] += it["w"] * (r1["p"][2] - r0["p"][2])
			acc["yaw"] += it["w"] * yaw_of(qmul(r1["q"], qconj(r0["q"])))
			a = nx
	if axes == "xz":
		acc["y"] = 0.0
	if not use_yaw:
		acc["yaw"] = 0.0
	return acc


func _adv(inst: Dictionary, s: Dictionary, step_dt: float) -> Dictionary:
	var dur: float = _dur(s)
	var sp: float = _speed(s)
	var d: float = (step_dt * sp) / dur if dur > EPS else (1.0 if s.get("loop", true) == false else 0.0)
	var p0: float = inst["p"]
	var p1: float = p0 + d
	if s.get("loop", true) == false:
		p1 = minf(p1, 1.0)
	return {"p0": p0, "p1": p1}


func step(step_dt: float = -1.0) -> Dictionary:
	var sdt: float = dt if step_dt < 0.0 else step_dt
	var events: Array = []
	var transitions: Array = []
	var rm: Dictionary = {"x": 0.0, "y": 0.0, "z": 0.0, "yaw": 0.0}
	var rm_layer: int = int(graph.get("rootMotion", {}).get("layer", 0))
	for li in layers.size():
		var L: Dictionary = layers[li]
		_transition(L, transitions, li)
		var s: Dictionary = _def(L, L["cur"]["state"])
		var a: Dictionary = _adv(L["cur"], s, sdt)
		var p0: float = a["p0"]
		var p1: float = a["p1"]
		if not s.has("empty"):
			_events(L, s, p0, p1, L["cur"]["fresh"], events)
		if li == rm_layer:
			var wc: float = clampf((float(L["fade"]) + sdt) / float(L["fadeLen"]), 0.0, 1.0) if (L["prev"] != null and L["fadeLen"] > 0.0) else 1.0
			var dc: Dictionary = _root_delta(s, p0, p1)
			for k: String in rm:
				rm[k] += wc * dc[k]
			if L["prev"] != null and wc < 1.0:
				var ps: Dictionary = _def(L, L["prev"]["state"])
				var pa: Dictionary = _adv(L["prev"], ps, sdt)
				var dp: Dictionary = _root_delta(ps, pa["p0"], pa["p1"])
				for k: String in rm:
					rm[k] += (1.0 - wc) * dp[k]
		L["cur"]["p"] = p1
		L["cur"]["fresh"] = false
		if L["prev"] != null:
			var ps2: Dictionary = _def(L, L["prev"]["state"])
			var pa2: Dictionary = _adv(L["prev"], ps2, sdt)
			L["prev"]["p"] = pa2["p1"]
			L["fade"] = float(L["fade"]) + sdt
			if L["fade"] >= L["fadeLen"] - EPS:
				L["prev"] = null
				L["fade"] = 0.0
				L["fadeLen"] = 0.0
	frame += 1
	time = float(frame) * dt
	return {"events": events, "transitions": transitions, "rootMotion": rm, "time": time}


## Plain-data runtime state (restore with restore()).
func snapshot() -> Dictionary:
	var ls: Array = []
	for L: Dictionary in layers:
		ls.append({"cur": (L["cur"] as Dictionary).duplicate(true), "prev": (L["prev"] as Dictionary).duplicate(true) if L["prev"] != null else null, "fade": L["fade"], "fadeLen": L["fadeLen"]})
	return {"frame": frame, "params": params.duplicate(true), "layers": ls}


func restore(s: Dictionary) -> RefCounted:
	frame = int(s["frame"])
	time = float(frame) * dt
	params = (s["params"] as Dictionary).duplicate(true)
	for i in (s["layers"] as Array).size():
		var x: Dictionary = s["layers"][i]
		layers[i]["cur"] = (x["cur"] as Dictionary).duplicate(true)
		layers[i]["prev"] = (x["prev"] as Dictionary).duplicate(true) if x["prev"] != null else null
		layers[i]["fade"] = x["fade"]
		layers[i]["fadeLen"] = x["fadeLen"]
	return self

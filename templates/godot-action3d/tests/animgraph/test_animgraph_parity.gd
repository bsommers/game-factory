extends "res://tests/test_base.gd"
## Step-by-step parity of animgraph_core.gd against the JS AnimGraph (spec/v4/parity/animgraph/*.json): transitions, events,
## state/phase/weight samples, accumulated root motion and the final runtime snapshot.
const Core := preload("res://scripts/animgraph/animgraph_core.gd")
const TOL: float = 1e-9


static func parity_dir() -> String:
	var env: String = OS.get_environment("PARITY_DIR")
	if env != "":
		return env.path_join("animgraph")
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--parity="):
			return a.substr(9)
	return ProjectSettings.globalize_path("res://").path_join("../../spec/v4/parity/animgraph").simplify_path()


static func lerp_tab(tab: Array, t: float) -> Array:
	if t <= tab[0][0]:
		return (tab[0] as Array).slice(1)
	for i in range(1, tab.size()):
		if t <= tab[i][0]:
			var a: Array = tab[i - 1]
			var b: Array = tab[i]
			var den: float = float(b[0]) - float(a[0])
			if den == 0.0:
				den = 1.0
			var k: float = (t - float(a[0])) / den
			var out: Array = []
			for j in range(1, a.size()):
				out.append(float(a[j]) + (float(b[j]) - float(a[j])) * k)
			return out
	return (tab[tab.size() - 1] as Array).slice(1)


static func build_clips(spec: Dictionary) -> Dictionary:
	var out: Dictionary = {}
	for n: String in spec:
		var c: Dictionary = spec[n]
		out[n] = {"duration": float(c["duration"])}
		if c.has("root"):
			var r: Dictionary = c["root"]
			out[n]["root"] = func(t: float) -> Dictionary:
				var yaw: float = lerp_tab(r["yaw"], t)[0] if r.has("yaw") else 0.0
				return {"p": lerp_tab(r["pos"], t), "q": Core.qyaw(yaw)}
	return out


func _near(a: Variant, b: Variant, path: String, errs: Array) -> void:
	if (a is float or a is int) and (b is float or b is int):
		if absf(float(a) - float(b)) > TOL:
			errs.append("%s: %s != %s" % [path, a, b])
	elif a is Array and b is Array:
		if a.size() != b.size():
			errs.append("%s: length %d != %d" % [path, a.size(), b.size()])
		else:
			for i in a.size():
				_near(a[i], b[i], "%s[%d]" % [path, i], errs)
	elif a is Dictionary and b is Dictionary:
		for k: Variant in a:
			if not b.has(k):
				errs.append("%s.%s: extra key" % [path, k])
			else:
				_near(a[k], b[k], "%s.%s" % [path, k], errs)
		for k: Variant in b:
			if not a.has(k):
				errs.append("%s.%s: missing key" % [path, k])
	elif a != b:
		errs.append("%s: %s != %s" % [path, JSON.stringify(a), JSON.stringify(b)])


func _run(sc: Dictionary) -> Dictionary:
	var g: RefCounted = Core.new().setup(sc["graph"], build_clips(sc["clips"]))
	var script: Array = (sc.get("script", []) as Array).duplicate()
	script.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a["f"] < b["f"])
	var timeline: Array = []
	var samples: Array = []
	var total: Dictionary = {"x": 0.0, "y": 0.0, "z": 0.0, "yaw": 0.0}
	var si: int = 0
	var every: int = int(sc["sampleEvery"])
	for f in int(sc["frames"]):
		while si < script.size() and int(script[si]["f"]) <= f:
			for k: String in script[si].get("set", {}):
				g.set_param(k, script[si]["set"][k])
			for t: String in script[si].get("trigger", []):
				g.set_trigger(t)
			si += 1
		if f % every == 0:
			var st: Dictionary = {}
			var ph: Dictionary = {}
			var wt: Dictionary = {}
			for k in g.layers.size():
				var nm: String = g.layers[k]["def"]["name"]
				st[nm] = g.state(k)
				ph[nm] = g.phase(k)
				wt[nm] = g.weight_of(k)
			samples.append({"f": f, "states": st, "phase": ph, "weight": wt, "params": g.params.duplicate()})
		var r: Dictionary = g.step()
		for x: Dictionary in r["transitions"]:
			var e: Dictionary = x.duplicate()
			e["f"] = f + 1
			e["kind"] = "transition"
			timeline.append(e)
		for x: Dictionary in r["events"]:
			var e2: Dictionary = x.duplicate()
			e2["f"] = f + 1
			e2["kind"] = "event"
			timeline.append(e2)
		for k: String in total:
			total[k] += r["rootMotion"][k]
	return {"timeline": timeline, "samples": samples, "rootMotion": total, "final": g.snapshot()}


func _parity(name: String) -> void:
	var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(parity_dir().path_join(name + ".json")))
	check(d is Dictionary, "cannot read parity file %s in %s" % [name, parity_dir()])
	if not (d is Dictionary):
		return
	var got: Dictionary = _run(d)
	var exp: Dictionary = d["expected"]
	var errs: Array = []
	check(got["timeline"].size() == exp["timeline"].size(), "%s: timeline length %d != JS %d" % [name, got["timeline"].size(), exp["timeline"].size()])
	_near(got["timeline"], exp["timeline"], "timeline", errs)
	_near(got["samples"], exp["samples"], "samples", errs)
	_near(got["rootMotion"], exp["rootMotion"], "rootMotion", errs)
	_near(got["final"], exp["final"], "final", errs)
	for i in mini(errs.size(), 8):
		check(false, "%s: %s" % [name, errs[i]])
	if errs.size() > 8:
		check(false, "%s: ... %d mismatches total" % [name, errs.size()])


func test_humanoid_parity() -> void:
	_parity("humanoid")


func test_meshy_rootmotion_parity() -> void:
	_parity("meshy-rootmotion")


func test_stress_parity() -> void:
	_parity("stress")

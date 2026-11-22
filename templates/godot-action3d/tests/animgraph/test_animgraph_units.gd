extends "res://tests/test_base.gd"
## Behavioural checks of animgraph_core.gd that do not need the JS reference.
const Core := preload("res://scripts/animgraph/animgraph_core.gd")


func _graph() -> Dictionary:
	return {"version": 1, "parameters": {"speed": {"type": "float", "default": 0}, "hit": {"type": "trigger"}},
		"layers": [{"name": "base", "entry": "idle", "states": {"idle": {"clip": "Idle", "events": [{"name": "tick", "at": 0.5}]}, "hit": {"clip": "Hit", "loop": false, "events": [{"name": "start", "at": 0.0}]}},
			"transitions": [{"from": "idle", "to": "hit", "conditions": [{"param": "hit"}], "duration": 0.1}, {"from": "hit", "to": "idle", "exitTime": 1.0}]}]}


func test_trigger_consumed_and_events_fire_once() -> void:
	var g: RefCounted = Core.new().setup(_graph(), {"Idle": {"duration": 1.0}, "Hit": {"duration": 0.5}})
	var ticks: int = 0
	var starts: int = 0
	var trans: Array = []
	for f in 240:
		if f == 10:
			g.set_trigger("hit")
		var r: Dictionary = g.step()
		for e: Dictionary in r["events"]:
			if e["name"] == "tick":
				ticks += 1
			if e["name"] == "start":
				starts += 1
		for t: Dictionary in r["transitions"]:
			trans.append(t["from"] + ">" + t["to"])
	check(trans == ["idle>hit", "hit>idle"], "transitions %s" % [trans])
	check(starts == 1, "one-shot event at 0 fires once (got %d)" % starts)
	check(ticks >= 3, "loop events fire each cycle (got %d)" % ticks)
	check(g.params["hit"] == false, "trigger consumed")


func test_snapshot_restore_reproduces_future() -> void:
	var clips: Dictionary = {"Idle": {"duration": 1.0}, "Hit": {"duration": 0.5}}
	var a: RefCounted = Core.new().setup(_graph(), clips)
	for f in 20:
		if f == 5:
			a.set_trigger("hit")
		a.step()
	var snap: Dictionary = a.snapshot()
	var b: RefCounted = Core.new().setup(_graph(), clips).restore(snap)
	for f in 120:
		var ra: Dictionary = a.step()
		var rb: Dictionary = b.step()
		check(JSON.stringify(ra) == JSON.stringify(rb), "restored run diverged at +%d" % f)
		if JSON.stringify(ra) != JSON.stringify(rb):
			break


func test_blend_weights_and_validation() -> void:
	var st: Dictionary = {"blend": {"param": "speed", "points": [{"at": 4.0, "clip": "Run"}, {"at": 0.0, "clip": "Idle"}, {"at": 1.5, "clip": "Walk"}]}}
	var w: Array = Core.blend_weights(st, {"speed": 0.75})
	check(w.size() == 2 and w[0]["clip"] == "Idle" and absf(w[1]["w"] - 0.5) < 1e-12, "midpoint blend")
	check(Core.blend_weights(st, {"speed": 9.0}) == [{"clip": "Run", "w": 1.0}], "clamped at the top")
	var bad: Dictionary = _graph()
	bad["layers"][0]["transitions"][0]["to"] = "ghost"
	check(not Core.validate_refs(bad).is_empty(), "unknown transition target reported")
	check(Core.validate_refs(_graph(), ["Idle", "Hit"]).is_empty(), "valid graph passes")
	check(not Core.validate_refs(_graph(), ["Idle"]).is_empty(), "missing clip reported")

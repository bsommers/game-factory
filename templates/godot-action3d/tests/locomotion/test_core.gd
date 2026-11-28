extends "res://tests/test_base.gd"
## Pure-core behaviour checks (no scene, no physics): conventions, jump/dodge numbers, determinism.
const Loco := preload("res://scripts/locomotion/locomotion_core.gd")
const Cam := preload("res://scripts/camera/camera_core.gd")


func _settled(cfg: Dictionary = {}) -> RefCounted:
	var c := Loco.new(cfg)
	for i in 30:
		c.step({})
	return c


func test_yaw_zero_faces_minus_z() -> void:
	var c := _settled()
	for i in 60:
		c.step({"move": [0.0, 1.0]})
	check(c.pz < -3.0 and absf(c.px) < 1e-9, "forward at camYaw 0 must go -Z, got %s,%s" % [c.px, c.pz])
	check(absf(c.yaw) < 1e-9, "facing yaw stays 0")
	var d := _settled()
	for i in 60:
		d.step({"move": [0.0, 1.0], "camYaw": PI / 2.0})
	check(d.px < -3.0 and absf(d.pz) < 1e-6, "camYaw +90deg turns forward toward -X, got %s,%s" % [d.px, d.pz])


func test_state_ladder_and_speeds() -> void:
	var c := _settled()
	check(c.state == "idle", "idle at rest")
	var o: Dictionary = {}
	for i in 60:
		o = c.step({"move": [0.0, 1.0]})
	check(o.locomotionState == "run" and absf(o.speed - 5.2) < 1e-6, "run at 5.2 m/s, got %s %s" % [o.locomotionState, o.speed])
	for i in 60:
		o = c.step({"move": [0.0, 1.0], "sprint": true})
	check(o.locomotionState == "sprint" and absf(o.speed - 8.0) < 1e-6, "sprint at 8 m/s")


func test_jump_apex_and_events() -> void:
	var c := _settled()
	var evs: Array = []
	var apex: float = 0.0
	for i in 120:
		var o: Dictionary = c.step({"jump": i == 0, "jumpHeld": true})
		evs.append_array(o.events)
		apex = maxf(apex, o.pos[1])
	check("jump" in evs and "land" in evs, "jump and land events, got %s" % [evs])
	check(apex > 1.2 and apex < 2.0, "full jump apex about 1.5 m, got %s" % apex)
	var t := _settled()
	var tap: float = 0.0
	for i in 120:
		tap = maxf(tap, t.step({"jump": i == 0, "jumpHeld": false}).pos[1])
	check(tap < apex * 0.5, "tap jump is lower (variable height): %s vs %s" % [tap, apex])


func test_dodge_distance_exact() -> void:
	var c := _settled()
	var z0: float = c.pz
	var inv_frames: int = 0
	var dist: float = -1.0
	for i in 40:
		var o: Dictionary = c.step({"dodge": i == 0})
		if o.invulnerable:
			inv_frames += 1
		if "dodgeEnd" in o.events:
			dist = z0 - c.pz
	check(absf(dist - 4.0) < 1e-6, "dodge covers config distance 4 m by dodgeEnd: %s" % dist)
	check(inv_frames >= 10 and inv_frames <= 20, "i-frame window about 0.25 s, got %d frames" % inv_frames)


func test_determinism() -> void:
	var a := _settled()
	var b := _settled()
	for i in 200:
		var inp := {"move": [sin(i * 0.1), 1.0], "jump": i % 70 == 0, "jumpHeld": i % 70 < 20, "dodge": i == 120}
		a.step(inp)
		b.step(inp)
	check(a.px == b.px and a.py == b.py and a.pz == b.pz and a.yaw == b.yaw, "same inputs, bit-identical state")


func test_camera_core_conventions() -> void:
	var cam := Cam.new({}, [0.0, 0.0, 0.0])
	for i in 120:
		cam.step({"target": [0.0, 0.0, 0.0]}, 1.0 / 60.0)
	# yaw 0: camera sits at +Z of the pivot, looks toward -Z
	check(cam.out.pos[2] > 3.0 and absf(cam.out.pos[0]) < 1e-6, "camera behind (+Z) the target at yaw 0: %s" % [cam.out.pos])
	check(cam.out.target[2] < cam.out.pos[2], "looks toward -Z")
	check(absf(cam.out.fov - 70.0) < 1e-9, "base fov")
	cam.sweep = func(_o: Array, _r: float, _d: Array) -> float: return 0.3
	for i in 5:
		cam.step({"target": [0.0, 0.0, 0.0]}, 1.0 / 60.0)
	check(cam.collided and cam.out.distance < 4.5 * 0.31, "boom shrinks to the hit instantly: %s" % cam.out.distance)
	check(cam.out.distance >= 0.6 - 1e-9, "never below minDistance")

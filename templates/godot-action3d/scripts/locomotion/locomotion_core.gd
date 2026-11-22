extends RefCounted
## Deterministic locomotion stepper: a line-for-line port of templates/web-project/src/lib/locomotion3d.js
## (spec/v4/locomotion3d.md). Plain 64-bit floats (not Vector3, which is 32-bit), fixed step, no engine physics.
## The movement/collision part is a pluggable `mover` Callable so the same decision logic drives
##   - the built-in flat-ground mover (parity harness, ground plane y = 0), and
##   - a CharacterBody3D mover (real game, see player_controller.gd).
## Yaw 0 faces -Z; +yaw turns toward -X. forward(yaw) = (-sin, 0, -cos), right(yaw) = (cos, 0, -sin).
## No class_name on purpose: load with preload("res://scripts/locomotion/locomotion_core.gd").

const DT: float = 1.0 / 60.0
const SKIN: float = 1e-4
const SNAP_DISTANCE: float = 0.3

const DEFAULTS: Dictionary = {
	"body": {"radius": 0.4, "height": 1.8, "stepHeight": 0.35, "slopeLimitDeg": 50.0},
	"ground": {"walkSpeed": 2.2, "runSpeed": 5.2, "sprintSpeed": 8.0, "runThreshold": 0.6, "accel": 40.0, "decel": 50.0, "turnRateDeg": 720.0},
	"air": {"accel": 14.0, "decel": 3.0, "turnRateDeg": 360.0, "gravity": 28.0, "fallGravityMul": 1.25, "maxFallSpeed": 40.0},
	"jump": {"speed": 9.0, "coyoteTime": 0.1, "bufferTime": 0.12, "cutMultiplier": 0.45, "airJumps": 0, "airJumpSpeed": 8.0, "inheritPlatform": true},
	"land": {"minSpeed": 3.0, "time": 0.08, "hardSpeed": 14.0, "hardTime": 0.45, "hardMoveMul": 0.2},
	"dodge": {"distance": 4.0, "duration": 0.5, "iframeStart": 0.05, "iframeEnd": 0.3, "cooldown": 0.25, "exitSpeed": 2.0, "airDodges": 0, "curve": "easeOut", "turnToDir": true},
	"swim": {"wadeDepth": 0.25, "swimDepth": 1.2, "wadeSpeedMul": 0.7, "speed": 3.0, "accel": 10.0, "floatOffset": 1.4, "buoyancy": 4.0, "maxVerticalSpeed": 3.0, "verticalDamp": 8.0, "exitJumpMul": 0.8, "exitJumpWindow": 0.4},
	"slide": {"minAngleDeg": 38.0, "accel": 18.0, "maxSpeed": 12.0, "control": 0.25},
	"knockback": {"groundDecel": 14.0, "airDecel": 1.5, "stunDefault": 0.35},
}

var cfg: Dictionary
# character body (feet origin)
var px: float = 0.0
var py: float = 0.0
var pz: float = 0.0
var grounded: bool = false
var ground_n: Array = [0.0, 1.0, 0.0]
var vel: Array = [0.0, 0.0, 0.0]  # actual velocity reported by the mover (m/s)
# locomotion state
var hv_x: float = 0.0
var hv_z: float = 0.0
var vy: float = 0.0
var yaw: float = 0.0
var t: float = 0.0
var state: String = "idle"
var state_time: float = 0.0
var coyote: float = 0.0
var buffer: float = 0.0
var air_jumps: int = 0
var air_dodges: int = 0
var jumping: bool = false
var cut_done: bool = false
var dodge_on: bool = false
var dodge_dx: float = 0.0
var dodge_dz: float = 0.0
var dodge_u: float = 0.0
var dodge_cd: float = 0.0
var stun: float = 0.0
var launched: bool = false
var land_lock: float = 0.0
var land_mul: float = 1.0
var invulnerable: bool = false
var mode: String = "ground"
## Callable(core, tx, ty, tz, dt): move the body by (tx,ty,tz)*dt and set core.px/py/pz, grounded, ground_n, vel.
var mover: Callable = Callable()


static func merge_config(partial: Dictionary = {}) -> Dictionary:
	var c: Dictionary = DEFAULTS.duplicate(true)
	for k: String in partial:
		if partial[k] is Dictionary and c.has(k) and c[k] is Dictionary:
			for kk: String in partial[k]:
				c[k][kk] = partial[k][kk]
		else:
			c[k] = partial[k]
	# JSON numbers may arrive as ints; normalise the numeric leaves to float except airJumps/airDodges (kept int).
	for s: String in DEFAULTS:
		for kk: String in DEFAULTS[s]:
			var d: Variant = DEFAULTS[s][kk]
			if d is float and typeof(c[s][kk]) == TYPE_INT:
				c[s][kk] = float(c[s][kk])
	return c


static func load_config_file(path: String) -> Dictionary:
	var txt: String = FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(txt)
	return merge_config(parsed if parsed is Dictionary else {})


static func forward(yaw_: float) -> Array:
	return [-sin(yaw_), 0.0, -cos(yaw_)]


static func right(yaw_: float) -> Array:
	return [cos(yaw_), 0.0, -sin(yaw_)]


func _init(config: Dictionary = {}, pos: Array = [0.0, 0.0, 0.0], yaw0: float = 0.0) -> void:
	cfg = merge_config(config)
	px = float(pos[0])
	py = float(pos[1])
	pz = float(pos[2])
	yaw = yaw0
	air_jumps = int(cfg.jump.airJumps)
	air_dodges = int(cfg.dodge.airDodges)
	mover = Callable(self, "flat_move")


# ---- helpers ----
static func _ang_diff(a: float, b: float) -> float:
	var d: float = fmod(b - a, 2.0 * PI)
	if d > PI:
		d -= 2.0 * PI
	elif d < -PI:
		d += 2.0 * PI
	return d


static func _yaw_of(x: float, z: float) -> float:
	return atan2(-x, -z)


static func _cdf(curve: String, u: float) -> float:
	u = clampf(u, 0.0, 1.0)
	return u if curve == "constant" else 1.0 - (1.0 - u) * (1.0 - u)


func _approach2(tx: float, tz: float, rate: float, dt: float) -> void:
	var dx: float = tx - hv_x
	var dz: float = tz - hv_z
	var d: float = sqrt(dx * dx + dz * dz)
	var m: float = rate * dt
	if d <= m or d < 1e-12:
		hv_x = tx
		hv_z = tz
		return
	hv_x += dx / d * m
	hv_z += dz / d * m


## Built-in mover: infinite flat floor at y = 0 (mirrors collision3d moveAndSlide on a flat triangle floor).
func flat_move(c: RefCounted, tx: float, ty: float, tz: float, dt: float) -> void:
	var was: bool = grounded
	var sx: float = px
	var sz: float = pz
	px += tx * dt
	pz += tz * dt
	var ny: float = py
	var floor_hit: bool = false
	var vdy: float = ty * dt
	if vdy != 0.0:
		ny = py + vdy
		if vdy < 0.0 and ny < SKIN:
			ny = SKIN
			floor_hit = true
	var g: bool = false
	if ty <= 0.0:
		if floor_hit:
			g = true
		else:
			var dist: float = SNAP_DISTANCE if was else SKIN * 3.0
			if ny - SKIN <= dist and ny >= SKIN - 1e-12:
				ny = SKIN
				g = true
	py = ny
	grounded = g
	ground_n = [0.0, 1.0, 0.0]
	var inv: float = 1.0 / dt if dt > 0.0 else 0.0
	var vyo: float = 0.0 if g else ty
	vel = [(px - sx) * inv, vyo, (pz - sz) * inv]


## Knockback / launch. impulse = [x, y, z] world space.
func apply_impulse(impulse: Array, stun_time: float = -1.0, set_vertical: bool = false) -> void:
	hv_x += float(impulse[0])
	hv_z += float(impulse[2])
	if set_vertical:
		vy = float(impulse[1])
	elif float(impulse[1]) != 0.0:
		vy = maxf(vy, 0.0) + float(impulse[1])
	if float(impulse[1]) > 0.0:
		grounded = false
		launched = true
		jumping = false
		coyote = 0.0
	stun = maxf(stun, stun_time if stun_time >= 0.0 else float(cfg.knockback.stunDefault))
	dodge_on = false


func get_pos() -> Array:
	return [px, py, pz]


## One fixed step. input = {move:[x,y], camYaw, sprint, jump, jumpHeld, dodge}. env = {water, surface, platform, force} Callables.
func step(input: Dictionary, dt: float = DT, env: Dictionary = {}) -> Dictionary:
	var c: Dictionary = cfg
	var events: Array = []
	t += dt
	var was_grounded: bool = grounded
	var was_vy: float = vy
	var move: Array = input.get("move", [0.0, 0.0])
	var mx: float = float(move[0])
	var my: float = float(move[1])
	var mm: float = sqrt(mx * mx + my * my)
	var mag: float = minf(1.0, mm)
	var cam_yaw: float = float(input.get("camYaw", 0.0))
	var f: Array = forward(cam_yaw)
	var r: Array = right(cam_yaw)
	var dx: float = r[0] * mx + f[0] * my
	var dz: float = r[2] * mx + f[2] * my
	var dl: float = sqrt(dx * dx + dz * dz)
	if dl > 1e-9:
		dx /= dl
		dz /= dl
	else:
		dx = 0.0
		dz = 0.0
	var has_move: bool = mag > 0.05 and dl > 1e-9
	var jump_pressed: bool = bool(input.get("jump", false))
	var jump_held: bool = bool(input.get("jumpHeld", false))

	# timers
	dodge_cd = maxf(0.0, dodge_cd - dt)
	stun = maxf(0.0, stun - dt)
	land_lock = maxf(0.0, land_lock - dt)
	coyote = maxf(0.0, coyote - dt)
	buffer = maxf(0.0, buffer - dt)
	if jump_pressed:
		buffer = c.jump.bufferTime if c.jump.bufferTime > 0.0 else dt * 0.5

	# environment
	var water: Variant = null
	if env.has("water") and (env["water"] as Callable).is_valid():
		water = (env["water"] as Callable).call(get_pos())
	var depth: float = 0.0
	if water != null:
		depth = float(water.surfaceY) - py
	var swimming: bool = water != null and depth >= c.swim.swimDepth
	var wading: bool = water != null and not swimming and depth >= c.swim.wadeDepth and grounded
	var surf: Variant = null
	if grounded and env.has("surface") and (env["surface"] as Callable).is_valid():
		surf = (env["surface"] as Callable).call(get_pos(), ground_n)
	var plat: Variant = null
	if grounded and env.has("platform") and (env["platform"] as Callable).is_valid():
		plat = (env["platform"] as Callable).call(get_pos(), ground_n)
	var fric: float = float(surf.friction) if surf != null and surf.has("friction") else 1.0
	var steep: bool = grounded and ground_n[1] < cos(deg_to_rad(c.slide.minAngleDeg)) - 1e-9
	var sliding: bool = grounded and (steep or (surf != null and surf.has("slide") and bool(surf.slide))) and not swimming
	var locked: bool = stun > 0.0

	# dodge start
	if bool(input.get("dodge", false)) and not dodge_on and dodge_cd <= 0.0 and not locked and not swimming:
		var air: bool = not grounded
		if not air or air_dodges > 0:
			if air:
				air_dodges -= 1
			var ddx: float
			var ddz: float
			if has_move:
				ddx = dx
				ddz = dz
			else:
				var ff: Array = forward(yaw)
				ddx = ff[0]
				ddz = ff[2]
			dodge_on = true
			dodge_dx = ddx
			dodge_dz = ddz
			dodge_u = 0.0
			if c.dodge.turnToDir:
				yaw = _yaw_of(ddx, ddz)
			jumping = false
			events.append("dodge")

	var dodge_active: bool = dodge_on
	var has_exit: bool = false
	var exit_x: float = 0.0
	var exit_z: float = 0.0
	if dodge_on:
		var D: Dictionary = c.dodge
		var u0: float = dodge_u
		var u1: float = u0 + dt / D.duration
		var dd: float = D.distance * (_cdf(D.curve, u1) - _cdf(D.curve, u0)) / dt
		hv_x = dodge_dx * dd
		hv_z = dodge_dz * dd
		dodge_u = u1
		invulnerable = u0 * D.duration < D.iframeEnd and u1 * D.duration > D.iframeStart
		if u1 >= 1.0 - 1e-12:
			has_exit = true
			exit_x = dodge_dx * D.exitSpeed
			exit_z = dodge_dz * D.exitSpeed
			dodge_on = false
			dodge_cd = D.cooldown
			events.append("dodgeEnd")
	else:
		invulnerable = false
		var g: Dictionary = c.ground
		var speed: float = 0.0
		if has_move:
			if bool(input.get("sprint", false)) and mag >= g.runThreshold:
				speed = g.sprintSpeed
			elif mag >= g.runThreshold:
				speed = g.runSpeed
			else:
				speed = g.walkSpeed * (mag / g.runThreshold)
		if swimming:
			speed = c.swim.speed * mag if has_move else 0.0
		elif wading:
			speed *= c.swim.wadeSpeedMul
		var ctl: float = 1.0
		if land_lock > 0.0:
			ctl = land_mul
		if locked:
			ctl = 0.0
		if sliding:
			ctl *= c.slide.control
		var tx: float = dx * speed * ctl
		var tz: float = dz * speed * ctl
		var has_target: bool = sqrt(tx * tx + tz * tz) > 1e-9
		var rate: float = 0.0
		if swimming:
			rate = c.swim.accel
		elif locked:
			rate = c.knockback.groundDecel if grounded else c.knockback.airDecel
		elif grounded:
			rate = g.accel if has_target else g.decel
		else:
			rate = c.air.accel if has_target else c.air.decel
		if grounded and not swimming and not locked:
			rate *= fric
		if sliding and not locked:
			rate = maxf(rate * 0.25, 0.1)
		_approach2(tx, tz, rate, dt)
		if sliding:
			var n: Array = ground_n
			var hx: float = n[1] * n[0]
			var hz: float = n[1] * n[2]
			var hl: float = sqrt(hx * hx + hz * hz)
			if hl > 1e-9:
				var s: float = c.slide.accel * dt / hl
				var nx: float = hv_x + hx * s
				var nz: float = hv_z + hz * s
				var m: float = sqrt(nx * nx + nz * nz)
				if m > c.slide.maxSpeed:
					nx *= c.slide.maxSpeed / m
					nz *= c.slide.maxSpeed / m
				hv_x = nx
				hv_z = nz
		if has_move and not locked and land_lock <= 0.0:
			var want: float = _yaw_of(dx, dz)
			var tr: float = (g.turnRateDeg if grounded else c.air.turnRateDeg) * PI / 180.0 * dt
			var d: float = _ang_diff(yaw, want)
			yaw += d if absf(d) <= tr else signf(d) * tr
	if env.has("force") and (env["force"] as Callable).is_valid():
		var a: Variant = (env["force"] as Callable).call(get_pos(), state)
		if a != null:
			hv_x += float(a[0]) * dt
			hv_z += float(a[2]) * dt
			if float(a[1]) != 0.0:
				vy += float(a[1]) * dt

	# vertical
	if swimming:
		var ty: float = float(water.surfaceY) - c.swim.floatOffset
		var vt: float = clampf((ty - py) * c.swim.buoyancy, -c.swim.maxVerticalSpeed, c.swim.maxVerticalSpeed)
		vy += (vt - vy) * minf(1.0, c.swim.verticalDamp * dt)
		coyote = c.jump.coyoteTime
		air_jumps = int(c.jump.airJumps)
		jumping = false
		if buffer > 0.0 and not locked and depth < c.swim.swimDepth + c.swim.exitJumpWindow:
			vy = c.jump.speed * c.swim.exitJumpMul
			buffer = 0.0
			coyote = 0.0
			jumping = true
			cut_done = false
			events.append("jump")
	else:
		if grounded:
			coyote = c.jump.coyoteTime
			air_jumps = int(c.jump.airJumps)
			air_dodges = int(c.dodge.airDodges)
			launched = false
			jumping = false
			if vy < 0.0:
				vy = 0.0
		if buffer > 0.0 and not locked and not dodge_on:
			if coyote > 0.0:
				vy = c.jump.speed
				coyote = 0.0
				buffer = 0.0
				jumping = true
				cut_done = false
				events.append("jump")
				if plat != null and c.jump.inheritPlatform:
					hv_x += float(plat[0])
					hv_z += float(plat[2])
			elif not grounded and air_jumps > 0:
				vy = c.jump.airJumpSpeed
				air_jumps -= 1
				buffer = 0.0
				jumping = true
				cut_done = false
				events.append("airJump")
		if jumping and vy > 0.0 and not jump_held and not cut_done:
			vy *= c.jump.cutMultiplier
			cut_done = true
		if not grounded or vy > 0.0:
			var gv: float = c.air.gravity * (c.air.fallGravityMul if vy < 0.0 else 1.0)
			vy = maxf(-c.air.maxFallSpeed, vy - gv * dt)
		if vy <= 0.0:
			jumping = false

	# external carry (never stored in hv)
	var ex: float = 0.0
	var ez: float = 0.0
	var ey: float = 0.0
	if plat != null:
		ex += float(plat[0])
		ez += float(plat[2])
	if surf != null and surf.has("flow") and surf.flow != null:
		ex += float(surf.flow[0])
		ez += float(surf.flow[2])
	if water != null and water.has("flow") and water.flow != null and (swimming or wading or depth > 0.0):
		ex += float(water.flow[0])
		ez += float(water.flow[2])
		if swimming:
			ey += float(water.flow[1])
	var tot_x: float = hv_x + ex
	var tot_y: float = vy + ey
	var tot_z: float = hv_z + ez
	mover.call(self, tot_x, tot_y, tot_z, dt)
	hv_x += vel[0] - tot_x
	hv_z += vel[2] - tot_z
	if has_exit:
		hv_x = exit_x
		hv_z = exit_z
	if absf(hv_x) < 1e-9:
		hv_x = 0.0
	if absf(hv_z) < 1e-9:
		hv_z = 0.0
	vy = vel[1] - ey
	if grounded:
		vy = 0.0

	# landing
	if grounded and not was_grounded and not swimming:
		var fs: float = -was_vy
		if fs >= c.land.minSpeed:
			var hard: bool = fs >= c.land.hardSpeed
			land_lock = c.land.hardTime if hard else c.land.time
			land_mul = c.land.hardMoveMul if hard else 1.0
			events.append("hardLand" if hard else "land")
		else:
			events.append("touchdown")
	if was_grounded and not grounded and vy <= 0.0 and not jumping:
		events.append("leftGround")

	# state
	var spd: float = sqrt(hv_x * hv_x + hv_z * hv_z)
	var st: String
	if dodge_active:
		st = "dodge"
	elif swimming:
		st = "swim"
	elif stun > 0.0:
		st = "stagger" if grounded else "launched"
	elif launched and not grounded:
		st = "launched"
	elif sliding:
		st = "slide"
	elif not grounded:
		st = "jump" if vy > 0.0 else "fall"
	elif land_lock > 0.0:
		st = "land"
	elif wading:
		st = "wade"
	elif spd < 0.15:
		st = "idle"
	else:
		var run_s: float = c.ground.runSpeed
		var walk_s: float = c.ground.walkSpeed
		st = "sprint" if spd > run_s + 1e-6 else ("run" if spd >= (walk_s + run_s) * 0.5 else "walk")
	if st != state:
		state = st
		state_time = 0.0
	else:
		state_time += dt
	mode = "swim" if swimming else ("wade" if wading else "ground")
	return {
		"locomotionState": state, "stateTime": state_time, "speed": spd, "speedNorm": spd / float(c.ground.runSpeed),
		"grounded": grounded, "verticalVelocity": vy, "yaw": yaw, "facing": forward(yaw), "pos": get_pos(),
		"invulnerable": invulnerable, "dodgeProgress": dodge_u if dodge_on else 0.0, "mode": mode, "events": events,
	}

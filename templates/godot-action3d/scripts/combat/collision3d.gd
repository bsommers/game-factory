extends RefCounted
## Depth-only port of the collision3d overlap functions combat3d needs (spec/v3/collision3d.md). Vectors are Arrays of 3 floats.
## Each *_depth returns the penetration depth, 0.0 when the shapes do not overlap (the JS functions return null then).
const J := preload("res://scripts/combat/js_compat.gd")
const EPS: float = 1e-12
const EPS2: float = 1e-24


static func _clamp(x: float, lo: float, hi: float) -> float:
	return lo if x < lo else (hi if x > hi else x)


static func _len(a: Array) -> float:
	return sqrt(J.vdot(a, a))


static func _madd(a: Array, b: Array, s: float) -> Array:
	return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]


static func obb_from_quat(c: Array, h: Array, q: Array) -> Dictionary:
	var n: float = J.hypn([q[0], q[1], q[2], q[3]])
	if n == 0.0:
		n = 1.0
	var x: float = q[0] / n
	var y: float = q[1] / n
	var z: float = q[2] / n
	var w: float = q[3] / n
	return {"c": c.duplicate(), "h": h.duplicate(), "axes": [
		[1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
		[2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
		[2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]]}


static func closest_point_segment(p: Array, a: Array, b: Array) -> Array:
	var ab: Array = J.vsub(b, a)
	var l: float = J.vdot(ab, ab)
	var t: float = _clamp(J.vdot(J.vsub(p, a), ab) / l, 0.0, 1.0) if l > EPS2 else 0.0
	return _madd(a, ab, t)


static func closest_seg_seg_d2(p1: Array, q1: Array, p2: Array, q2: Array) -> float:
	var d1: Array = J.vsub(q1, p1)
	var d2: Array = J.vsub(q2, p2)
	var r: Array = J.vsub(p1, p2)
	var a: float = J.vdot(d1, d1)
	var e: float = J.vdot(d2, d2)
	var f: float = J.vdot(d2, r)
	var s: float
	var t: float
	if a <= EPS2 and e <= EPS2:
		s = 0.0
		t = 0.0
	elif a <= EPS2:
		s = 0.0
		t = _clamp(f / e, 0.0, 1.0)
	else:
		var c: float = J.vdot(d1, r)
		if e <= EPS2:
			t = 0.0
			s = _clamp(-c / a, 0.0, 1.0)
		else:
			var b: float = J.vdot(d1, d2)
			var denom: float = a * e - b * b
			s = _clamp((b * f - c * e) / denom, 0.0, 1.0) if denom > 0.0 else 0.0
			t = (b * s + f) / e
			if t < 0.0:
				t = 0.0
				s = _clamp(-c / a, 0.0, 1.0)
			elif t > 1.0:
				t = 1.0
				s = _clamp((b - c) / a, 0.0, 1.0)
	var c1: Array = _madd(p1, d1, s)
	var c2: Array = _madd(p2, d2, t)
	var dd: Array = J.vsub(c1, c2)
	return J.vdot(dd, dd)


static func sphere_sphere(a: Dictionary, b: Dictionary) -> float:
	var d: Array = J.vsub(a["c"], b["c"])
	var l2: float = J.vdot(d, d)
	var rr: float = a["r"] + b["r"]
	if not (l2 < rr * rr):
		return 0.0
	var l: float = sqrt(l2)
	return rr - l if l > EPS else rr


static func sphere_capsule(s: Dictionary, cp: Dictionary) -> float:
	var q: Array = closest_point_segment(s["c"], cp["a"], cp["b"])
	var d: Array = J.vsub(s["c"], q)
	var l2: float = J.vdot(d, d)
	var rr: float = s["r"] + cp["r"]
	if not (l2 < rr * rr):
		return 0.0
	var l: float = sqrt(l2)
	return rr - l if l > EPS else rr


static func capsule_capsule(a: Dictionary, b: Dictionary) -> float:
	var d2: float = closest_seg_seg_d2(a["a"], a["b"], b["a"], b["b"])
	var rr: float = a["r"] + b["r"]
	if not (d2 < rr * rr):
		return 0.0
	var l: float = sqrt(d2)
	return rr - l if l > EPS else rr


static func _sphere_box_local(c: Array, r: float, h: Array) -> float:
	var q: Array = [_clamp(c[0], -h[0], h[0]), _clamp(c[1], -h[1], h[1]), _clamp(c[2], -h[2], h[2])]
	var d: Array = J.vsub(c, q)
	var l2: float = J.vdot(d, d)
	if l2 > 0.0:
		if l2 >= r * r:
			return 0.0
		return r - sqrt(l2)
	var best: float = h[0] - absf(c[0])
	for i in range(1, 3):
		var g: float = h[i] - absf(c[i])
		if g < best:
			best = g
	return r + best


static func sphere_obb(s: Dictionary, o: Dictionary) -> float:
	var d: Array = J.vsub(s["c"], o["c"])
	var ax: Array = o["axes"]
	var lc: Array = [J.vdot(d, ax[0]), J.vdot(d, ax[1]), J.vdot(d, ax[2])]
	return _sphere_box_local(lc, s["r"], o["h"])


static func obb_obb(a: Dictionary, b: Dictionary) -> float:
	var t: Array = J.vsub(b["c"], a["c"])
	var depth: float = INF
	var axes: Array = []
	for i in 3:
		axes.append(a["axes"][i])
	for i in 3:
		axes.append(b["axes"][i])
	for i in 3:
		for j in 3:
			axes.append(J.vcross(a["axes"][i], b["axes"][j]))
	for ax in axes:
		var l2: float = J.vdot(ax, ax)
		if l2 < 1e-18:
			continue
		var l: float = sqrt(l2)
		var u: Array = [ax[0] / l, ax[1] / l, ax[2] / l]
		var rA: float = a["h"][0] * absf(J.vdot(u, a["axes"][0])) + a["h"][1] * absf(J.vdot(u, a["axes"][1])) + a["h"][2] * absf(J.vdot(u, a["axes"][2]))
		var rB: float = b["h"][0] * absf(J.vdot(u, b["axes"][0])) + b["h"][1] * absf(J.vdot(u, b["axes"][1])) + b["h"][2] * absf(J.vdot(u, b["axes"][2]))
		var dist: float = J.vdot(t, u)
		var o: float = rA + rB - absf(dist)
		if not (o > 0.0):
			return 0.0
		if o < depth:
			depth = o
	return depth

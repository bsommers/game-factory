extends RefCounted
## Port of the fdlibm routines V8 uses for Math.sin / cos / atan / atan2 / acos (src/base/ieee754.cc). glibc (what Godot's
## sin()/cos()/atan2() call) differs from them in the last bit for a few percent of inputs, which is enough to flip an r4/r6
## rounding or a threshold in a long simulation. Constants are given as their IEEE-754 high/low words (exact, no decimal parse).
## Arguments with |x| > ~2^19 * pi/2 (never produced by the combat/boss sims) fall back to the engine functions.
static var _buf: PackedByteArray = PackedByteArray([0, 0, 0, 0, 0, 0, 0, 0])


static func _d(hi: int, lo: int) -> float:
	_buf.encode_u32(0, lo)
	_buf.encode_u32(4, hi)
	return _buf.decode_double(0)


static func _hw(x: float) -> int:
	_buf.encode_double(0, x)
	return _buf.decode_u32(4)


static func _lw(x: float) -> int:
	_buf.encode_double(0, x)
	return _buf.decode_u32(0)


static func _shw(x: float) -> int:
	## signed 32-bit high word
	var h: int = _hw(x)
	return h - 0x100000000 if h >= 0x80000000 else h


static func _kernel_sin(x: float, y: float, iy: int) -> float:
	var ix: int = _hw(x) & 0x7fffffff
	if ix < 0x3e400000:
		if int(x) == 0:
			return x
	var S1: float = _d(0xBFC55555, 0x55555549)
	var S2: float = _d(0x3F811111, 0x1110F8A6)
	var S3: float = _d(0xBF2A01A0, 0x19C161D5)
	var S4: float = _d(0x3EC71DE3, 0x57B1FE7D)
	var S5: float = _d(0xBE5AE5E6, 0x8A2B9CEB)
	var S6: float = _d(0x3DE5D93A, 0x5ACFD57C)
	var z: float = x * x
	var v: float = z * x
	var r: float = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))
	if iy == 0:
		return x + v * (S1 + z * r)
	return x - ((z * (0.5 * y - v * r) - y) - v * S1)


static func _kernel_cos(x: float, y: float) -> float:
	var ix: int = _hw(x) & 0x7fffffff
	if ix < 0x3e400000:
		if int(x) == 0:
			return 1.0
	var C1: float = _d(0x3FA55555, 0x5555554C)
	var C2: float = _d(0xBF56C16C, 0x16C15177)
	var C3: float = _d(0x3EFA01A0, 0x19CB1590)
	var C4: float = _d(0xBE927E4F, 0x809C52AD)
	var C5: float = _d(0x3E21EE9E, 0xBDB4B1C4)
	var C6: float = _d(0xBDA8FAE9, 0xBE8838D4)
	var z: float = x * x
	var r: float = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
	if ix < 0x3FD33333:
		return 1.0 - (0.5 * z - (z * r - x * y))
	var qx: float
	if ix > 0x3fe90000:
		qx = 0.28125
	else:
		qx = _d(ix - 0x00200000, 0)
	var iz: float = 0.5 * z - qx
	var a: float = 1.0 - qx
	return a - (iz - (z * r - x * y))


## Returns [n, y0, y1] for |x| <= 2^19*pi/2 or null.
static func _rem_pio2(x: float) -> Variant:
	var pio2_1: float = _d(0x3FF921FB, 0x54400000)
	var pio2_1t: float = _d(0x3DD0B461, 0x1A626331)
	var pio2_2: float = _d(0x3DD0B461, 0x1A600000)
	var pio2_2t: float = _d(0x3BA3198A, 0x2E037073)
	var pio2_3: float = _d(0x3BA3198A, 0x2E000000)
	var pio2_3t: float = _d(0x397B839A, 0x252049C1)
	var invpio2: float = _d(0x3FE45F30, 0x6DC9C883)
	var hx: int = _shw(x)
	var ix: int = hx & 0x7fffffff
	if ix <= 0x3fe921fb:
		return [0, x, 0.0]
	if ix < 0x4002d97c:
		var z: float
		var y0: float
		var y1: float
		if hx > 0:
			z = x - pio2_1
			if ix != 0x3ff921fb:
				y0 = z - pio2_1t
				y1 = (z - y0) - pio2_1t
			else:
				z -= pio2_2
				y0 = z - pio2_2t
				y1 = (z - y0) - pio2_2t
			return [1, y0, y1]
		z = x + pio2_1
		if ix != 0x3ff921fb:
			y0 = z + pio2_1t
			y1 = (z - y0) + pio2_1t
		else:
			z += pio2_2
			y0 = z + pio2_2t
			y1 = (z - y0) + pio2_2t
		return [-1, y0, y1]
	if ix <= 0x413921fb:
		var t: float = absf(x)
		var n: int = int(t * invpio2 + 0.5)
		var fn: float = float(n)
		var r: float = t - fn * pio2_1
		var w: float = fn * pio2_1t
		var y0b: float
		var npio2_hw: int = _hw(fn * (pio2_1 + pio2_1t)) if n >= 1 else 0
		if n < 32 and ix != npio2_hw:
			y0b = r - w
		else:
			var j: int = ix >> 20
			y0b = r - w
			var i: int = j - ((_hw(y0b) >> 20) & 0x7ff)
			if i > 16:
				t = r
				w = fn * pio2_2
				r = t - w
				w = fn * pio2_2t - ((t - r) - w)
				y0b = r - w
				i = j - ((_hw(y0b) >> 20) & 0x7ff)
				if i > 49:
					t = r
					w = fn * pio2_3
					r = t - w
					w = fn * pio2_3t - ((t - r) - w)
					y0b = r - w
		var y1b: float = (r - y0b) - w
		if hx < 0:
			return [-n, -y0b, -y1b]
		return [n, y0b, y1b]
	return null


static func fsin(x: float) -> float:
	var ix: int = _hw(x) & 0x7fffffff
	if ix <= 0x3fe921fb:
		return _kernel_sin(x, 0.0, 0)
	if ix >= 0x7ff00000:
		return x - x
	var r: Variant = _rem_pio2(x)
	if r == null:
		return sin(x)  # engine fallback (huge argument)
	match int(r[0]) & 3:
		0:
			return _kernel_sin(r[1], r[2], 1)
		1:
			return _kernel_cos(r[1], r[2])
		2:
			return -_kernel_sin(r[1], r[2], 1)
	return -_kernel_cos(r[1], r[2])


static func fcos(x: float) -> float:
	var ix: int = _hw(x) & 0x7fffffff
	if ix <= 0x3fe921fb:
		return _kernel_cos(x, 0.0)
	if ix >= 0x7ff00000:
		return x - x
	var r: Variant = _rem_pio2(x)
	if r == null:
		return cos(x)  # engine fallback (huge argument)
	match int(r[0]) & 3:
		0:
			return _kernel_cos(r[1], r[2])
		1:
			return -_kernel_sin(r[1], r[2], 1)
		2:
			return -_kernel_cos(r[1], r[2])
	return _kernel_sin(r[1], r[2], 1)


static func fatan(x: float) -> float:
	var hx: int = _shw(x)
	var ix: int = hx & 0x7fffffff
	var atanhi: Array = [_d(0x3FDDAC67, 0x0561BB4F), _d(0x3FE921FB, 0x54442D18), _d(0x3FEF730B, 0xD281F69B), _d(0x3FF921FB, 0x54442D18)]
	var atanlo: Array = [_d(0x3C7A2B7F, 0x222F65E2), _d(0x3C81A626, 0x33145C07), _d(0x3C700788, 0x7AF0CBBD), _d(0x3C91A626, 0x33145C07)]
	var aT: Array = [_d(0x3FD55555, 0x5555550D), _d(0xBFC99999, 0x9998EBC4), _d(0x3FC24924, 0x920083FF), _d(0xBFBC71C6, 0xFE231671), _d(0x3FB745CD, 0xC54C206E), _d(0xBFB3B0F2, 0xAF749A6D),
		_d(0x3FB10D66, 0xA0D03D51), _d(0xBFADDE2D, 0x52DEFD9A), _d(0x3FA97B4B, 0x24760DEB), _d(0xBFA2B444, 0x2C6A6C2F), _d(0x3F90AD3A, 0xE322DA11)]
	var id: int
	if ix >= 0x44100000:
		if ix > 0x7ff00000 or (ix == 0x7ff00000 and _lw(x) != 0):
			return x + x
		if hx > 0:
			return atanhi[3] + atanlo[3]
		return -atanhi[3] - atanlo[3]
	if ix < 0x3fdc0000:
		if ix < 0x3e400000:
			return x
		id = -1
	else:
		x = absf(x)
		if ix < 0x3ff30000:
			if ix < 0x3fe60000:
				id = 0
				x = (2.0 * x - 1.0) / (2.0 + x)
			else:
				id = 1
				x = (x - 1.0) / (x + 1.0)
		elif ix < 0x40038000:
			id = 2
			x = (x - 1.5) / (1.0 + 1.5 * x)
		else:
			id = 3
			x = -1.0 / x
	var z: float = x * x
	var w: float = z * z
	var s1: float = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))))
	var s2: float = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))))
	if id < 0:
		return x - x * (s1 + s2)
	z = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x)
	return -z if hx < 0 else z


static func fatan2(y: float, x: float) -> float:
	var tiny: float = 1.0e-300
	var pi_o_2: float = _d(0x3FF921FB, 0x54442D18)
	var pi_: float = _d(0x400921FB, 0x54442D18)
	var pi_lo: float = _d(0x3CA1A626, 0x33145C07)
	var hx: int = _shw(x)
	var lx: int = _lw(x)
	var ix: int = hx & 0x7fffffff
	var hy: int = _shw(y)
	var ly: int = _lw(y)
	var iy: int = hy & 0x7fffffff
	if is_nan(x) or is_nan(y) or ix == 0x7ff00000 or iy == 0x7ff00000:
		return _std_atan2(y, x)
	if ((hx - 0x3ff00000) | lx) == 0:
		return fatan(y)
	var m: int = ((hy >> 31) & 1) | ((hx >> 30) & 2)
	if (iy | ly) == 0:
		match m:
			0, 1:
				return y
			2:
				return pi_ + tiny
		return -pi_ - tiny
	if (ix | lx) == 0:
		return (-pi_o_2 - tiny) if hy < 0 else (pi_o_2 + tiny)
	var k: int = (iy - ix) >> 20
	var z: float
	if k > 60:
		z = pi_o_2 + 0.5 * pi_lo
		m &= 1
	elif hx < 0 and k < -60:
		z = 0.0
	else:
		z = fatan(absf(y / x))
	match m:
		0:
			return z
		1:
			return -z
		2:
			return pi_ - (z - pi_lo)
	return (z - pi_lo) - pi_


static func _std_atan2(y: float, x: float) -> float:
	return atan2(y, x)  # engine fallback (NaN / infinities)


static func facos(x: float) -> float:
	var pio2_hi: float = _d(0x3FF921FB, 0x54442D18)
	var pio2_lo: float = _d(0x3C91A626, 0x33145C07)
	var pi_: float = _d(0x400921FB, 0x54442D18)
	var pS0: float = _d(0x3FC55555, 0x55555555)
	var pS1: float = _d(0xBFD4D612, 0x03EB6F7D)
	var pS2: float = _d(0x3FC9C155, 0x0E884455)
	var pS3: float = _d(0xBFA48228, 0xB5688F3B)
	var pS4: float = _d(0x3F49EFE0, 0x7501B288)
	var pS5: float = _d(0x3F023DE1, 0x0DFDF709)
	var qS1: float = _d(0xC0033A27, 0x1C8A2D4B)
	var qS2: float = _d(0x40002AE5, 0x9C598AC8)
	var qS3: float = _d(0xBFE6066C, 0x1B8D0159)
	var qS4: float = _d(0x3FB3B8C5, 0xB12E9282)
	var hx: int = _shw(x)
	var ix: int = hx & 0x7fffffff
	if ix >= 0x3ff00000:
		if ((ix - 0x3ff00000) | _lw(x)) == 0:
			return 0.0 if hx > 0 else pi_ + 2.0 * pio2_lo
		return NAN
	if ix < 0x3fe00000:
		if ix <= 0x3c600000:
			return pio2_hi + pio2_lo
		var z0: float = x * x
		var p0: float = z0 * (pS0 + z0 * (pS1 + z0 * (pS2 + z0 * (pS3 + z0 * (pS4 + z0 * pS5)))))
		var q0: float = 1.0 + z0 * (qS1 + z0 * (qS2 + z0 * (qS3 + z0 * qS4)))
		var r0: float = p0 / q0
		return pio2_hi - (x - (pio2_lo - x * r0))
	if hx < 0:
		var z1: float = (1.0 + x) * 0.5
		var p1: float = z1 * (pS0 + z1 * (pS1 + z1 * (pS2 + z1 * (pS3 + z1 * (pS4 + z1 * pS5)))))
		var q1: float = 1.0 + z1 * (qS1 + z1 * (qS2 + z1 * (qS3 + z1 * qS4)))
		var s1: float = sqrt(z1)
		var r1: float = p1 / q1
		var w1: float = r1 * s1 - pio2_lo
		return pi_ - 2.0 * (s1 + w1)
	var z: float = (1.0 - x) * 0.5
	var s: float = sqrt(z)
	var df: float = _d(_hw(s), 0)
	var c: float = (z - df * df) / (s + df)
	var p: float = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))))
	var q: float = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)))
	var r: float = p / q
	var w: float = r * s + c
	return 2.0 * (df + w)

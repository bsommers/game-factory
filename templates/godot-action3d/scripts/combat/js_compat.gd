extends RefCounted
## Bit-exact helpers that reproduce the JavaScript semantics the combat3d/boss3d reference relies on:
## Math.round, Math.hypot (V8's scaled Kahan algorithm), Math.imul / mulberry32, Number#toString, JSON.stringify
## and the FNV-1a hash over UTF-16 code units. Plain Arrays of floats are used for vectors (Vector3 is float32).


static func round_js(x: float) -> float:
	## Math.round: round half toward +infinity, exact (no x + 0.5 rounding error).
	if is_nan(x) or is_inf(x):
		return x
	var f: float = floorf(x)
	return f + 1.0 if x - f >= 0.5 else f


static func r6(v: float) -> float:
	return round_js(v * 1e6) / 1e6


static func r4(v: float) -> float:
	return round_js(v * 1e4) / 1e4


static func hyp2(a: float, b: float) -> float:
	## Math.hypot(a, b) as implemented by V8 (scale by the max, Kahan-sum the squares).
	var x: float = absf(a)
	var y: float = absf(b)
	var mx: float = maxf(x, y)
	if mx == 0.0:
		return 0.0
	var sum: float = 0.0
	var comp: float = 0.0
	var n: float = x / mx
	var summand: float = n * n - comp
	var prelim: float = sum + summand
	comp = (prelim - sum) - summand
	sum = prelim
	n = y / mx
	summand = n * n - comp
	prelim = sum + summand
	comp = (prelim - sum) - summand
	sum = prelim
	return sqrt(sum) * mx


static func hypn(vals: Array) -> float:
	var mx: float = 0.0
	for v in vals:
		mx = maxf(mx, absf(v))
	if mx == 0.0:
		return 0.0
	var sum: float = 0.0
	var comp: float = 0.0
	for v in vals:
		var n: float = absf(v) / mx
		var summand: float = n * n - comp
		var prelim: float = sum + summand
		comp = (prelim - sum) - summand
		sum = prelim
	return sqrt(sum) * mx


static func mul32(a: int, b: int) -> int:
	## Low 32 bits of a*b for unsigned 32-bit a, b (Math.imul modulo 2^32), safe from int64 overflow.
	return ((a & 0xFFFF) * b + ((((a >> 16) * b) & 0xFFFF) << 16)) & 0xFFFFFFFF


static func rng_next(st: Dictionary) -> float:
	## mulberry32 over st["rng"] (uint32); identical to rngNext in combat3d.js / boss3d.js.
	var r: int = (int(st["rng"]) + 0x6d2b79f5) & 0xFFFFFFFF
	st["rng"] = r
	var t: int = mul32(r ^ (r >> 15), r | 1)
	t = (t ^ ((t + mul32(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
	return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


# ---- vectors (Array of 3 floats) ----
static func vadd(a: Array, b: Array) -> Array:
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


static func vsub(a: Array, b: Array) -> Array:
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


static func vmul(a: Array, s: float) -> Array:
	return [a[0] * s, a[1] * s, a[2] * s]


static func vdot(a: Array, b: Array) -> float:
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


static func vcross(a: Array, b: Array) -> Array:
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


static func vlen(a: Array) -> float:
	## Math.hypot(x, y, z)
	var mx: float = maxf(maxf(absf(a[0]), absf(a[1])), absf(a[2]))
	if mx == 0.0:
		return 0.0
	var sum: float = 0.0
	var comp: float = 0.0
	for i in 3:
		var n: float = absf(a[i]) / mx
		var summand: float = n * n - comp
		var prelim: float = sum + summand
		comp = (prelim - sum) - summand
		sum = prelim
	return sqrt(sum) * mx


static func vnorm(a: Array) -> Array:
	var l: float = vlen(a)
	return vmul(a, 1.0 / l) if l > 1e-12 else [0.0, 0.0, 0.0]


static func num(d, key: String, dflt):
	## d[key] ?? dflt (null and missing both fall back)
	if d == null or not (d is Dictionary):
		return dflt
	var v = d.get(key)
	return dflt if v == null else v


static func vec(v) -> Array:
	## copy an Array of numbers as floats
	return [float(v[0]), float(v[1]), float(v[2])]


# ---- Number#toString ----
static func num_str(x: float) -> String:
	if x == 0.0:
		return "0"
	if is_nan(x) or is_inf(x):
		return "null"
	var neg: bool = x < 0.0
	var s: String = String.num_scientific(absf(x))
	var mant: String = s
	var ex: int = 0
	var ei: int = s.find("e")
	if ei >= 0:
		mant = s.substr(0, ei)
		ex = int(s.substr(ei + 1))
	var ip: String = mant
	var fp: String = ""
	var di: int = mant.find(".")
	if di >= 0:
		ip = mant.substr(0, di)
		fp = mant.substr(di + 1)
	var digits: String = ip + fp
	var n: int = ip.length() + ex
	while digits.length() > 1 and digits.begins_with("0"):
		digits = digits.substr(1)
		n -= 1
	while digits.length() > 1 and digits.ends_with("0"):
		digits = digits.substr(0, digits.length() - 1)
	var k: int = digits.length()
	var out: String
	if k <= n and n <= 21:
		out = digits + "0".repeat(n - k)
	elif 0 < n and n <= 21:
		out = digits.substr(0, n) + "." + digits.substr(n)
	elif -6 < n and n <= 0:
		out = "0." + "0".repeat(-n) + digits
	else:
		var e: int = n - 1
		var es: String = ("+" if e >= 0 else "-") + str(absi(e))
		out = (digits if k == 1 else digits.substr(0, 1) + "." + digits.substr(1)) + "e" + es
	return "-" + out if neg else out


# ---- JSON.stringify ----
static func _qs(s: String) -> String:
	var o: String = s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t").replace("\b", "\\b").replace("\f", "\\f")
	return "\"" + o + "\""


static func _js(v, out: PackedStringArray) -> void:
	match typeof(v):
		TYPE_NIL:
			out.append("null")
		TYPE_BOOL:
			out.append("true" if v else "false")
		TYPE_INT:
			out.append(str(v))
		TYPE_FLOAT:
			out.append(num_str(v))
		TYPE_STRING, TYPE_STRING_NAME:
			out.append(_qs(str(v)))
		TYPE_ARRAY:
			out.append("[")
			var first: bool = true
			for e in v:
				if not first:
					out.append(",")
				first = false
				_js(e, out)
			out.append("]")
		TYPE_DICTIONARY:
			out.append("{")
			var first2: bool = true
			for k in v.keys():
				if not first2:
					out.append(",")
				first2 = false
				out.append(_qs(str(k)))
				out.append(":")
				_js(v[k], out)
			out.append("}")
		_:
			out.append("null")


static func jstr(v) -> String:
	var out: PackedStringArray = PackedStringArray()
	_js(v, out)
	return "".join(out)


static func fnv_hex(s: String) -> String:
	## FNV-1a 32 over UTF-16 code units (hashJSON in the JS reference).
	var h: int = 2166136261
	var bytes: PackedByteArray = s.to_utf8_buffer()
	if bytes.size() == s.length():
		for b in bytes:
			h = ((h ^ b) * 16777619) & 0xFFFFFFFF
	else:
		var u: PackedByteArray = s.to_utf16_buffer()
		var i: int = 0
		while i + 1 < u.size():
			h = ((h ^ (u[i] | (u[i + 1] << 8))) * 16777619) & 0xFFFFFFFF
			i += 2
	return "%08x" % h


static func hash_json(v) -> String:
	return fnv_hex(jstr(v))

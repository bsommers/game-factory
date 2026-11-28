extends "res://tests/test_base.gd"
## Number formatting, hashing, rng and rounding must match the ECMAScript semantics the JS reference uses.
const J := preload("res://scripts/combat/js_compat.gd")
const FD := preload("res://scripts/combat/fdlibm.gd")


func test_number_to_string_matches_ecmascript() -> void:
	var cases: Array = [[0.0, "0"], [-0.0, "0"], [1.0, "1"], [0.1, "0.1"], [0.1 + 0.2, "0.30000000000000004"], [123456789.0, "123456789"], [1e21, "1e+21"], [1e-7, "1e-7"], [0.000001, "0.000001"],
		[1.5707963267948966, "1.5707963267948966"], [6.283185307179586, "6.283185307179586"], [-2.5, "-2.5"], [34.2, "34.2"], [1e-6 * 3.0, "0.000003"], [100.0, "100"], [1.2e25, "1.2e+25"], [-1.5e-9, "-1.5e-9"]]
	for c: Array in cases:
		check(J.num_str(c[0]) == c[1], "num_str(%s) = %s, want %s" % [c[0], J.num_str(c[0]), c[1]])


func test_json_stringify_key_order_and_types() -> void:
	var d: Dictionary = {"b": 1, "a": [1.5, true, null, "x\"y"], "c": {"z": 0.25}}
	check(J.jstr(d) == "{\"b\":1,\"a\":[1.5,true,null,\"x\\\"y\"],\"c\":{\"z\":0.25}}", "got " + J.jstr(d))


func test_fnv_hash_matches_hashjson() -> void:
	# hashJSON("hello") in the JS reference is FNV-1a over the JSON text "\"hello\""
	check(J.hash_json("hello") == "df47ee8b", "hashJSON('hello') = df47ee8b, got " + J.hash_json("hello"))
	check(J.fnv_hex("") == "811c9dc5", "empty string hash is the FNV offset basis")
	check(J.fnv_hex("a") == "e40c292c", "FNV-1a('a') = e40c292c, got " + J.fnv_hex("a"))
	check(J.fnv_hex("é") == "6c0b6c44", "non-ASCII hashes UTF-16 code units, got " + J.fnv_hex("é"))


func test_rng_is_mulberry32() -> void:
	# Reference values computed with rngNext in combat3d.js for world.rng = 1, 7
	var w: Dictionary = {"rng": 1}
	var a: float = J.rng_next(w)
	check(w["rng"] == 1831565814, "state after one draw from seed 1 is 0x6d2b79f6 = 1831565814, got %s" % w["rng"])
	check(a == 0.6270739405881613, "first draw from seed 1 is 0.6270739405881613, got " + J.num_str(a))
	var w2: Dictionary = {"rng": 7}
	var vals: Array = []
	for i in 3:
		vals.append(J.num_str(J.rng_next(w2)))
	check(vals == ["0.011704753153026104", "0.06195825757458806", "0.97690763277933"], "draws " + str(vals))


func test_round_and_r6_half_toward_positive_infinity() -> void:
	check(J.round_js(2.5) == 3.0 and J.round_js(-2.5) == -2.0 and J.round_js(-0.5) == 0.0 and J.round_js(0.49999999999999994) == 0.0, "Math.round semantics")
	check(J.r6(0.1234565) == 0.123457 or J.r6(0.1234565) == 0.123456, "r6 rounds to 6 places")
	check(J.r4(1.23456) == 1.2346, "r4")


func test_hypot_matches_v8_scaled_kahan() -> void:
	# Math.hypot(3,4) = 5; Math.hypot(1,1) = 1.4142135623730951; Math.hypot(0.1,0.2,0.3)
	check(J.hyp2(3.0, 4.0) == 5.0, "hypot 3 4")
	check(J.hyp2(1.0, 1.0) == 1.4142135623730951, "hypot 1 1")
	check(J.vlen([0.0, 0.0, 0.0]) == 0.0, "hypot zero")
	check(J.vlen([2.0, 3.0, 6.0]) == 7.0, "hypot 2 3 6")


func test_fdlibm_trig_matches_v8() -> void:
	# values observed from node (V8) for Math.sin/cos/atan2/acos; compared as text because GDScript float literals are not correctly rounded
	var got: Array = [FD.fsin(1.0), FD.fcos(1.0), FD.fsin(PI), FD.fcos(PI / 2.0), FD.fatan2(1.0, 2.0), FD.fatan2(-1.0, -1.0), FD.facos(0.5)]
	var want: Array = ["0.8414709848078965", "0.5403023058681398", "1.2246467991473532e-16", "6.123233995736766e-17", "0.4636476090008061", "-2.356194490192345", "1.0471975511965979"]
	for i in got.size():
		check(J.num_str(got[i]) == want[i], "case %d: %s, want %s" % [i, J.num_str(got[i]), want[i]])

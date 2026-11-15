class_name TestCase
extends RefCounted
## Base class for tests/test_*.gd . Methods named `test_*` are run by tests/run_all.gd.
## Optional hooks: before_each(), after_each(). `tree` is the running SceneTree (autoloads under tree.root).

var tree: SceneTree
var failures: PackedStringArray = []


func check(cond: bool, msg: String = "") -> bool:
	if not cond:
		failures.append(msg if msg != "" else "check failed")
	return cond


func eq(actual: Variant, expected: Variant, msg: String = "") -> bool:
	var ok: bool = typeof(actual) == typeof(expected) and actual == expected
	if not ok and (actual is int or actual is float) and (expected is int or expected is float):
		ok = is_equal_approx(float(actual), float(expected))
	if not ok:
		failures.append("%s: expected %s, got %s" % [msg, var_to_str(expected), var_to_str(actual)])
	return ok


func autoload(n: String) -> Node:
	return tree.root.get_node_or_null(n)

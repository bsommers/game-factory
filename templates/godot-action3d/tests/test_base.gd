extends RefCounted
## Tiny assertion base for tests/test_*.gd (no class_name so it works before any editor import).
var tree: SceneTree
var failures: PackedStringArray = []


func check(cond: bool, msg: String = "check failed") -> void:
	if not cond:
		failures.append(msg)

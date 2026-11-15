extends "res://tests/test_case.gd"
## Template smoke test: autoloads exist and Defs is consistent.

func test_autoloads_present() -> void:
	for n: String in ["Defs", "Events", "Settings", "Game"]:
		check(autoload(n) != null, "autoload %s" % n)

func test_level_table() -> void:
	check(Defs.LEVELS.size() >= 1, "at least one level")
	eq(Defs.level_index(String(Defs.LEVELS[0][0])), 0, "first level index")

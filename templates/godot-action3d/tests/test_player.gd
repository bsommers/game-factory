extends "res://tests/test_base.gd"


func test_player_walks_forward() -> void:
	var main: Node = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	tree.root.add_child(main)
	var p: CharacterBody3D = main.get_node("Player")
	p.input_override = Vector2(0, 1)
	for i in 90:
		await tree.physics_frame
	check(p.is_on_floor(), "player should stand on the floor")
	check(p.global_position.z < -3.0, "player should have moved toward -Z, z=%s" % p.global_position.z)
	main.queue_free()
	await tree.process_frame

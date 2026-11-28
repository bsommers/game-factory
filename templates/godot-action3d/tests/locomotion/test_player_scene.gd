extends "res://tests/test_base.gd"
## Real-physics checks: player.tscn + camera_rig.tscn on a test arena (CharacterBody3D, engine collision).


func _arena() -> Node3D:
	var root := Node3D.new()
	var floor_body := StaticBody3D.new()
	var fs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(80, 1, 80)
	fs.shape = box
	floor_body.add_child(fs)
	floor_body.position = Vector3(0, -0.5, 0)
	root.add_child(floor_body)
	var wall := StaticBody3D.new()
	var ws := CollisionShape3D.new()
	var wb := BoxShape3D.new()
	wb.size = Vector3(10, 4, 1)
	ws.shape = wb
	wall.add_child(ws)
	wall.position = Vector3(0, 2, -8)
	root.add_child(wall)
	var player: CharacterBody3D = (load("res://scenes/player.tscn") as PackedScene).instantiate()
	player.name = "Player"
	player.camera_rig_path = NodePath("../CameraRig")
	root.add_child(player)
	var rig: Node3D = (load("res://scenes/camera_rig.tscn") as PackedScene).instantiate()
	rig.name = "CameraRig"
	rig.target_path = NodePath("../Player")
	root.add_child(rig)
	return root


func test_player_physics_run_jump_and_wall() -> void:
	var arena: Node3D = _arena()
	tree.root.add_child(arena)
	var p: CharacterBody3D = arena.get_node("Player")
	for i in 20:
		await tree.physics_frame
	check(p.is_on_floor() and p.core.state == "idle", "settles on floor, state idle: %s" % p.core.state)
	p.input_override = Vector2(0, 1)
	for i in 60:
		await tree.physics_frame
	check(p.core.state == "run", "runs forward, state %s" % p.core.state)
	check(p.global_position.z < -1.0 and p.global_position.z > -7.0, "ran toward -Z (yaw 0), z=%s" % p.global_position.z)
	for i in 120:
		await tree.physics_frame
	check(p.global_position.z > -7.7, "wall at z=-7.5 stops the player, z=%s" % p.global_position.z)
	p.input_override = Vector2(0, 0)
	for i in 30:
		await tree.physics_frame
	var apex: float = 0.0
	p.jump_override = true
	for i in 70:
		await tree.physics_frame
		apex = maxf(apex, p.global_position.y)
		p.jump_override = i < 20
	check(apex > 1.0 and apex < 2.0, "jump apex ~1.5 m under physics, got %s" % apex)
	check(p.is_on_floor(), "landed again")
	arena.queue_free()
	await tree.process_frame


func test_camera_rig_follows_behind() -> void:
	var arena: Node3D = _arena()
	tree.root.add_child(arena)
	var rig: Node3D = arena.get_node("CameraRig")
	var p: CharacterBody3D = arena.get_node("Player")
	p.global_position = Vector3(2, 0, 3)
	for i in 5:
		await tree.physics_frame
	for i in 90:
		await tree.process_frame
	var cam: Camera3D = rig.get_node("Camera")
	var d: Vector3 = cam.global_position - p.global_position
	check(d.z > 3.0 and d.y > 0.5 and absf(d.x) < 0.3, "camera behind (+Z) and above the player: %s" % d)
	check(cam.global_transform.basis.z.z > 0.5, "camera looks toward -Z")
	check(is_equal_approx(rig.get("yaw"), 0.0), "rig yaw 0")
	arena.queue_free()
	await tree.process_frame

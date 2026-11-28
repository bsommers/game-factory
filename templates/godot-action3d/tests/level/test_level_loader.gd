extends "res://tests/test_base.gd"

const Loader: GDScript = preload("res://scripts/level/level_loader.gd")
const FIX := "res://tests/level/fixtures/"


func _load(name: String) -> Node3D:
	var lv: Node3D = Loader.new()
	tree.root.add_child(lv)
	var err: Error = lv.load_file(FIX + name + ".json")
	check(err == OK, "load %s failed: %s" % [name, error_string(err)])
	return lv


func _ray_down(x: float, z: float, from_y: float = 10.0) -> Dictionary:
	var space: PhysicsDirectSpaceState3D = (tree.root.world_3d as World3D).direct_space_state
	var q := PhysicsRayQueryParameters3D.create(Vector3(x, from_y, z), Vector3(x, -10.0, z))
	return space.intersect_ray(q)


func _point_areas(p: Vector3) -> Array:
	var space: PhysicsDirectSpaceState3D = (tree.root.world_3d as World3D).direct_space_state
	var q := PhysicsPointQueryParameters3D.new()
	q.position = p
	q.collide_with_areas = true
	q.collide_with_bodies = false
	return space.intersect_point(q).map(func(r: Dictionary) -> Node: return r["collider"])


func test_counts_match_json() -> void:
	for n: String in ["arena-towers", "river-arena", "tutorial-yard"]:
		var lv: Node3D = _load(n)
		var d: Dictionary = lv.data
		check(lv.pieces.size() == (d["pieces"] as Array).size(), "%s pieces %d" % [n, lv.pieces.size()])
		check(lv.spawns.size() == (d["spawns"] as Array).size(), "%s spawns" % n)
		check(lv.triggers.size() == (d.get("triggers", []) as Array).size(), "%s triggers" % n)
		check(lv.hazards.size() == (d.get("hazards", []) as Array).size(), "%s hazards" % n)
		check(lv.checkpoints.size() == (d.get("checkpoints", []) as Array).size(), "%s checkpoints" % n)
		check(get_tree_count(lv, "StaticBody3D") == lv.pieces.size(), "%s StaticBody3D count" % n)
		lv.queue_free()
	await tree.process_frame


func get_tree_count(root: Node, cls: String) -> int:
	var n: int = 0
	for c: Node in root.get_children():
		if c.is_class(cls):
			n += 1
	return n


func test_geometry_collides_where_the_bake_says() -> void:
	var lv: Node3D = _load("arena-towers")
	await tree.physics_frame
	await tree.physics_frame
	var g: Dictionary = _ray_down(0.0, -11.0)
	check(not g.is_empty() and absf((g["position"] as Vector3).y) < 0.001, "ground at y=0: %s" % [g])
	var ramp: Dictionary = _ray_down(3.5, 0.0)
	check(not ramp.is_empty() and absf((ramp["position"] as Vector3).y - 1.0) < 0.01, "ramp mid height 1.0: %s" % [ramp])
	var tower: Dictionary = _ray_down(7.0, 0.0)
	check(not tower.is_empty() and absf((tower["position"] as Vector3).y - 2.0) < 0.001, "tower top 2.0: %s" % [tower])
	var wall: Dictionary = _ray_down(0.0, 14.0)
	check(not wall.is_empty() and absf((wall["position"] as Vector3).y - 4.0) < 0.01, "wall top 4.0: %s" % [wall])
	lv.queue_free()
	await tree.process_frame


func test_heightmap_and_yaw() -> void:
	var lv: Node3D = _load("river-arena")
	await tree.physics_frame
	await tree.physics_frame
	var hill: Dictionary = _ray_down(0.0, 14.0)
	check(not hill.is_empty() and absf((hill["position"] as Vector3).y - 1.4) < 0.01, "hill peak 1.4: %s" % [hill])
	var deck: Dictionary = _ray_down(8.0, 0.0)
	check(not deck.is_empty() and absf((deck["position"] as Vector3).y) < 0.01, "bridge deck at 0: %s" % [deck])
	var bed: Dictionary = _ray_down(0.0, 0.0)
	check(not bed.is_empty() and absf((bed["position"] as Vector3).y + 1.5) < 0.01, "river bed at -1.5: %s" % [bed])
	lv.queue_free()
	await tree.process_frame


func test_spawns_triggers_hazards_and_arena() -> void:
	var lv: Node3D = _load("arena-towers")
	await tree.physics_frame
	await tree.physics_frame
	check(lv.spawn_position("player_start").is_equal_approx(Vector3(0, 0, -11)), "player spawn position")
	check(lv.spawns_of("pickup").size() == 2 and lv.spawns_of("enemy").size() == 2, "spawn kinds")
	check((lv.spawns["boss"] as Node).get_meta("boss") == "hydra-three-head", "boss meta")
	check(_point_areas(Vector3(0, 1, -12.5)).has(lv.triggers["enter_arena"]), "trigger volume contains its centre")
	check(not _point_areas(Vector3(0, 1, -5.0)).has(lv.triggers["enter_arena"]), "trigger volume excludes far point")
	var gas: Area3D = lv.hazards["gas_pool"]
	check(gas.get_meta("kind") == "gas" and not gas.get_meta("active"), "gas pool starts inactive")
	lv.set_hazard_active("gas_pool", true)
	check(gas.get_meta("active"), "set_hazard_active")
	check(lv.in_arena(Vector3(0, 0, 0)) and not lv.in_arena(Vector3(0, 0, 16)), "arena circle membership")
	check(lv.get_tree().get_nodes_in_group("spawn_player").size() == 1, "spawn group")
	lv.queue_free()
	await tree.process_frame


func test_trigger_signal_and_bad_input() -> void:
	var lv: Node3D = _load("tutorial-yard")
	var hits: Array = []
	lv.trigger_entered.connect(func(id: String, ev: String, _b: Node3D) -> void: hits.append([id, ev]))
	var body := CharacterBody3D.new()
	var cs := CollisionShape3D.new()
	cs.shape = SphereShape3D.new()
	body.add_child(cs)
	tree.root.add_child(body)
	body.global_position = Vector3(4, 0.5, -2)
	await tree.physics_frame
	await tree.physics_frame
	await tree.physics_frame
	check(hits.size() == 1 and hits[0][1] == "tutorial.wall", "trigger_entered fired once: %s" % [hits])
	body.queue_free()
	var bad: Node3D = Loader.new()
	tree.root.add_child(bad)
	check(bad.load_dict({"version": 2}) == ERR_INVALID_DATA, "rejects wrong version")
	check(bad.load_file("res://tests/level/fixtures/missing.json") != OK, "missing file errors")
	bad.queue_free()
	lv.queue_free()
	await tree.process_frame

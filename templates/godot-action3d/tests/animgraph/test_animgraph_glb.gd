extends "res://tests/test_base.gd"
## Real-asset check: loads a Meshy/Rigify .glb with GLTFDocument (no import step), drives it with the anim-graph adapter and checks
## poses, masks, root-motion lock and BoneMap retarget. Needs env ANIMGRAPH_GLB (a .glb), ANIMGRAPH_GRAPH (graph json, optional) and
## ANIMGRAPH_BONEMAP (meshy.rig-map godotBoneMap json, optional). Skipped (passes) when ANIMGRAPH_GLB is unset or missing.
const Adapter := preload("res://scripts/animgraph/animgraph_adapter.gd")


## Largest component difference (sign-aligned); 0 for identical rotations. Avoids float32 noise of angle_to()/dot().
func _qdiff(a: Quaternion, b: Quaternion) -> float:
	var s: float = 1.0 if a.dot(b) >= 0.0 else -1.0
	return maxf(maxf(absf(a.x - s * b.x), absf(a.y - s * b.y)), maxf(absf(a.z - s * b.z), absf(a.w - s * b.w)))


func _env(name: String, fallback: String = "") -> String:
	var v: String = OS.get_environment(name)
	return v if v != "" else fallback


func _graph() -> Dictionary:
	var p: String = _env("ANIMGRAPH_GRAPH", ProjectSettings.globalize_path("res://").path_join("../../spec/v4/examples/anim-graph/meshy-parkway-pete.json").simplify_path())
	var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(p))
	return d if d is Dictionary else {}


func _scene() -> Node:
	var path: String = _env("ANIMGRAPH_GLB")
	if path == "" or not FileAccess.file_exists(path):
		print("SKIP test_animgraph_glb: set ANIMGRAPH_GLB to a rigged .glb")
		return null
	var root: Node = Adapter.load_glb(path)
	check(root != null, "GLTFDocument could not load " + path)
	return root


func _parts(root: Node) -> Dictionary:
	var sk: Array = []
	var ap: Array = []
	Adapter.find_nodes(root, "Skeleton3D", sk)
	Adapter.find_nodes(root, "AnimationPlayer", ap)
	check(sk.size() == 1 and ap.size() >= 1, "expected one Skeleton3D and an AnimationPlayer")
	return {"skeleton": sk[0] if sk.size() > 0 else null, "player": ap[0] if ap.size() > 0 else null}


func _make(root: Node, g: Dictionary, opts: Dictionary = {}) -> RefCounted:
	var p: Dictionary = _parts(root)
	return Adapter.new().setup(g, p["player"], p["skeleton"], opts)


func test_adapter_drives_real_glb() -> void:
	var root: Node = _scene()
	if root == null:
		return
	var g: Dictionary = _graph()
	var ad: RefCounted = _make(root, g)
	check(ad.missing_clips.is_empty(), "graph clips missing from glb: %s" % [ad.missing_clips])
	var sk: Skeleton3D = ad.skeleton
	check(sk.get_bone_count() == 58, "58 bones expected, got %d" % sk.get_bone_count())
	check(ad.root_bone >= 0 and sk.get_bone_name(ad.root_bone) == "spine", "root bone is spine")
	ad.set_param("speed", 2.4)
	var travel: Vector3 = Vector3.ZERO
	var minp: Vector3 = Vector3(1e9, 1e9, 1e9)
	var maxp: Vector3 = Vector3(-1e9, -1e9, -1e9)
	for f in 150:
		var r: Dictionary = ad.update(1.0 / 60.0)
		travel += Vector3(r["rootMotion"]["x"], r["rootMotion"]["y"], r["rootMotion"]["z"])
		var rp: Vector3 = sk.get_bone_pose_position(ad.root_bone)
		minp = minp.min(rp)
		maxp = maxp.max(rp)
	# Meshy Walking/Running are authored in place (spine bob ~4 cm): extraction must report ~nothing and the pose keeps its bob.
	check(Vector2(travel.x, travel.z).length() < 0.25, "in-place Meshy locomotion reports ~no root travel (got %s)" % travel)
	check(absf(travel.y) < 1e-9, "axes xz leave y at 0")
	check((maxp - minp).length() < 0.2, "root bone keeps its small bob (range %s)" % (maxp - minp))
	var thigh: int = sk.find_bone("thigh.L")
	check(thigh >= 0 and sk.get_bone_pose_rotation(thigh).is_normalized(), "thigh pose is a unit rotation")
	root.free()


func test_extract_locks_root_travel_of_a_travelling_clip() -> void:
	var root: Node = _scene()
	if root == null:
		return
	# Boxing_Practice travels ~0.85 m on its root bone; extract it and check delta == track displacement and pose is locked.
	var g: Dictionary = {"version": 1, "parameters": {}, "rootMotion": {"mode": "extract", "bone": "spine", "axes": "xz"},
		"layers": [{"name": "base", "entry": "box", "states": {"box": {"clip": "Boxing_Practice", "loop": false}}, "transitions": []}]}
	var ad: RefCounted = _make(root, g)
	var a: Animation = ad.find_animation("Boxing_Practice")
	var tr: int = ad._tracks["Boxing_Practice"]["spine"]["pos"]
	var p0: Vector3 = a.position_track_interpolate(tr, 0.0)
	var p1: Vector3 = a.position_track_interpolate(tr, a.length)
	var travel: Vector3 = Vector3.ZERO
	var start_pos: Vector3 = Vector3.ZERO
	for f in int(ceil(a.length * 60.0)) + 10:
		var r: Dictionary = ad.update(1.0 / 60.0)
		travel += Vector3(r["rootMotion"]["x"], 0.0, r["rootMotion"]["z"])
		if f == 0:
			start_pos = ad.skeleton.get_bone_pose_position(ad.root_bone)
	var want: Vector3 = Vector3(p1.x - p0.x, 0.0, p1.z - p0.z)
	check((travel - want).length() < 1e-3, "extracted travel %s == track displacement %s" % [travel, want])
	var end_pos: Vector3 = ad.skeleton.get_bone_pose_position(ad.root_bone)
	check(Vector2(end_pos.x - start_pos.x, end_pos.z - start_pos.z).length() < 0.02, "horizontal root travel locked out of the pose (%s -> %s)" % [start_pos, end_pos])
	root.free()


func test_punch_layer_is_masked_to_upper_body() -> void:
	var root: Node = _scene()
	if root == null:
		return
	var g: Dictionary = _graph()
	var a: RefCounted = _make(root, g)
	var root2: Node = _scene()
	var b: RefCounted = _make(root2, g)
	a.set_param("speed", 2.0)
	b.set_param("speed", 2.0)
	var evs: Array = []
	for f in 40:
		a.update()
		b.update()
	b.set_trigger("punch")
	for f in 30:
		a.update()
		for e: Dictionary in b.update()["events"]:
			evs.append(e["name"])
	check(evs.has("hit_start") and evs.has("hit_end"), "punch events fired: %s" % [evs])
	var sk_a: Skeleton3D = a.skeleton
	var sk_b: Skeleton3D = b.skeleton
	var thigh: int = sk_a.find_bone("thigh.L")
	var arm: int = sk_a.find_bone("upper_arm.R")
	var leg_diff: float = _qdiff(sk_a.get_bone_pose_rotation(thigh), sk_b.get_bone_pose_rotation(thigh))
	var arm_diff: float = _qdiff(sk_a.get_bone_pose_rotation(arm), sk_b.get_bone_pose_rotation(arm))
	check(leg_diff < 1e-6, "legs unaffected by the upper-body punch layer (diff %f)" % leg_diff)
	check(arm_diff > 1e-3, "arms driven by the punch layer (diff %f)" % arm_diff)
	root.free()
	root2.free()


func test_bonemap_retarget_by_role() -> void:
	var root: Node = _scene()
	if root == null:
		return
	var mp: String = _env("ANIMGRAPH_BONEMAP")
	if mp == "" or not FileAccess.file_exists(mp):
		print("SKIP bone map part: set ANIMGRAPH_BONEMAP to a meshy.rig-map godotBoneMap json")
		root.free()
		return
	var src: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(mp))
	var bm: BoneMap = Adapter.make_bone_map(src)
	check(bm.get_skeleton_bone_name("Hips") == "spine" and bm.get_skeleton_bone_name("Head") == "spine.005", "BoneMap built from rig-map JSON")
	# Rename every bone of the target skeleton (X_ prefix) so only the role mapping can connect clips and bones.
	var dst: Dictionary = {"profile": src["profile"], "bones": {}}
	for role: String in src["bones"]:
		dst["bones"][role] = "X_" + src["bones"][role]
	var g: Dictionary = _graph()
	var ref: RefCounted = _make(root, g)
	var root2: Node = _scene()
	var parts: Dictionary = _parts(root2)
	var sk: Skeleton3D = parts["skeleton"]
	for i in sk.get_bone_count():
		sk.set_bone_name(i, "X_" + sk.get_bone_name(i))
	var g2: Dictionary = g.duplicate(true)
	g2["rootMotion"]["bone"] = "X_spine"
	g2["layers"][1]["mask"]["bones"] = ["X_spine.001"]
	var ad: RefCounted = Adapter.new().setup(g2, parts["player"], sk, {"src_bone_map": src, "dst_bone_map": dst})
	for f in 60:
		ref.set_param("speed", 3.0)
		ad.set_param("speed", 3.0)
		ref.update()
		ad.update()
	var worst: float = 0.0
	var compared: int = 0
	for role: String in src["bones"]:
		var bi: int = ref.skeleton.find_bone(src["bones"][role])
		var bj: int = sk.find_bone(dst["bones"][role])
		check(bi >= 0 and bj >= 0, "role %s present in both skeletons" % role)
		if bi >= 0 and bj >= 0:
			worst = maxf(worst, _qdiff(ref.skeleton.get_bone_pose_rotation(bi), sk.get_bone_pose_rotation(bj)))
			compared += 1
	check(compared >= 40, "compared %d mapped bones" % compared)
	check(worst < 1e-6, "retargeted (renamed) skeleton gets the same pose on every mapped bone (worst %f)" % worst)
	root.free()
	root2.free()

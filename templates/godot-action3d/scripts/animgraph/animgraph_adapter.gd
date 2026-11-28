extends RefCounted
## Applies animgraph_core.gd to an imported GLB: samples the AnimationPlayer's Animation resources (no AnimationTree, no playback)
## and writes layered / masked / additive / crossfaded poses straight to a Skeleton3D. Root motion is extracted from the root
## bone track and locked out of the pose (spec/v4/anim-graph.md, "Step semantics" 4). Bone names match case/punctuation-insensitively.
##
## Retarget: pass the meshy.rig-map `godotBoneMap` JSON of the clips' rig as `src_bone_map` and of the target skeleton as
## `dst_bone_map` ({profile, bones:{HumanoidRole: boneName}}); tracks of source bones then drive the same-role target bones.
## Without maps, bones are matched by (normalised) name.
##
##   var ad = load("res://scripts/animgraph/animgraph_adapter.gd").new()
##   ad.setup(graph_dict, anim_player, skeleton, {"src_bone_map": j1, "dst_bone_map": j2})
##   ad.set_param("speed", 3.0); var r = ad.update(1.0 / 60.0)   # r.events, r.transitions, r.rootMotion (model space, metres)

const Core := preload("res://scripts/animgraph/animgraph_core.gd")

var core: RefCounted
var player: AnimationPlayer
var skeleton: Skeleton3D
var graph: Dictionary = {}
var root_bone: int = -1
var masks: Array = []              # per layer: PackedFloat32Array (1 = layer affects bone)
var bone_alias: Dictionary = {}    # target bone name -> source (track) bone name
var _anims: Dictionary = {}        # graph clip name -> Animation
var _tracks: Dictionary = {}       # graph clip name -> {source bone name: {"pos": idx, "rot": idx, "scl": idx}}
var _rest: Array = []              # per bone {"t","r","s"}
var _src_to_bone: Dictionary = {}
var pose_cache: Array = []
var _dirty: bool = true
var missing_clips: Array = []


# ---------- retarget helpers ----------
## BoneMap resource (SkeletonProfileHumanoid) from a meshy.rig-map godotBoneMap JSON.
static func make_bone_map(j: Dictionary) -> BoneMap:
	var bm: BoneMap = BoneMap.new()
	bm.profile = SkeletonProfileHumanoid.new()
	for role: String in j.get("bones", {}):
		bm.set_skeleton_bone_name(role, j["bones"][role])
	return bm


## {targetBoneName: sourceBoneName} for every humanoid role present in both maps.
static func retarget_alias(src_map: Dictionary, dst_map: Dictionary) -> Dictionary:
	var out: Dictionary = {}
	var sb: Dictionary = src_map.get("bones", {})
	for role: String in dst_map.get("bones", {}):
		if sb.has(role):
			out[dst_map["bones"][role]] = sb[role]
	return out


static func find_nodes(n: Node, type_name: String, out: Array) -> void:
	if n.is_class(type_name):
		out.append(n)
	for c: Node in n.get_children():
		find_nodes(c, type_name, out)


## Instantiate a .glb/.gltf from disk without the editor import step (GLTFDocument). Returns the scene root or null.
static func load_glb(path: String) -> Node:
	var doc: GLTFDocument = GLTFDocument.new()
	var st: GLTFState = GLTFState.new()
	if doc.append_from_file(path, st) != OK:
		return null
	return doc.generate_scene(st)


# ---------- setup ----------
func setup(graph_def: Dictionary, anim_player: AnimationPlayer, skel: Skeleton3D, opts: Dictionary = {}) -> RefCounted:
	graph = graph_def
	player = anim_player
	skeleton = skel
	if opts.has("src_bone_map") and opts.has("dst_bone_map"):
		bone_alias = retarget_alias(opts["src_bone_map"], opts["dst_bone_map"])
	_rest.clear()
	_src_to_bone.clear()
	for i in skeleton.get_bone_count():
		var rp: Transform3D = skeleton.get_bone_rest(i)
		_rest.append({"t": rp.origin, "r": rp.basis.get_rotation_quaternion(), "s": rp.basis.get_scale()})
		_src_to_bone[skeleton.get_bone_name(i)] = i
	root_bone = _find_root(String(graph.get("rootMotion", {}).get("bone", "")))
	_index_clips()
	var clip_table: Dictionary = {}
	for cn: String in _anims:
		var a: Animation = _anims[cn]
		clip_table[cn] = {"duration": a.length, "root": _root_sampler.bind(cn)}
	core = Core.new().setup(graph, clip_table, opts)
	masks = []
	for L: Dictionary in graph.get("layers", []):
		masks.append(_resolve_mask(L.get("mask")))
	_dirty = true
	return self


func _find_root(bone_name: String) -> int:
	if bone_name != "":
		for i in skeleton.get_bone_count():
			if Core.norm_name(skeleton.get_bone_name(i)) == Core.norm_name(bone_name):
				return i
	for i in skeleton.get_bone_count():
		if skeleton.get_bone_parent(i) < 0:
			return i
	return 0


func _graph_clip_names() -> Array:
	var names: Array = []
	for L: Dictionary in graph.get("layers", []):
		for sn: String in L.get("states", {}):
			var s: Dictionary = L["states"][sn]
			if s.has("clip") and not names.has(s["clip"]):
				names.append(s["clip"])
			if s.has("blend"):
				for p: Dictionary in s["blend"]["points"]:
					if not names.has(p["clip"]):
						names.append(p["clip"])
	return names


func find_animation(cn: String) -> Animation:
	var list: PackedStringArray = player.get_animation_list()
	for n: String in list:
		if n == cn:
			return player.get_animation(n)
	for n: String in list:
		var short: String = n.get_slice("|", n.get_slice_count("|") - 1)
		if short == cn or Core.norm_name(short) == Core.norm_name(cn):
			return player.get_animation(n)
	return null


func _index_clips() -> void:
	_anims.clear()
	_tracks.clear()
	missing_clips.clear()
	for cn: String in _graph_clip_names():
		var a: Animation = find_animation(cn)
		if a == null:
			missing_clips.append(cn)
			continue
		_anims[cn] = a
		var idx: Dictionary = {}
		for t in a.get_track_count():
			var path: NodePath = a.track_get_path(t)
			if path.get_subname_count() == 0:
				continue
			var bone: String = path.get_subname(0)
			var kind: String = ""
			match a.track_get_type(t):
				Animation.TYPE_POSITION_3D:
					kind = "pos"
				Animation.TYPE_ROTATION_3D:
					kind = "rot"
				Animation.TYPE_SCALE_3D:
					kind = "scl"
			if kind == "":
				continue
			if not idx.has(bone):
				idx[bone] = {}
			idx[bone][kind] = t
		_tracks[cn] = idx


func _resolve_mask(mask: Variant) -> PackedFloat32Array:
	var out: PackedFloat32Array = PackedFloat32Array()
	out.resize(skeleton.get_bone_count())
	if mask == null:
		out.fill(1.0)
		return out
	_mark(out, mask.get("bones", []), 1.0, mask.get("descendants", true) != false)
	_mark(out, mask.get("exclude", []), 0.0, mask.get("excludeDescendants", true) != false)
	return out


func _mark(out: PackedFloat32Array, names: Array, v: float, desc: bool) -> void:
	for nm: String in names:
		for i in skeleton.get_bone_count():
			if Core.norm_name(skeleton.get_bone_name(i)) == Core.norm_name(nm):
				_walk_mark(out, i, v, desc)


func _walk_mark(out: PackedFloat32Array, i: int, v: float, desc: bool) -> void:
	out[i] = v
	if desc:
		for c: int in skeleton.get_bone_children(i):
			_walk_mark(out, c, v, desc)


# ---------- sampling ----------
func _src_name(bone_idx: int) -> String:
	var n: String = skeleton.get_bone_name(bone_idx)
	return String(bone_alias.get(n, n))


func _sample(cn: String, bone_idx: int, t: float) -> Dictionary:
	var rest: Dictionary = _rest[bone_idx]
	var tr: Variant = _tracks.get(cn, {}).get(_src_name(bone_idx))
	if tr == null:
		return {"t": rest["t"], "r": rest["r"], "s": rest["s"]}
	var a: Animation = _anims[cn]
	return {
		"t": a.position_track_interpolate(tr["pos"], t) if tr.has("pos") else rest["t"],
		"r": a.rotation_track_interpolate(tr["rot"], t) if tr.has("rot") else rest["r"],
		"s": a.scale_track_interpolate(tr["scl"], t) if tr.has("scl") else rest["s"],
	}


func _root_sampler(t: float, cn: String) -> Dictionary:
	var s: Dictionary = _sample(cn, root_bone, clampf(t, 0.0, (_anims[cn] as Animation).length))
	return {"p": [s["t"].x, s["t"].y, s["t"].z], "q": [s["r"].x, s["r"].y, s["r"].z, s["r"].w]}


func _clip_pose(cn: String, phase: float) -> Array:
	var a: Animation = _anims[cn]
	var time: float = clampf(a.length * phase, 0.0, a.length)
	var pose: Array = []
	for i in skeleton.get_bone_count():
		pose.append(_sample(cn, i, time))
	var mode: String = core.clip_mode(cn)
	if mode == "extract" or mode == "inplace":
		_lock(pose, cn, time)
	return pose


func _lock(pose: Array, cn: String, time: float) -> void:
	var a: Dictionary = _sample(cn, root_bone, 0.0)
	var b: Dictionary = _sample(cn, root_bone, time)
	var axes: String = String(graph.get("rootMotion", {}).get("axes", "xz"))
	var dw: Vector3 = b["t"] - a["t"]
	if axes == "xz":
		dw.y = 0.0
	var n: Dictionary = pose[root_bone]
	n["t"] = b["t"] - dw
	if graph.get("rootMotion", {}).get("yaw", false):
		var d: Quaternion = (b["r"] as Quaternion) * (a["r"] as Quaternion).inverse()
		var dy: float = Core.yaw_of([d.x, d.y, d.z, d.w])
		n["r"] = Quaternion(Vector3.UP, -dy) * (b["r"] as Quaternion)


static func _blend(a: Array, b: Array, w: float) -> Array:
	var out: Array = []
	for i in a.size():
		out.append({"t": (a[i]["t"] as Vector3).lerp(b[i]["t"], w), "r": (a[i]["r"] as Quaternion).slerp(b[i]["r"], w), "s": (a[i]["s"] as Vector3).lerp(b[i]["s"], w)})
	return out


func _state_pose(L: Dictionary, st: String, p: float) -> Variant:
	var s: Dictionary = L["def"]["states"][st]
	if s.has("empty"):
		return null
	var ph: float = minf(p, 1.0) if s.get("loop", true) == false else p - floor(p)
	if s.has("clip"):
		return _clip_pose(s["clip"], ph) if _anims.has(s["clip"]) else null
	var ws: Array = Core.blend_weights(s, core.params)
	if not _anims.has(ws[0]["clip"]):
		return null
	var a: Array = _clip_pose(ws[0]["clip"], ph)
	if ws.size() == 1 or not _anims.has(ws[1]["clip"]):
		return a
	return _blend(a, _clip_pose(ws[1]["clip"], ph), ws[1]["w"])


func _layer_pose(li: int) -> Dictionary:
	var L: Dictionary = core.layers[li]
	var cur: Variant = _state_pose(L, L["cur"]["state"], L["cur"]["p"])
	var wc: float = core.weight_of(li)
	if L["prev"] == null:
		return {"pose": cur, "w": 1.0 if cur != null else 0.0}
	var prev: Variant = _state_pose(L, L["prev"]["state"], L["prev"]["p"])
	if cur != null and prev != null:
		return {"pose": _blend(prev, cur, wc), "w": 1.0}
	if cur != null:
		return {"pose": cur, "w": wc}
	if prev != null:
		return {"pose": prev, "w": 1.0 - wc}
	return {"pose": null, "w": 0.0}


## Final local TRS per bone [{t: Vector3, r: Quaternion, s: Vector3}]: base layer, then masked override / additive layers.
func compute_pose() -> Array:
	if not _dirty:
		return pose_cache
	var out: Array = []
	for i in skeleton.get_bone_count():
		out.append({"t": _rest[i]["t"], "r": _rest[i]["r"], "s": _rest[i]["s"]})
	for li in core.layers.size():
		var L: Dictionary = core.layers[li]
		var lp: Dictionary = _layer_pose(li)
		var lw: float = core.layer_weight(li) * float(lp["w"])
		if lp["pose"] == null or lw <= 0.0:
			continue
		var pose: Array = lp["pose"]
		var mask: PackedFloat32Array = masks[li]
		if L["def"].get("blend", "override") == "additive":
			var s: Dictionary = L["def"]["states"][L["cur"]["state"]]
			var ref_name: String = s["clip"] if s.has("clip") else s["blend"]["points"][0]["clip"]
			if not _anims.has(ref_name):
				continue
			var ref: Array = []
			for i in skeleton.get_bone_count():
				ref.append(_sample(ref_name, i, 0.0))
			for i in out.size():
				var w: float = lw * mask[i]
				if w == 0.0:
					continue
				var o: Dictionary = out[i]
				var l: Dictionary = pose[i]
				var f: Dictionary = ref[i]
				var dq: Quaternion = (f["r"] as Quaternion).inverse() * (l["r"] as Quaternion)
				out[i] = {"t": o["t"] + w * (l["t"] - f["t"]), "r": (o["r"] as Quaternion) * Quaternion.IDENTITY.slerp(dq, w), "s": o["s"] + w * (l["s"] - f["s"])}
		elif li == 0 and not L["def"].has("mask"):
			out = pose if lw >= 1.0 else _blend(out, pose, lw)
		else:
			for i in out.size():
				var w2: float = lw * mask[i]
				if w2 == 0.0:
					continue
				var o2: Dictionary = out[i]
				var l2: Dictionary = pose[i]
				out[i] = {"t": (o2["t"] as Vector3).lerp(l2["t"], w2), "r": (o2["r"] as Quaternion).slerp(l2["r"], w2), "s": (o2["s"] as Vector3).lerp(l2["s"], w2)}
	pose_cache = out
	_dirty = false
	return out


func apply_pose() -> void:
	var p: Array = compute_pose()
	for i in p.size():
		skeleton.set_bone_pose_position(i, p[i]["t"])
		skeleton.set_bone_pose_rotation(i, p[i]["r"])
		skeleton.set_bone_pose_scale(i, p[i]["s"])


# ---------- driving ----------
func set_param(n: String, v: Variant) -> RefCounted:
	core.set_param(n, v)
	_dirty = true
	return self


func set_trigger(n: String) -> RefCounted:
	core.set_trigger(n)
	return self


## Step the graph, apply the pose to the skeleton, return {events, transitions, rootMotion, time}.
func update(dt: float = Core.FIXED_DT) -> Dictionary:
	var r: Dictionary = core.step(dt)
	_dirty = true
	apply_pose()
	return r

extends RefCounted
## ai3d navigation providers (grid A* and waypoint graph). Mirrors createGridNav / createWaypointNav in
## templates/web-project/src/lib/ai3d.js (spec/v4/ai3d.md). All math is float64 (plain floats, no Vector3).
## Positions are [x, y, z] Arrays. find_path returns Array of [x,y,z] (excluding `from`) or null.

const SQ2: float = 1.4142135623730951

var kind: String = "grid"
var origin: Array = [0.0, 0.0]
var cell_size: float = 1.0
var width: int = 0
var height: int = 0
var y: float = 0.0
var cells: Array = []
var nodes: Array = []
var adj: Array = []


class Heap:
	var a: Array = []

	func less(p: Array, q: Array) -> bool:
		return p[0] < q[0] or (p[0] == q[0] and (p[1] < q[1] or (p[1] == q[1] and p[2] < q[2])))

	func push(e: Array) -> void:
		var i: int = a.size()
		a.append(e)
		while i > 0:
			var p: int = (i - 1) >> 1
			if not less(a[i], a[p]):
				break
			var tmp: Array = a[i]
			a[i] = a[p]
			a[p] = tmp
			i = p

	func pop() -> Array:
		var top: Array = a[0]
		var last: Array = a.pop_back()
		if a.size() > 0:
			a[0] = last
			var i: int = 0
			while true:
				var l: int = 2 * i + 1
				var r: int = l + 1
				var m: int = i
				if l < a.size() and less(a[l], a[m]):
					m = l
				if r < a.size() and less(a[r], a[m]):
					m = r
				if m == i:
					break
				var tmp: Array = a[i]
				a[i] = a[m]
				a[m] = tmp
				i = m
		return top

	func size() -> int:
		return a.size()


static func d2(a: Array, b: Array) -> float:
	var x: float = a[0] - b[0]
	var z: float = a[2] - b[2]
	return sqrt(x * x + z * z)


static func create_grid(opts: Dictionary) -> RefCounted:
	var n: RefCounted = load("res://scripts/ai3d/ai3d_nav.gd").new()
	n.kind = "grid"
	n.origin = opts.get("origin", [0.0, 0.0])
	n.cell_size = float(opts.get("cellSize", 1.0))
	n.width = int(opts["width"])
	n.height = int(opts["height"])
	n.y = float(opts.get("y", 0.0))
	var bl: Array = opts.get("blocked", [])
	if bl.is_empty():
		bl.resize(n.width * n.height)
		bl.fill(0)
	n.cells = bl
	return n


## Rasterise world boxes ({min,max}) into a grid nav (gridFromBoxes).
static func grid_from_boxes(boxes: Array, opts: Dictionary) -> RefCounted:
	var origin: Array = opts.get("origin", [0.0, 0.0])
	var cs: float = float(opts.get("cellSize", 1.0))
	var w: int = int(opts["width"])
	var h: int = int(opts["height"])
	var inflate: float = float(opts.get("inflate", 0.0))
	var yr: Array = opts.get("yRange", [0.25, 2.0])
	var blocked: Array = []
	blocked.resize(w * h)
	blocked.fill(0)
	for b: Dictionary in boxes:
		if b["max"][1] < yr[0] or b["min"][1] > yr[1]:
			continue
		for j in h:
			for i in w:
				var x0: float = origin[0] + i * cs - inflate
				var x1: float = x0 + cs + 2.0 * inflate
				var z0: float = origin[1] + j * cs - inflate
				var z1: float = z0 + cs + 2.0 * inflate
				if x1 > b["min"][0] and x0 < b["max"][0] and z1 > b["min"][2] and z0 < b["max"][2]:
					blocked[j * w + i] = 1
	return create_grid({"origin": origin, "cellSize": cs, "width": w, "height": h, "blocked": blocked, "y": opts.get("y", 0.0)})


static func create_waypoints(def: Dictionary) -> RefCounted:
	var n: RefCounted = load("res://scripts/ai3d/ai3d_nav.gd").new()
	n.kind = "waypoints"
	n.nodes = def["nodes"]
	var idx: Dictionary = {}
	for i in n.nodes.size():
		idx[n.nodes[i]["id"]] = i
		n.adj.append([])
	for e: Array in def["edges"]:
		if not idx.has(e[0]) or not idx.has(e[1]):
			push_error("edge references unknown node")
			continue
		var i: int = idx[e[0]]
		var j: int = idx[e[1]]
		var c: float = d2(n.nodes[i]["pos"], n.nodes[j]["pos"])
		n.adj[i].append([j, c])
		n.adj[j].append([i, c])
	for l: Array in n.adj:
		l.sort_custom(func(p: Array, q: Array) -> bool: return p[0] < q[0])
	return n


func has_is_clear() -> bool:
	return kind == "grid"


func _cx(x: float) -> int:
	return int(floor((x - origin[0]) / cell_size))


func _cz(z: float) -> int:
	return int(floor((z - origin[1]) / cell_size))


func _free(i: int, j: int) -> bool:
	return i >= 0 and j >= 0 and i < width and j < height and int(cells[j * width + i]) == 0


func _center(i: int, j: int) -> Array:
	return [origin[0] + (i + 0.5) * cell_size, y, origin[1] + (j + 0.5) * cell_size]


func walkable(p: Array) -> bool:
	return _free(_cx(p[0]), _cz(p[2]))


func _nearest(i: int, j: int, max_r: int = 8) -> Variant:
	if _free(i, j):
		return [i, j]
	for r in range(1, max_r + 1):
		var best: Variant = null
		var bd: float = INF
		for b in range(j - r, j + r + 1):
			for a in range(i - r, i + r + 1):
				if maxi(absi(a - i), absi(b - j)) != r or not _free(a, b):
					continue
				var d: float = float((a - i) * (a - i) + (b - j) * (b - j))
				if d < bd:
					bd = d
					best = [a, b]
		if best != null:
			return best
	return null


func is_clear(a: Array, b: Array) -> bool:
	var d: float = d2(a, b)
	var steps: int = maxi(1, int(ceil(d / (cell_size * 0.5))))
	for s in range(0, steps + 1):
		var t: float = float(s) / float(steps)
		var x: float = a[0] + (b[0] - a[0]) * t
		var z: float = a[2] + (b[2] - a[2]) * t
		if not _free(_cx(x), _cz(z)):
			return false
	return true


func find_path(from: Array, to: Array, opts: Dictionary = {}) -> Variant:
	if kind == "grid":
		return _grid_path(from, to, opts)
	return _wp_path(from, to)


func _grid_path(from: Array, to: Array, opts: Dictionary) -> Variant:
	var snap: int = int(opts.get("snap", 4))
	var s: Variant = _nearest(_cx(from[0]), _cz(from[2]), snap)
	var g: Variant = _nearest(_cx(to[0]), _cz(to[2]), snap)
	if s == null or g == null:
		return null
	var n_cells: int = width * height
	var si: int = s[1] * width + s[0]
	var gi: int = g[1] * width + g[0]
	var gc: PackedFloat64Array = PackedFloat64Array()
	gc.resize(n_cells)
	gc.fill(INF)
	var par: PackedInt32Array = PackedInt32Array()
	par.resize(n_cells)
	par.fill(-1)
	var closed: PackedByteArray = PackedByteArray()
	closed.resize(n_cells)
	var gx: int = g[0]
	var gz: int = g[1]
	var hf: Callable = func(i: int) -> float:
		var dx: int = absi((i % width) - gx)
		var dz: int = absi(int(i / width) - gz)
		return float(maxi(dx, dz)) + (SQ2 - 1.0) * float(mini(dx, dz))
	var heap: Heap = Heap.new()
	gc[si] = 0.0
	heap.push([hf.call(si), hf.call(si), si])
	var exp: int = 0
	var cap: int = int(opts.get("maxNodes", n_cells))
	while heap.size() > 0 and exp < cap:
		exp += 1
		var top: Array = heap.pop()
		var cur: int = top[2]
		if closed[cur] != 0:
			continue
		closed[cur] = 1
		if cur == gi:
			break
		var ci: int = cur % width
		var cj: int = int(cur / width)
		for dj in range(-1, 2):
			for di in range(-1, 2):
				if di == 0 and dj == 0:
					continue
				var ni: int = ci + di
				var nj: int = cj + dj
				if not _free(ni, nj):
					continue
				if di != 0 and dj != 0 and (not _free(ci + di, cj) or not _free(ci, cj + dj)):
					continue
				var nn: int = nj * width + ni
				var c: float = gc[cur] + (SQ2 if (di != 0 and dj != 0) else 1.0)
				if c < gc[nn]:
					gc[nn] = c
					par[nn] = cur
					var h: float = hf.call(nn)
					heap.push([c + h, h, nn])
	if gc[gi] == INF:
		return null
	var cells_path: Array = []
	var k: int = gi
	while k != -1:
		cells_path.append(_center(k % width, int(k / width)))
		k = par[k]
	cells_path.reverse()
	var pts: Array = []
	var cur_p: Array = [from[0], y, from[2]]
	var kk: int = 0
	while kk < cells_path.size():
		var far: int = kk
		var m: int = cells_path.size() - 1
		while m > kk:
			if is_clear(cur_p, cells_path[m]):
				far = m
				break
			m -= 1
		pts.append(cells_path[far])
		cur_p = cells_path[far]
		kk = far + 1
	if pts.size() > 0 and walkable(to) and is_clear(pts[pts.size() - 1], [to[0], y, to[2]]):
		pts[pts.size() - 1] = [to[0], y, to[2]]
	if pts.size() > 0:
		return pts
	return [[to[0], y, to[2]]]


func _wp_near(p: Array) -> int:
	var b: int = -1
	var bd: float = INF
	for i in nodes.size():
		var d: float = d2(nodes[i]["pos"], p)
		if d < bd:
			bd = d
			b = i
	return b


func _wp_path(from: Array, to: Array) -> Variant:
	if nodes.is_empty():
		return null
	var s: int = _wp_near(from)
	var g: int = _wp_near(to)
	var cost: PackedFloat64Array = PackedFloat64Array()
	cost.resize(nodes.size())
	cost.fill(INF)
	var par: PackedInt32Array = PackedInt32Array()
	par.resize(nodes.size())
	par.fill(-1)
	var closed: PackedByteArray = PackedByteArray()
	closed.resize(nodes.size())
	var heap: Heap = Heap.new()
	var hs: float = d2(nodes[s]["pos"], nodes[g]["pos"])
	cost[s] = 0.0
	heap.push([hs, hs, s])
	while heap.size() > 0:
		var top: Array = heap.pop()
		var c: int = top[2]
		if closed[c] != 0:
			continue
		closed[c] = 1
		if c == g:
			break
		for e: Array in adj[c]:
			var n: int = e[0]
			var w: float = e[1]
			if cost[c] + w < cost[n]:
				cost[n] = cost[c] + w
				par[n] = c
				var h: float = d2(nodes[n]["pos"], nodes[g]["pos"])
				heap.push([cost[n] + h, h, n])
	if cost[g] == INF:
		return null
	var out: Array = []
	var k: int = g
	while k != -1:
		out.append((nodes[k]["pos"] as Array).duplicate())
		k = par[k]
	out.reverse()
	if out.size() > 0 and d2(out[0], from) < 0.3:
		out.remove_at(0)
	out.append([to[0], to[1], to[2]])
	return out

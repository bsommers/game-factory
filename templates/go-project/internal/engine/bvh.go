package engine

// Deterministic SAH-binned BVH over triangles or AABBs: port of templates/web-project/src/lib/bvh.js
// (spec/v3/bvh.md). Build math is float64; node bounds are stored as float32 rounded OUTWARD so traversal never
// misses. Serialize emits the GPU upload buffer (little-endian 32-bit words). Query results report ORIGINAL
// primitive indices. Products that feed sums are wrapped in float64() to forbid FMA fusion.

import (
	"errors"
	"math"
	"sort"
)

const (
	BVHMagic     = 0x33485642 // 'BVH3'
	BVHVersion   = 1
	BVHKindTri   = 0
	BVHKindAABB  = 1
	bvhNodeWords = 8
	bvhHeader    = 16
	bvhBins      = 16
)

// BVH is a built tree. Nodes are 8 words each: min xyz (f32), leftFirst, max xyz (f32), count (count==0: interior,
// children leftFirst and leftFirst+1; count>0: leaf over prims leftFirst..).
type BVH struct {
	Kind      int
	Count     int
	Stride    int
	NodeCount int
	Nodes     []uint32  // NodeCount*8 words (floats stored as f32 bits)
	Order     []uint32  // leaf index -> original primitive index
	Prims     []float64 // primitives in leaf order
	Src       []float64 // primitives in original order
}

func f32Down(x float64) float32 {
	r := float32(x)
	if float64(r) > x {
		b := math.Float32bits(r)
		switch {
		case r > 0:
			b--
		case r == 0:
			b = 0x80000001
		default:
			b++
		}
		r = math.Float32frombits(b)
	}
	return r
}

func f32Up(x float64) float32 {
	r := float32(x)
	if float64(r) < x {
		b := math.Float32bits(r)
		switch {
		case r >= 0:
			if r == 0 {
				b = 1
			} else {
				b++
			}
		default:
			b--
		}
		r = math.Float32frombits(b)
	}
	return r
}

func (b *BVH) nf(i int) float64 { return float64(math.Float32frombits(b.Nodes[i])) }

type bvhBounds struct{ mn, mx []float64 }

func bvhPrimBounds(kind int, src []float64, n int) (bvhBounds, error) {
	mn, mx := make([]float64, n*3), make([]float64, n*3)
	for i := 0; i < n; i++ {
		for k := 0; k < 3; k++ {
			var lo, hi float64
			if kind == BVHKindTri {
				a, b, c := src[i*9+k], src[i*9+3+k], src[i*9+6+k]
				lo, hi = math.Min(a, math.Min(b, c)), math.Max(a, math.Max(b, c))
			} else {
				lo, hi = src[i*6+k], src[i*6+3+k]
			}
			if math.IsNaN(lo) || math.IsInf(lo, 0) || math.IsNaN(hi) || math.IsInf(hi, 0) {
				return bvhBounds{}, errors.New("bvh: non-finite primitive")
			}
			mn[i*3+k], mx[i*3+k] = lo, hi
		}
	}
	return bvhBounds{mn, mx}, nil
}

func buildBVH(kind int, input []float64, maxLeafSize int) (*BVH, error) {
	st := 6
	if kind == BVHKindTri {
		st = 9
	}
	n := len(input) / st
	src := append([]float64(nil), input[:n*st]...)
	maxLeaf := maxLeafSize
	if maxLeaf < 1 {
		maxLeaf = 1
	}
	pb, err := bvhPrimBounds(kind, src, n)
	if err != nil {
		return nil, err
	}
	mn, mx := pb.mn, pb.mx
	order := make([]uint32, n)
	for i := range order {
		order[i] = uint32(i)
	}
	maxNodes := 2 * n
	if maxNodes < 1 {
		maxNodes = 1
	}
	nodes := make([]uint32, maxNodes*bvhNodeWords)
	tmp := make([]uint32, n)
	used := 1
	type item struct{ node, s, e int }
	stack := []item{{0, 0, n}}
	cen := func(i uint32, k int) float64 { return 0.5 * (mn[int(i)*3+k] + mx[int(i)*3+k]) }
	for len(stack) > 0 {
		it := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		node, s, e := it.node, it.s, it.e
		cnt := e - s
		bmin := [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
		bmax := [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
		for j := s; j < e; j++ {
			i := int(order[j])
			for k := 0; k < 3; k++ {
				if mn[i*3+k] < bmin[k] {
					bmin[k] = mn[i*3+k]
				}
				if mx[i*3+k] > bmax[k] {
					bmax[k] = mx[i*3+k]
				}
			}
		}
		o := node * bvhNodeWords
		if cnt == 0 {
			for k := 0; k < 3; k++ {
				nodes[o+k], nodes[o+4+k] = 0, 0
			}
			nodes[o+3], nodes[o+7] = 0, 0
			continue
		}
		for k := 0; k < 3; k++ {
			nodes[o+k] = math.Float32bits(f32Down(bmin[k]))
			nodes[o+4+k] = math.Float32bits(f32Up(bmax[k]))
		}
		if cnt <= maxLeaf {
			nodes[o+3], nodes[o+7] = uint32(s), uint32(cnt)
			continue
		}
		cmin := [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
		cmax := [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
		for j := s; j < e; j++ {
			i := order[j]
			for k := 0; k < 3; k++ {
				c := cen(i, k)
				if c < cmin[k] {
					cmin[k] = c
				}
				if c > cmax[k] {
					cmax[k] = c
				}
			}
		}
		bestCost := math.Inf(1)
		bestAxis, bestSplit := -1, -1
		for ax := 0; ax < 3; ax++ {
			ext := cmax[ax] - cmin[ax]
			if !(ext > 0) {
				continue
			}
			var bc [bvhBins]uint32
			var bl, bh [bvhBins * 3]float64
			for q := range bl {
				bl[q], bh[q] = math.Inf(1), math.Inf(-1)
			}
			scale := bvhBins / ext
			for j := s; j < e; j++ {
				i := order[j]
				b := int(math.Floor(float64((cen(i, ax) - cmin[ax]) * scale)))
				if b >= bvhBins {
					b = bvhBins - 1
				}
				if b < 0 {
					b = 0
				}
				bc[b]++
				for k := 0; k < 3; k++ {
					if mn[int(i)*3+k] < bl[b*3+k] {
						bl[b*3+k] = mn[int(i)*3+k]
					}
					if mx[int(i)*3+k] > bh[b*3+k] {
						bh[b*3+k] = mx[int(i)*3+k]
					}
				}
			}
			var lA [bvhBins - 1]float64
			var lC [bvhBins - 1]uint32
			var c0 uint32
			lo := [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
			hi := [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
			for b := 0; b < bvhBins-1; b++ {
				c0 += bc[b]
				if bc[b] != 0 {
					for k := 0; k < 3; k++ {
						lo[k] = math.Min(lo[k], bl[b*3+k])
						hi[k] = math.Max(hi[k], bh[b*3+k])
					}
				}
				lC[b] = c0
				dx, dy, dz := hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]
				if c0 != 0 {
					lA[b] = float64(dx*dy) + float64(dy*dz) + float64(dz*dx)
				} else {
					lA[b] = 0
				}
			}
			var c1 uint32
			lo2 := [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
			hi2 := [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
			for b := bvhBins - 1; b >= 1; b-- {
				c1 += bc[b]
				if bc[b] != 0 {
					for k := 0; k < 3; k++ {
						lo2[k] = math.Min(lo2[k], bl[b*3+k])
						hi2[k] = math.Max(hi2[k], bh[b*3+k])
					}
				}
				sp := b - 1
				if lC[sp] == 0 || c1 == 0 {
					continue
				}
				dx, dy, dz := hi2[0]-lo2[0], hi2[1]-lo2[1], hi2[2]-lo2[2]
				cost := float64(float64(lC[sp])*lA[sp]) + float64(float64(c1)*(float64(dx*dy)+float64(dy*dz)+float64(dz*dx)))
				if cost < bestCost || (cost == bestCost && ax == bestAxis && sp < bestSplit) {
					bestCost, bestAxis, bestSplit = cost, ax, sp
				}
			}
		}
		var mid int
		if bestAxis < 0 {
			mid = s + (cnt >> 1)
		} else {
			ext := cmax[bestAxis] - cmin[bestAxis]
			scale := bvhBins / ext
			l, r := 0, 0
			for j := s; j < e; j++ {
				i := order[j]
				b := int(math.Floor(float64((cen(i, bestAxis) - cmin[bestAxis]) * scale)))
				if b >= bvhBins {
					b = bvhBins - 1
				}
				if b < 0 {
					b = 0
				}
				if b <= bestSplit {
					order[s+l] = i
					l++
				} else {
					tmp[r] = i
					r++
				}
			}
			for q := 0; q < r; q++ {
				order[s+l+q] = tmp[q]
			}
			mid = s + l
		}
		left := used
		used += 2
		nodes[o+3], nodes[o+7] = uint32(left), 0
		stack = append(stack, item{left + 1, mid, e}, item{left, s, mid})
	}
	prims := make([]float64, n*st)
	for j := 0; j < n; j++ {
		for q := 0; q < st; q++ {
			prims[j*st+q] = src[int(order[j])*st+q]
		}
	}
	return &BVH{Kind: kind, Count: n, Stride: st, NodeCount: used, Nodes: nodes[:used*bvhNodeWords], Order: order, Prims: prims, Src: src}, nil
}

// BuildTriangles builds a BVH over a flat triangle soup (9 numbers per triangle).
func BuildTriangles(tris []float64, maxLeafSize int) (*BVH, error) {
	return buildBVH(BVHKindTri, tris, maxLeafSize)
}

// BuildAABBs builds a BVH over flat boxes (minx,miny,minz,maxx,maxy,maxz).
func BuildAABBs(boxes []float64, maxLeafSize int) (*BVH, error) {
	return buildBVH(BVHKindAABB, boxes, maxLeafSize)
}

// Refit recomputes node bounds for new primitive data (original order, same count); topology is unchanged.
func (bv *BVH) Refit(input []float64) error {
	st, n := bv.Stride, bv.Count
	if len(input) < n*st {
		return errors.New("bvh.refit: not enough numbers")
	}
	copy(bv.Src, input[:n*st])
	for j := 0; j < n; j++ {
		for q := 0; q < st; q++ {
			bv.Prims[j*st+q] = bv.Src[int(bv.Order[j])*st+q]
		}
	}
	P := bv.Prims
	for node := bv.NodeCount - 1; node >= 0; node-- {
		o := node * bvhNodeWords
		cnt := int(bv.Nodes[o+7])
		lo := [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
		hi := [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
		if cnt > 0 {
			for j := int(bv.Nodes[o+3]); j < int(bv.Nodes[o+3])+cnt; j++ {
				for k := 0; k < 3; k++ {
					var a, b float64
					if bv.Kind == BVHKindTri {
						x, y, z := P[j*9+k], P[j*9+3+k], P[j*9+6+k]
						a, b = math.Min(x, math.Min(y, z)), math.Max(x, math.Max(y, z))
					} else {
						a, b = P[j*6+k], P[j*6+3+k]
					}
					if a < lo[k] {
						lo[k] = a
					}
					if b > hi[k] {
						hi[k] = b
					}
				}
			}
		} else if bv.Nodes[o+3] != 0 {
			l := int(bv.Nodes[o+3]) * bvhNodeWords
			r := l + bvhNodeWords
			for k := 0; k < 3; k++ {
				lo[k] = math.Min(bv.nf(l+k), bv.nf(r+k))
				hi[k] = math.Max(bv.nf(l+4+k), bv.nf(r+4+k))
			}
		} else {
			continue
		}
		for k := 0; k < 3; k++ {
			bv.Nodes[o+k] = math.Float32bits(f32Down(lo[k]))
			bv.Nodes[o+4+k] = math.Float32bits(f32Up(hi[k]))
		}
	}
	return nil
}

// Serialize returns the little-endian buffer layout of spec/v3/bvh.md as 32-bit words.
func (bv *BVH) SerializeWords() []uint32 {
	st, nw, n := bv.Stride, bv.NodeCount*bvhNodeWords, bv.Count
	nodesOff := bvhHeader
	orderOff := nodesOff + nw
	primsOff := orderOff + n
	total := primsOff + n*st
	u := make([]uint32, total)
	u[0], u[1], u[2], u[3], u[4] = BVHMagic, BVHVersion, uint32(bv.Kind), uint32(bv.NodeCount), uint32(n)
	u[5], u[6], u[7], u[8], u[9] = uint32(nodesOff), uint32(orderOff), uint32(primsOff), uint32(st), 0
	copy(u[nodesOff:], bv.Nodes[:nw])
	copy(u[orderOff:], bv.Order)
	for i := 0; i < n*st; i++ {
		u[primsOff+i] = math.Float32bits(float32(bv.Prims[i]))
	}
	return u
}

// Serialize returns the buffer as little-endian bytes.
func (bv *BVH) Serialize() []byte {
	w := bv.SerializeWords()
	out := make([]byte, len(w)*4)
	for i, x := range w {
		out[i*4], out[i*4+1], out[i*4+2], out[i*4+3] = byte(x), byte(x>>8), byte(x>>16), byte(x>>24)
	}
	return out
}

// FNV1a32Bytes is the 32-bit FNV-1a hash of b.
func FNV1a32Bytes(b []byte) uint32 {
	h := uint32(0x811c9dc5)
	for _, c := range b {
		h ^= uint32(c)
		h *= 0x01000193
	}
	return h
}

// DeserializeBVH rebuilds a BVH from a serialized buffer.
func DeserializeBVH(buf []byte) (*BVH, error) {
	if len(buf) < bvhHeader*4 || len(buf)%4 != 0 {
		return nil, errors.New("bvh: corrupt buffer")
	}
	u := make([]uint32, len(buf)/4)
	for i := range u {
		u[i] = uint32(buf[i*4]) | uint32(buf[i*4+1])<<8 | uint32(buf[i*4+2])<<16 | uint32(buf[i*4+3])<<24
	}
	if u[0] != BVHMagic {
		return nil, errors.New("bvh: bad magic")
	}
	if u[1] != BVHVersion {
		return nil, errors.New("bvh: unsupported version")
	}
	kind, nodeCount, n := int(u[2]), int(u[3]), int(u[4])
	nodesOff, orderOff, primsOff := int(u[5]), int(u[6]), int(u[7])
	st := 6
	if kind == BVHKindTri {
		st = 9
	}
	if int(u[8]) != st || len(u) < primsOff+n*st {
		return nil, errors.New("bvh: corrupt buffer")
	}
	bv := &BVH{Kind: kind, Count: n, Stride: st, NodeCount: nodeCount,
		Nodes: append([]uint32(nil), u[nodesOff:nodesOff+nodeCount*bvhNodeWords]...),
		Order: append([]uint32(nil), u[orderOff:orderOff+n]...), Prims: make([]float64, n*st), Src: make([]float64, n*st)}
	for i := 0; i < n*st; i++ {
		bv.Prims[i] = float64(math.Float32frombits(u[primsOff+i]))
	}
	for j := 0; j < n; j++ {
		for q := 0; q < st; q++ {
			bv.Src[int(bv.Order[j])*st+q] = bv.Prims[j*st+q]
		}
	}
	return bv, nil
}

// ---- queries ----

func bvhSlab(bv *BVH, o int, ox, oy, oz, ix, iy, iz, tmax float64) float64 {
	tn, tf := 0.0, math.Inf(1)
	slabAxis := func(ov, inv float64, lo, hi float64) bool {
		if inv == 0 {
			return ov >= lo && ov <= hi
		}
		t1, t2 := float64((lo-ov)*inv), float64((hi-ov)*inv)
		l, h := t2, t1
		if t1 < t2 {
			l, h = t1, t2
		}
		if l > tn {
			tn = l
		}
		if h < tf {
			tf = h
		}
		return true
	}
	if !slabAxis(ox, ix, bv.nf(o), bv.nf(o+4)) || !slabAxis(oy, iy, bv.nf(o+1), bv.nf(o+5)) || !slabAxis(oz, iz, bv.nf(o+2), bv.nf(o+6)) {
		return -1
	}
	tf = float64(tf*(1+1e-6)) + 1e-30
	if tn <= tf && tn <= tmax {
		return tn
	}
	return -1
}

func bvhInv(d float64) float64 {
	if d == 0 {
		return 0
	}
	return 1 / d
}

func (bv *BVH) primRay(j int, ox, oy, oz, dx, dy, dz, tmax float64, cull bool, out *[3]float64) float64 {
	if bv.Kind == BVHKindTri {
		return RayTriangleFlat(ox, oy, oz, dx, dy, dz, bv.Prims, j*9, 0, tmax, cull, out)
	}
	P, q := bv.Prims, j*6
	O, D := [3]float64{ox, oy, oz}, [3]float64{dx, dy, dz}
	tn, tf := 0.0, tmax
	for i := 0; i < 3; i++ {
		if D[i] == 0 {
			if O[i] < P[q+i] || O[i] > P[q+3+i] {
				return -1
			}
			continue
		}
		t1, t2 := (P[q+i]-O[i])/D[i], (P[q+3+i]-O[i])/D[i]
		if t1 > t2 {
			t1, t2 = t2, t1
		}
		if t1 > tn {
			tn = t1
		}
		if t2 < tf {
			tf = t2
		}
	}
	if tn <= tf {
		return tn
	}
	return -1
}

// BVHHit is the closest raycast hit: ties go to the lowest original index.
type BVHHit struct {
	T     float64
	Index int
	U, V  float64
	Front bool
	Point V3
}

// BVHRayOpts are raycast options; Tmax defaults to +Inf when zero-valued via HasTmax=false.
type BVHRayOpts struct {
	Any      bool
	CullBack bool
	Tmax     float64
	HasTmax  bool
}

// Raycast returns the closest hit of o + t*d or nil.
func (bv *BVH) Raycast(o, d V3, opts BVHRayOpts) *BVHHit {
	tmax := math.Inf(1)
	if opts.HasTmax {
		tmax = opts.Tmax
	}
	if bv.Count == 0 {
		return nil
	}
	ix, iy, iz := bvhInv(d[0]), bvhInv(d[1]), bvhInv(d[2])
	var best *BVHHit
	stack := make([]int, 0, 64)
	stack = append(stack, 0)
	var tmp [3]float64
	if bvhSlab(bv, 0, o[0], o[1], o[2], ix, iy, iz, tmax) < 0 {
		return nil
	}
	for len(stack) > 0 {
		node := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		w := node * bvhNodeWords
		cnt := int(bv.Nodes[w+7])
		if cnt > 0 {
			for j := int(bv.Nodes[w+3]); j < int(bv.Nodes[w+3])+cnt; j++ {
				t := bv.primRay(j, o[0], o[1], o[2], d[0], d[1], d[2], tmax, opts.CullBack, &tmp)
				if t < 0 {
					continue
				}
				idx := int(bv.Order[j])
				if best == nil || t < best.T || (t == best.T && idx < best.Index) {
					best = &BVHHit{T: t, Index: idx, U: tmp[0], V: tmp[1], Front: tmp[2] > 0}
					tmax = t
					if opts.Any {
						best.Point = V3{o[0] + float64(d[0]*t), o[1] + float64(d[1]*t), o[2] + float64(d[2]*t)}
						return best
					}
				}
			}
		} else {
			l := int(bv.Nodes[w+3])
			r := l + 1
			tl := bvhSlab(bv, l*bvhNodeWords, o[0], o[1], o[2], ix, iy, iz, tmax)
			tr := bvhSlab(bv, r*bvhNodeWords, o[0], o[1], o[2], ix, iy, iz, tmax)
			if tl >= 0 && tr >= 0 {
				if tr < tl {
					stack = append(stack, l, r)
				} else {
					stack = append(stack, r, l)
				}
			} else if tl >= 0 {
				stack = append(stack, l)
			} else if tr >= 0 {
				stack = append(stack, r)
			}
		}
	}
	if best != nil {
		best.Point = V3{o[0] + float64(d[0]*best.T), o[1] + float64(d[1]*best.T), o[2] + float64(d[2]*best.T)}
	}
	return best
}

// RayAny reports whether the ray hits anything.
func (bv *BVH) RayAny(o, d V3, opts BVHRayOpts) bool {
	opts.Any = true
	return bv.Raycast(o, d, opts) != nil
}

func (bv *BVH) walk(nodeTest func(w int) bool, primTest func(j int) bool) []int {
	out := []int{}
	if bv.Count == 0 {
		return out
	}
	stack := []int{0}
	for len(stack) > 0 {
		node := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		w := node * bvhNodeWords
		if !nodeTest(w) {
			continue
		}
		cnt := int(bv.Nodes[w+7])
		if cnt > 0 {
			for j := int(bv.Nodes[w+3]); j < int(bv.Nodes[w+3])+cnt; j++ {
				if primTest(j) {
					out = append(out, int(bv.Order[j]))
				}
			}
		} else {
			stack = append(stack, int(bv.Nodes[w+3])+1, int(bv.Nodes[w+3]))
		}
	}
	sort.Ints(out)
	return out
}

func (bv *BVH) primBox(j int) [6]float64 {
	P := bv.Prims
	if bv.Kind == BVHKindAABB {
		return [6]float64{P[j*6], P[j*6+1], P[j*6+2], P[j*6+3], P[j*6+4], P[j*6+5]}
	}
	q := j * 9
	var r [6]float64
	for k := 0; k < 3; k++ {
		r[k] = math.Min(P[q+k], math.Min(P[q+3+k], P[q+6+k]))
		r[3+k] = math.Max(P[q+k], math.Max(P[q+3+k], P[q+6+k]))
	}
	return r
}

func (bv *BVH) nodeOverlaps(w int, lo, hi V3) bool {
	return bv.nf(w) <= hi[0] && bv.nf(w+4) >= lo[0] && bv.nf(w+1) <= hi[1] && bv.nf(w+5) >= lo[1] && bv.nf(w+2) <= hi[2] && bv.nf(w+6) >= lo[2]
}

// QueryAABB returns ascending original indices of prims overlapping the box inclusively (triangles: exact SAT).
func (bv *BVH) QueryAABB(box AABB3) []int {
	lo, hi := box.Min, box.Max
	return bv.walk(func(w int) bool { return bv.nodeOverlaps(w, lo, hi) }, func(j int) bool {
		if bv.Kind == BVHKindAABB {
			b := bv.primBox(j)
			return b[0] <= hi[0] && b[3] >= lo[0] && b[1] <= hi[1] && b[4] >= lo[1] && b[2] <= hi[2] && b[5] >= lo[2]
		}
		q, P := j*9, bv.Prims
		return AABBTriangleOverlap(box, Tri{{P[q], P[q+1], P[q+2]}, {P[q+3], P[q+4], P[q+5]}, {P[q+6], P[q+7], P[q+8]}})
	})
}

// QuerySphere returns prims within distance r (inclusive) of centre c.
func (bv *BVH) QuerySphere(c V3, r float64) []int {
	r2 := float64(r * r)
	d2box := func(lo0, lo1, lo2, hi0, hi1, hi2 float64) float64 {
		x := math.Max(math.Max(lo0-c[0], 0), c[0]-hi0)
		y := math.Max(math.Max(lo1-c[1], 0), c[1]-hi1)
		z := math.Max(math.Max(lo2-c[2], 0), c[2]-hi2)
		return float64(x*x) + float64(y*y) + float64(z*z)
	}
	return bv.walk(func(w int) bool {
		return d2box(bv.nf(w), bv.nf(w+1), bv.nf(w+2), bv.nf(w+4), bv.nf(w+5), bv.nf(w+6)) <= r2
	}, func(j int) bool {
		if bv.Kind == BVHKindAABB {
			b := bv.primBox(j)
			return d2box(b[0], b[1], b[2], b[3], b[4], b[5]) <= r2
		}
		q, P := j*9, bv.Prims
		p := ClosestPointTriangle(c, V3{P[q], P[q+1], P[q+2]}, V3{P[q+3], P[q+4], P[q+5]}, V3{P[q+6], P[q+7], P[q+8]})
		x, y, z := p[0]-c[0], p[1]-c[1], p[2]-c[2]
		return float64(x*x)+float64(y*y)+float64(z*z) <= r2
	})
}

// AsWorld adapts a triangle BVH as a sweep TriWorld (broad phase by per-triangle bounds, conservative, ascending).
func (bv *BVH) AsWorld() (TriWorld, error) {
	if bv.Kind != BVHKindTri {
		return TriWorld{}, errors.New("bvh.asWorld: triangle BVH required")
	}
	return TriWorld{Tris: bv.Src, Count: bv.Count, Candidates: func(lo, hi V3) []int {
		return bv.walk(func(w int) bool { return bv.nodeOverlaps(w, lo, hi) }, func(j int) bool {
			b := bv.primBox(j)
			return b[0] <= hi[0] && b[3] >= lo[0] && b[1] <= hi[1] && b[4] >= lo[1] && b[2] <= hi[2] && b[5] >= lo[2]
		})
	}}, nil
}

// BVHStats summarises tree shape.
type BVHStats struct{ Nodes, Leaves, MaxDepth, MaxLeaf int }

func (bv *BVH) Stats() BVHStats {
	var s BVHStats
	s.Nodes = bv.NodeCount
	type nd struct{ n, d int }
	st := []nd{{0, 1}}
	for len(st) > 0 {
		x := st[len(st)-1]
		st = st[:len(st)-1]
		if x.d > s.MaxDepth {
			s.MaxDepth = x.d
		}
		w := x.n * bvhNodeWords
		c := int(bv.Nodes[w+7])
		if c > 0 {
			s.Leaves++
			if c > s.MaxLeaf {
				s.MaxLeaf = c
			}
		} else if bv.Nodes[w+3] != 0 {
			l := int(bv.Nodes[w+3])
			st = append(st, nd{l, x.d + 1}, nd{l + 1, x.d + 1})
		}
	}
	return s
}

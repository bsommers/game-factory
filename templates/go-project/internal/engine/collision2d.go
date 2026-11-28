package engine

// 2D collision toolkit: port of templates/web-project/src/lib/collision2d.js (spec/v2/collision2d.md).
// x right, y DOWN, angles in radians. float64 only, no randomness. Operation order mirrors the JS reference;
// products that feed sums are wrapped in float64() so a compiler can never fuse them into an FMA.

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"unicode/utf16"
)

const c2EPS = 1e-9

// Tile kinds for Tilemap.
const (
	TileEmpty    = 0
	TileSolid    = 1
	TileOneway   = 2
	TileSlopeR   = 3
	TileSlopeL   = 4
	TileSlopeRLo = 5
	TileSlopeRHi = 6
	TileSlopeLHi = 7
	TileSlopeLLo = 8
)

// tileSlopes maps a slope tile kind to [left, right] floor height fractions.
var tileSlopes = map[int][2]float64{3: {0, 1}, 4: {1, 0}, 5: {0, 0.5}, 6: {0.5, 1}, 7: {1, 0.5}, 8: {0.5, 0}}

type Vec2 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Shape is a plain-data 2D shape: "aabb", "circle", "obb", "polygon" or "capsule" (position = centre).
type Shape struct {
	Type   string  `json:"type"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	HW     float64 `json:"hw,omitempty"`
	HH     float64 `json:"hh,omitempty"`
	R      float64 `json:"r,omitempty"`
	HL     float64 `json:"hl,omitempty"`
	Angle  float64 `json:"angle,omitempty"`
	Points []Vec2  `json:"points,omitempty"`
}

func AABB(x, y, hw, hh float64) Shape { return Shape{Type: "aabb", X: x, Y: y, HW: hw, HH: hh} }
func Circle(x, y, r float64) Shape    { return Shape{Type: "circle", X: x, Y: y, R: r} }
func OBB(x, y, hw, hh, angle float64) Shape {
	return Shape{Type: "obb", X: x, Y: y, HW: hw, HH: hh, Angle: angle}
}
func Polygon(x, y float64, pts []Vec2, angle float64) Shape {
	return Shape{Type: "polygon", X: x, Y: y, Points: pts, Angle: angle}
}
func Capsule(x, y, hl, r, angle float64) Shape {
	return Shape{Type: "capsule", X: x, Y: y, HL: hl, R: r, Angle: angle}
}

// Translate returns a copy of s shifted by (dx, dy).
func Translate(s Shape, dx, dy float64) Shape { s.X += dx; s.Y += dy; return s }

func AABBFromBounds(b Bounds) Shape {
	return AABB((b.MinX+b.MaxX)/2, (b.MinY+b.MaxY)/2, (b.MaxX-b.MinX)/2, (b.MaxY-b.MinY)/2)
}

type Bounds struct {
	MinX float64 `json:"minX"`
	MinY float64 `json:"minY"`
	MaxX float64 `json:"maxX"`
	MaxY float64 `json:"maxY"`
}

func BoundsOverlap(a, b Bounds) bool {
	return a.MinX <= b.MaxX && a.MaxX >= b.MinX && a.MinY <= b.MaxY && a.MaxY >= b.MinY
}

// CanCollide is the layer/mask filter: each side's layer must be in the other's mask (32-bit AND).
func CanCollide(layerA, maskA, layerB, maskB int32) bool {
	return layerA&maskB != 0 && layerB&maskA != 0
}

type Manifold struct {
	Normal Vec2        `json:"normal"`
	Depth  float64     `json:"depth"`
	Points []ContactPt `json:"points"`
}

type ContactPt struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Depth float64 `json:"depth"`
}

type Hull struct {
	V []Vec2
	R float64
}

func area2(v []Vec2) float64 {
	s := 0.0
	for i := range v {
		p, q := v[i], v[(i+1)%len(v)]
		s += float64(p.X*q.Y) - float64(q.X*p.Y)
	}
	return s
}

// HullOf reduces a shape to a world-space hull (polygons get positive winding).
func HullOf(s Shape) Hull {
	switch s.Type {
	case "circle":
		return Hull{V: []Vec2{{s.X, s.Y}}, R: s.R}
	case "aabb":
		return Hull{V: []Vec2{{s.X - s.HW, s.Y - s.HH}, {s.X + s.HW, s.Y - s.HH}, {s.X + s.HW, s.Y + s.HH}, {s.X - s.HW, s.Y + s.HH}}}
	case "obb", "polygon":
		c, sn := math.Cos(s.Angle), math.Sin(s.Angle)
		pts := s.Points
		if s.Type == "obb" {
			pts = []Vec2{{-s.HW, -s.HH}, {s.HW, -s.HH}, {s.HW, s.HH}, {-s.HW, s.HH}}
		}
		v := make([]Vec2, len(pts))
		for i, p := range pts {
			v[i] = Vec2{s.X + float64(p.X*c) - float64(p.Y*sn), s.Y + float64(p.X*sn) + float64(p.Y*c)}
		}
		if area2(v) < 0 {
			for i, j := 0, len(v)-1; i < j; i, j = i+1, j-1 {
				v[i], v[j] = v[j], v[i]
			}
		}
		return Hull{V: v}
	case "capsule":
		c, sn := math.Cos(s.Angle), math.Sin(s.Angle)
		return Hull{V: []Vec2{{s.X - float64(s.HL*c), s.Y - float64(s.HL*sn)}, {s.X + float64(s.HL*c), s.Y + float64(s.HL*sn)}}, R: s.R}
	}
	panic("collision2d: unknown shape type " + s.Type)
}

// BoundsOf is the world bounds of a shape.
func BoundsOf(s Shape) Bounds {
	if s.Type == "aabb" {
		return Bounds{s.X - s.HW, s.Y - s.HH, s.X + s.HW, s.Y + s.HH}
	}
	if s.Type == "circle" {
		return Bounds{s.X - s.R, s.Y - s.R, s.X + s.R, s.Y + s.R}
	}
	h := HullOf(s)
	minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range h.V {
		if p.X < minX {
			minX = p.X
		}
		if p.Y < minY {
			minY = p.Y
		}
		if p.X > maxX {
			maxX = p.X
		}
		if p.Y > maxY {
			maxY = p.Y
		}
	}
	return Bounds{minX - h.R, minY - h.R, maxX + h.R, maxY + h.R}
}

func hyp2(x, y float64) float64 { return math.Sqrt(float64(x*x) + float64(y*y)) }

type face2 struct {
	i      int
	p      Vec2
	nx, ny float64
}

func faces2(h Hull) []face2 {
	v := h.V
	n := len(v)
	var out []face2
	if n < 2 {
		return out
	}
	for i := 0; i < n; i++ {
		p, q := v[i], v[(i+1)%n]
		ex, ey := q.X-p.X, q.Y-p.Y
		l := hyp2(ex, ey)
		if l == 0 {
			continue
		}
		out = append(out, face2{i, p, ey / l, -ex / l})
	}
	if n == 2 {
		a, b := v[0], v[1]
		ex, ey := b.X-a.X, b.Y-a.Y
		l := hyp2(ex, ey)
		if l > 0 {
			out = append(out, face2{-1, b, ex / l, ey / l})
			out = append(out, face2{-1, a, -ex / l, -ey / l})
		}
	}
	return out
}

func minDot2(h Hull, f face2) float64 {
	m := math.Inf(1)
	for _, p := range h.V {
		d := float64((p.X-f.p.X)*f.nx) + float64((p.Y-f.p.Y)*f.ny)
		if d < m {
			m = d
		}
	}
	return m
}

func separation2(A, B Hull) (best float64, bf *face2, fromA bool) {
	best = math.Inf(-1)
	fromA = true
	fa := faces2(A)
	for k := range fa {
		s := minDot2(B, fa[k])
		if s > best {
			best, bf, fromA = s, &fa[k], true
		}
	}
	fb := faces2(B)
	for k := range fb {
		s := minDot2(A, fb[k])
		if s > best+c2EPS {
			best, bf, fromA = s, &fb[k], false
		}
	}
	return
}

func segClosest2(px, py, ax, ay, bx, by float64) Vec2 {
	ex, ey := bx-ax, by-ay
	l2 := float64(ex*ex) + float64(ey*ey)
	t := 0.0
	if l2 > 0 {
		t = (float64((px-ax)*ex) + float64((py-ay)*ey)) / l2
	}
	if t < 0 {
		t = 0
	} else if t > 1 {
		t = 1
	}
	return Vec2{ax + float64(ex*t), ay + float64(ey*t)}
}

func edgesOf2(h Hull) [][2]Vec2 {
	v := h.V
	n := len(v)
	if n == 1 {
		return [][2]Vec2{{v[0], v[0]}}
	}
	if n == 2 {
		return [][2]Vec2{{v[0], v[1]}}
	}
	out := make([][2]Vec2, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, [2]Vec2{v[i], v[(i+1)%n]})
	}
	return out
}

type closestPair2 struct {
	dist   float64
	pA, pB Vec2
	n      Vec2
}

func closestPairOf(A, B Hull) closestPair2 {
	best := math.Inf(1)
	var pA, pB Vec2
	ea, eb := edgesOf2(A), edgesOf2(B)
	for _, v := range A.V {
		for _, e := range eb {
			c := segClosest2(v.X, v.Y, e[0].X, e[0].Y, e[1].X, e[1].Y)
			dx, dy := c.X-v.X, c.Y-v.Y
			d2 := float64(dx*dx) + float64(dy*dy)
			if d2 < best {
				best, pA, pB = d2, v, c
			}
		}
	}
	for _, w := range B.V {
		for _, e := range ea {
			c := segClosest2(w.X, w.Y, e[0].X, e[0].Y, e[1].X, e[1].Y)
			dx, dy := w.X-c.X, w.Y-c.Y
			d2 := float64(dx*dx) + float64(dy*dy)
			if d2 < best {
				best, pA, pB = d2, c, w
			}
		}
	}
	dist := math.Sqrt(best)
	n := Vec2{1, 0}
	if dist > 0 {
		n = Vec2{(pB.X - pA.X) / dist, (pB.Y - pA.Y) / dist}
	}
	return closestPair2{dist, pA, pB, n}
}

func clipLine2(p0, p1 Vec2, nx, ny, off float64) []Vec2 {
	d0 := float64(p0.X*nx) + float64(p0.Y*ny) - off
	d1 := float64(p1.X*nx) + float64(p1.Y*ny) - off
	var out []Vec2
	if d0 <= 0 {
		out = append(out, p0)
	}
	if d1 <= 0 {
		out = append(out, p1)
	}
	if d0*d1 < 0 {
		t := d0 / (d0 - d1)
		out = append(out, Vec2{p0.X + float64((p1.X-p0.X)*t), p0.Y + float64((p1.Y-p0.Y)*t)})
	}
	return out
}

func clipManifoldPoints2(A, B Hull, fromA bool, f face2) []ContactPt {
	ref, inc := B, A
	if fromA {
		ref, inc = A, B
	}
	n, m := len(inc.V), len(ref.V)
	v1, v2 := ref.V[f.i], ref.V[(f.i+1)%m]
	bi, bd := 0, math.Inf(1)
	for i := 0; i < n; i++ {
		p, q := inc.V[i], inc.V[(i+1)%n]
		ex, ey := q.X-p.X, q.Y-p.Y
		l := hyp2(ex, ey)
		if l == 0 {
			continue
		}
		d := float64((ey/l)*f.nx) + float64((-ex/l)*f.ny)
		if d < bd {
			bd, bi = d, i
		}
	}
	p0, p1 := inc.V[bi], inc.V[(bi+1)%n]
	tx, ty := v2.X-v1.X, v2.Y-v1.Y
	tl := hyp2(tx, ty)
	tx /= tl
	ty /= tl
	c1 := clipLine2(p0, p1, -tx, -ty, -(float64(v1.X*tx) + float64(v1.Y*ty)))
	if len(c1) < 2 {
		return nil
	}
	c2 := clipLine2(c1[0], c1[1], tx, ty, float64(v2.X*tx)+float64(v2.Y*ty))
	if len(c2) < 2 {
		return nil
	}
	var pts []ContactPt
	for _, p := range c2 {
		sep := float64((p.X-v1.X)*f.nx) + float64((p.Y-v1.Y)*f.ny)
		if sep <= c2EPS {
			pts = append(pts, ContactPt{p.X - float64(f.nx*sep)/2, p.Y - float64(f.ny*sep)/2, math.Max(0, -sep)})
		}
	}
	return pts
}

func collideAABB2(a, b Shape) *Manifold {
	dx, dy := b.X-a.X, b.Y-a.Y
	ox := a.HW + b.HW - math.Abs(dx)
	oy := a.HH + b.HH - math.Abs(dy)
	if ox <= 0 || oy <= 0 {
		return nil
	}
	x0, x1 := math.Max(a.X-a.HW, b.X-b.HW), math.Min(a.X+a.HW, b.X+b.HW)
	y0, y1 := math.Max(a.Y-a.HH, b.Y-b.HH), math.Min(a.Y+a.HH, b.Y+b.HH)
	if ox < oy {
		xm := (x0 + x1) / 2
		nx := 1.0
		if dx < 0 {
			nx = -1
		}
		return &Manifold{Vec2{nx, 0}, ox, []ContactPt{{xm, y0, ox}, {xm, y1, ox}}}
	}
	ym := (y0 + y1) / 2
	ny := 1.0
	if dy < 0 {
		ny = -1
	}
	return &Manifold{Vec2{0, ny}, oy, []ContactPt{{x0, ym, oy}, {x1, ym, oy}}}
}

func collideHulls2(A, B Hull) *Manifold {
	rr := A.R + B.R
	best, f, fromA := separation2(A, B)
	if f == nil || best > 0 {
		if rr == 0 && f != nil {
			return nil
		}
		cp := closestPairOf(A, B)
		depth := rr - cp.dist
		if depth <= 0 {
			return nil
		}
		sax, say := cp.pA.X+float64(cp.n.X*A.R), cp.pA.Y+float64(cp.n.Y*A.R)
		sbx, sby := cp.pB.X-float64(cp.n.X*B.R), cp.pB.Y-float64(cp.n.Y*B.R)
		pts := []ContactPt{{(sax + sbx) / 2, (say + sby) / 2, depth}}
		n := cp.n
		if len(B.V) == 2 || len(A.V) == 2 {
			segB := len(B.V) == 2
			var two []ContactPt
			vs := A.V
			if segB {
				vs = B.V
			}
			for _, v := range vs {
				var s float64
				if segB {
					s = float64((v.X-cp.pA.X)*n.X) + float64((v.Y-cp.pA.Y)*n.Y)
				} else {
					s = float64((cp.pB.X-v.X)*n.X) + float64((cp.pB.Y-v.Y)*n.Y)
				}
				d := rr - s
				if d > 0 {
					if segB {
						two = append(two, ContactPt{v.X - float64(n.X*B.R) + float64(n.X*d)/2, v.Y - float64(n.Y*B.R) + float64(n.Y*d)/2, d})
					} else {
						two = append(two, ContactPt{v.X + float64(n.X*A.R) - float64(n.X*d)/2, v.Y + float64(n.Y*A.R) - float64(n.Y*d)/2, d})
					}
				}
			}
			if len(two) == 2 {
				pts = two
			}
		}
		return &Manifold{n, depth, pts}
	}
	depth := rr - best
	if depth <= 0 {
		return nil
	}
	n := Vec2{f.nx, f.ny}
	if !fromA {
		n = Vec2{-f.nx, -f.ny}
	}
	var pts []ContactPt
	if rr == 0 && len(A.V) >= 3 && len(B.V) >= 3 {
		pts = clipManifoldPoints2(A, B, fromA, *f)
	}
	if len(pts) == 0 {
		other := A
		if fromA {
			other = B
		}
		type cand struct {
			k int
			v Vec2
			s float64
		}
		cs := make([]cand, len(other.V))
		for k, v := range other.V {
			cs[k] = cand{k, v, float64((v.X-f.p.X)*f.nx) + float64((v.Y-f.p.Y)*f.ny)}
		}
		sort.SliceStable(cs, func(i, j int) bool {
			d := cs[i].s - cs[j].s
			if d != 0 {
				return d < 0
			}
			return cs[i].k < cs[j].k
		})
		if len(cs) > 2 {
			cs = cs[:2]
		}
		pts = []ContactPt{}
		for _, c := range cs {
			d := rr - c.s
			if d <= 0 && len(pts) > 0 {
				break
			}
			dd := math.Max(d, 0)
			if fromA {
				pts = append(pts, ContactPt{c.v.X - float64(n.X*B.R) + float64(n.X*dd)/2, c.v.Y - float64(n.Y*B.R) + float64(n.Y*dd)/2, dd})
			} else {
				pts = append(pts, ContactPt{c.v.X + float64(n.X*A.R) - float64(n.X*dd)/2, c.v.Y + float64(n.Y*A.R) - float64(n.Y*dd)/2, dd})
			}
		}
	}
	return &Manifold{n, depth, pts}
}

// Collide returns the contact manifold between two shapes (normal from a toward b), or nil.
func Collide(a, b Shape) *Manifold {
	if a.Type == "aabb" && b.Type == "aabb" {
		return collideAABB2(a, b)
	}
	return collideHulls2(HullOf(a), HullOf(b))
}

func Overlaps2D(a, b Shape) bool { return Collide(a, b) != nil }

// OverlapAll returns ascending indices of list shapes overlapping shape.
func OverlapAll(shape Shape, list []Shape) []int {
	out := []int{}
	for i := range list {
		if Collide(shape, list[i]) != nil {
			out = append(out, i)
		}
	}
	return out
}

type DistanceResult struct {
	Distance float64 `json:"distance"`
	Overlap  bool    `json:"overlap"`
	Normal   Vec2    `json:"normal"`
	PointA   *Vec2   `json:"pointA"`
	PointB   *Vec2   `json:"pointB"`
}

// Distance between two shapes; distance 0 + overlap when they intersect.
func Distance2D(a, b Shape) DistanceResult {
	A, B := HullOf(a), HullOf(b)
	best, f, fromA := separation2(A, B)
	if f != nil && best <= 0 {
		n := Vec2{f.nx, f.ny}
		if !fromA {
			n = Vec2{-f.nx, -f.ny}
		}
		return DistanceResult{0, true, n, nil, nil}
	}
	cp := closestPairOf(A, B)
	d := cp.dist - A.R - B.R
	if d <= 0 {
		return DistanceResult{0, true, cp.n, nil, nil}
	}
	pa := Vec2{cp.pA.X + float64(cp.n.X*A.R), cp.pA.Y + float64(cp.n.Y*A.R)}
	pb := Vec2{cp.pB.X - float64(cp.n.X*B.R), cp.pB.Y - float64(cp.n.Y*B.R)}
	return DistanceResult{d, false, cp.n, &pa, &pb}
}

// ContainsPoint reports whether (px,py) lies in the shape (boundary inclusive).
func ContainsPoint(s Shape, px, py float64) bool {
	h := HullOf(s)
	if len(h.V) < 3 {
		e := edgesOf2(h)[0]
		c := segClosest2(px, py, e[0].X, e[0].Y, e[1].X, e[1].Y)
		dx, dy := px-c.X, py-c.Y
		return float64(dx*dx)+float64(dy*dy) <= float64(h.R*h.R)
	}
	for _, f := range faces2(h) {
		if float64((px-f.p.X)*f.nx)+float64((py-f.p.Y)*f.ny) > 0 {
			return false
		}
	}
	return true
}

type RayHit2D struct {
	T      float64 `json:"t"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Normal Vec2    `json:"normal"`
	Inside bool    `json:"inside"`
}

func rayCircle2(cx, cy, r, ox, oy, dx, dy, maxT float64) *RayHit2D {
	fx, fy := ox-cx, oy-cy
	a := float64(dx*dx) + float64(dy*dy)
	b := 2 * (float64(fx*dx) + float64(fy*dy))
	c := float64(fx*fx) + float64(fy*fy) - float64(r*r)
	if a == 0 {
		return nil
	}
	if c <= 0 {
		l := math.Sqrt(a)
		return &RayHit2D{0, ox, oy, Vec2{-dx / l, -dy / l}, true}
	}
	disc := float64(b*b) - float64(float64(4*a)*c)
	if disc < 0 {
		return nil
	}
	t := (-b - math.Sqrt(disc)) / (2 * a)
	if t < 0 || t > maxT {
		return nil
	}
	x, y := ox+float64(dx*t), oy+float64(dy*t)
	return &RayHit2D{t, x, y, Vec2{(x - cx) / r, (y - cy) / r}, false}
}

func rayPoly2(h Hull, ox, oy, dx, dy, maxT float64) *RayHit2D {
	l := hyp2(dx, dy)
	if l == 0 {
		return nil
	}
	tmin, tmax := math.Inf(-1), math.Inf(1)
	nx, ny := 0.0, 0.0
	for _, f := range faces2(h) {
		denom := float64(dx*f.nx) + float64(dy*f.ny)
		dist := float64((ox-f.p.X)*f.nx) + float64((oy-f.p.Y)*f.ny)
		if denom == 0 {
			if dist > 0 {
				return nil
			}
			continue
		}
		t := -dist / denom
		if denom < 0 {
			if t > tmin {
				tmin, nx, ny = t, f.nx, f.ny
			}
		} else if t < tmax {
			tmax = t
		}
	}
	if tmin > tmax {
		return nil
	}
	if tmin < 0 {
		if tmax < 0 {
			return nil
		}
		return &RayHit2D{0, ox, oy, Vec2{-dx / l, -dy / l}, true}
	}
	if tmin > maxT {
		return nil
	}
	return &RayHit2D{tmin, ox + float64(dx*tmin), oy + float64(dy*tmin), Vec2{nx, ny}, false}
}

// Raycast casts o + d*t, t in [0,maxT] (d need not be unit). Nearest hit or nil.
func Raycast2D(s Shape, ox, oy, dx, dy, maxT float64) *RayHit2D {
	if s.Type == "circle" {
		return rayCircle2(s.X, s.Y, s.R, ox, oy, dx, dy, maxT)
	}
	if s.Type == "capsule" {
		h := HullOf(s)
		a, b := h.V[0], h.V[1]
		cand := []*RayHit2D{
			rayCircle2(a.X, a.Y, s.R, ox, oy, dx, dy, maxT),
			rayCircle2(b.X, b.Y, s.R, ox, oy, dx, dy, maxT),
			rayPoly2(HullOf(OBB(s.X, s.Y, s.HL, s.R, s.Angle)), ox, oy, dx, dy, maxT),
		}
		var best *RayHit2D
		for _, c := range cand {
			if c == nil {
				continue
			}
			if c.Inside {
				return c
			}
			if best == nil || c.T < best.T {
				best = c
			}
		}
		return best
	}
	return rayPoly2(HullOf(s), ox, oy, dx, dy, maxT)
}

func Segmentcast2D(s Shape, x0, y0, x1, y1 float64) *RayHit2D {
	return Raycast2D(s, x0, y0, x1-x0, y1-y0, 1)
}

type RayNearest2D struct {
	Index int
	Hit   RayHit2D
}

// RaycastNearest is the lowest-t hit over list (ties: lowest index).
func RaycastNearest(list []Shape, ox, oy, dx, dy, maxT float64) *RayNearest2D {
	var best *RayNearest2D
	for i := range list {
		h := Raycast2D(list[i], ox, oy, dx, dy, maxT)
		if h != nil && (best == nil || h.T < best.Hit.T) {
			best = &RayNearest2D{i, *h}
		}
	}
	return best
}

type CastHit2D struct {
	T       float64 `json:"t"`
	Normal  Vec2    `json:"normal"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Overlap bool    `json:"overlap"`
}

// ShapeCast moves a by (dx,dy) against static b with conservative advancement (max 128 iterations).
func ShapeCast(a Shape, dx, dy float64, b Shape) *CastHit2D {
	t := 0.0
	for it := 0; it < 128; it++ {
		at := Translate(a, float64(dx*t), float64(dy*t))
		if m := Collide(at, b); m != nil {
			return &CastHit2D{t, Vec2{-m.Normal.X, -m.Normal.Y}, m.Points[0].X, m.Points[0].Y, it == 0}
		}
		d := Distance2D(at, b)
		if d.Overlap {
			return &CastHit2D{t, Vec2{-d.Normal.X, -d.Normal.Y}, at.X, at.Y, it == 0}
		}
		closing := float64(dx*d.Normal.X) + float64(dy*d.Normal.Y)
		if closing <= 0 {
			return nil
		}
		if d.Distance <= c2EPS {
			return &CastHit2D{t, Vec2{-d.Normal.X, -d.Normal.Y}, (d.PointA.X + d.PointB.X) / 2, (d.PointA.Y + d.PointB.Y) / 2, false}
		}
		t += d.Distance / closing
		if t > 1 {
			return nil
		}
	}
	return nil
}

// SweptAABB moves box a by (dx,dy) against static box b.
func SweptAABB(a Shape, dx, dy float64, b Shape) *CastHit2D {
	hx, hy := a.HW+b.HW, a.HH+b.HH
	n0, f0, n1, f1 := math.Inf(-1), math.Inf(1), math.Inf(-1), math.Inf(1)
	if dx == 0 {
		if math.Abs(a.X-b.X) >= hx {
			return nil
		}
	} else {
		t1, t2 := (b.X-hx-a.X)/dx, (b.X+hx-a.X)/dx
		n0, f0 = math.Min(t1, t2), math.Max(t1, t2)
	}
	if dy == 0 {
		if math.Abs(a.Y-b.Y) >= hy {
			return nil
		}
	} else {
		t1, t2 := (b.Y-hy-a.Y)/dy, (b.Y+hy-a.Y)/dy
		n1, f1 = math.Min(t1, t2), math.Max(t1, t2)
	}
	entry, exit := math.Max(n0, n1), math.Min(f0, f1)
	if entry >= exit || exit <= 0 || entry > 1 {
		return nil
	}
	if entry < 0 {
		m := collideAABB2(b, a)
		if m == nil {
			return nil
		}
		return &CastHit2D{0, m.Normal, a.X, a.Y, true}
	}
	var normal Vec2
	if n0 > n1 {
		nx := 1.0
		if dx > 0 {
			nx = -1
		}
		normal = Vec2{nx, 0}
	} else {
		ny := 1.0
		if dy > 0 {
			ny = -1
		}
		normal = Vec2{0, ny}
	}
	return &CastHit2D{entry, normal, a.X + float64(dx*entry), a.Y + float64(dy*entry), false}
}

type MoveHit2D struct {
	Index  int     `json:"index"`
	T      float64 `json:"t"`
	Normal Vec2    `json:"normal"`
}

type MoveResult2D struct {
	X    float64     `json:"x"`
	Y    float64     `json:"y"`
	Hits []MoveHit2D `json:"hits"`
}

// MoveAABB move-and-slides box a through static boxes with swept tests (up to iterations bounces).
func MoveAABB(a Shape, dx, dy float64, boxes []Shape, iterations int) MoveResult2D {
	x, y, rx, ry := a.X, a.Y, dx, dy
	hits := []MoveHit2D{}
	for it := 0; it < iterations; it++ {
		if rx == 0 && ry == 0 {
			break
		}
		var best *CastHit2D
		bi := -1
		for i := range boxes {
			s := SweptAABB(AABB(x, y, a.HW, a.HH), rx, ry, boxes[i])
			if s != nil && (best == nil || s.T < best.T) {
				best, bi = s, i
			}
		}
		if best == nil {
			x += rx
			y += ry
			rx, ry = 0, 0
			break
		}
		x += float64(rx * best.T)
		y += float64(ry * best.T)
		hits = append(hits, MoveHit2D{bi, best.T, best.Normal})
		rem := 1 - best.T
		px, py := float64(rx*rem), float64(ry*rem)
		dot := float64(px*best.Normal.X) + float64(py*best.Normal.Y)
		if dot < 0 {
			px -= float64(best.Normal.X * dot)
			py -= float64(best.Normal.Y * dot)
		}
		rx, ry = px, py
	}
	return MoveResult2D{x, y, hits}
}

// ---- spatial hash --------------------------------------------------------------------------------------

// ID is a hash item id: a number or a string (numbers sort before strings).
type ID struct {
	Num   float64
	Str   string
	IsStr bool
}

func NumID(n float64) ID { return ID{Num: n} }
func StrID(s string) ID  { return ID{Str: s, IsStr: true} }
func utf16Less(a, b string) int {
	ua, ub := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			if ua[i] < ub[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case len(ua) < len(ub):
		return -1
	case len(ua) > len(ub):
		return 1
	}
	return 0
}

// CmpID orders numbers before strings; numbers numerically, strings by UTF-16 code units.
func CmpID(a, b ID) int {
	if a.IsStr == b.IsStr {
		if a.IsStr {
			return utf16Less(a.Str, b.Str)
		}
		switch {
		case a.Num < b.Num:
			return -1
		case a.Num > b.Num:
			return 1
		}
		return 0
	}
	if !a.IsStr {
		return -1
	}
	return 1
}

type hashItem struct {
	id          ID
	bounds      Bounds
	layer, mask int32
	keys        [][2]int
	ord         int
}

// SpatialHash is a uniform-grid broadphase; every result is sorted by id.
type SpatialHash struct {
	cellSize float64
	cells    map[[2]int][]ID
	items    map[ID]*hashItem
	ord      int
}

func NewSpatialHash(cellSize float64) *SpatialHash {
	if cellSize == 0 {
		cellSize = 32
	}
	return &SpatialHash{cellSize: cellSize, cells: map[[2]int][]ID{}, items: map[ID]*hashItem{}}
}

func (h *SpatialHash) cellRange(b Bounds) (int, int, int, int) {
	return int(math.Floor(b.MinX / h.cellSize)), int(math.Floor(b.MinY / h.cellSize)), int(math.Floor(b.MaxX / h.cellSize)), int(math.Floor(b.MaxY / h.cellSize))
}

func (h *SpatialHash) put(id ID, b Bounds, layer, mask int32, ord int) {
	x0, y0, x1, y1 := h.cellRange(b)
	var keys [][2]int
	for cy := y0; cy <= y1; cy++ {
		for cx := x0; cx <= x1; cx++ {
			k := [2]int{cx, cy}
			h.cells[k] = append(h.cells[k], id)
			keys = append(keys, k)
		}
	}
	h.items[id] = &hashItem{id, b, layer, mask, keys, ord}
}

func (h *SpatialHash) drop(id ID) {
	it := h.items[id]
	if it == nil {
		return
	}
	for _, k := range it.keys {
		c := h.cells[k]
		for i := range c {
			if c[i] == id {
				c = append(c[:i], c[i+1:]...)
				break
			}
		}
		if len(c) == 0 {
			delete(h.cells, k)
		} else {
			h.cells[k] = c
		}
	}
	delete(h.items, id)
}

// Insert adds (or replaces) an item; default layer is 1 and default mask is -1 (all bits).
func (h *SpatialHash) Insert(id ID, b Bounds, layer, mask int32) *SpatialHash {
	h.drop(id)
	h.put(id, b, layer, mask, h.ord)
	h.ord++
	return h
}

// Update moves an existing item, keeping its order and layer/mask; unknown ids panic.
func (h *SpatialHash) Update(id ID, b Bounds) *SpatialHash {
	it := h.items[id]
	if it == nil {
		panic("spatial hash: unknown id")
	}
	o, l, m := it.ord, it.layer, it.mask
	h.drop(id)
	h.put(id, b, l, m, o)
	return h
}

func (h *SpatialHash) Remove(id ID) *SpatialHash { h.drop(id); return h }
func (h *SpatialHash) Clear() {
	h.cells = map[[2]int][]ID{}
	h.items = map[ID]*hashItem{}
	h.ord = 0
}
func (h *SpatialHash) Has(id ID) bool { _, ok := h.items[id]; return ok }
func (h *SpatialHash) Size() int      { return len(h.items) }

func sortIDs(ids []ID) {
	sort.SliceStable(ids, func(i, j int) bool { return CmpID(ids[i], ids[j]) < 0 })
}

func (h *SpatialHash) Query(b Bounds) []ID {
	x0, y0, x1, y1 := h.cellRange(b)
	seen := map[ID]bool{}
	out := []ID{}
	for cy := y0; cy <= y1; cy++ {
		for cx := x0; cx <= x1; cx++ {
			for _, id := range h.cells[[2]int{cx, cy}] {
				if seen[id] {
					continue
				}
				seen[id] = true
				if BoundsOverlap(h.items[id].bounds, b) {
					out = append(out, id)
				}
			}
		}
	}
	sortIDs(out)
	return out
}

func (h *SpatialHash) QueryPoint(x, y float64) []ID { return h.Query(Bounds{x, y, x, y}) }

// Pairs returns deduped bounds-overlapping, layer/mask-compatible pairs [lo,hi], sorted by id.
func (h *SpatialHash) Pairs(filter func(a, b ID) bool) [][2]ID {
	seen := map[[2]int]bool{}
	out := [][2]ID{}
	for _, c := range h.cells {
		for i := 0; i < len(c); i++ {
			for j := i + 1; j < len(c); j++ {
				A, B := h.items[c[i]], h.items[c[j]]
				lo, hi := B, A
				if A.ord < B.ord {
					lo, hi = A, B
				}
				k := [2]int{lo.ord, hi.ord}
				if seen[k] {
					continue
				}
				seen[k] = true
				if !BoundsOverlap(A.bounds, B.bounds) || !CanCollide(A.layer, A.mask, B.layer, B.mask) || (filter != nil && !filter(A.id, B.id)) {
					continue
				}
				if CmpID(A.id, B.id) <= 0 {
					out = append(out, [2]ID{A.id, B.id})
				} else {
					out = append(out, [2]ID{B.id, A.id})
				}
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if c := CmpID(out[i][0], out[j][0]); c != 0 {
			return c < 0
		}
		return CmpID(out[i][1], out[j][1]) < 0
	})
	return out
}

// ---- colliders, scene, tilemap ---------------------------------------------------------------------------

type Slope struct {
	X0 float64 `json:"x0"`
	Y0 float64 `json:"y0"`
	X1 float64 `json:"x1"`
	Y1 float64 `json:"y1"`
}

// Collider is static world geometry: kind "solid", "oneway" or "slope".
type Collider struct {
	Kind  string  `json:"kind"`
	MinX  float64 `json:"minX"`
	MinY  float64 `json:"minY"`
	MaxX  float64 `json:"maxX"`
	MaxY  float64 `json:"maxY"`
	Slope *Slope  `json:"slope,omitempty"`
	Col   int     `json:"col"`
	Row   int     `json:"row"`
	Tile  int     `json:"tile"`
	Layer *int32  `json:"layer,omitempty"`
	Mask  *int32  `json:"mask,omitempty"`
	ID    string  `json:"-"`
}

func layerOf(p *int32) int32 {
	if p == nil {
		return 1
	}
	return *p
}
func maskOf(p *int32) int32 {
	if p == nil {
		return -1
	}
	return *p
}

// Source is anything with Query(bounds) -> colliders (Scene, Tilemap).
type Source interface {
	Query(b Bounds) []*Collider
}

// SurfaceY is the floor height of a collider at world x.
func SurfaceY(c *Collider, x float64) float64 {
	if c.Kind != "slope" {
		return c.MinY
	}
	s := c.Slope
	u := math.Min(1, math.Max(0, (x-s.X0)/(s.X1-s.X0)))
	return s.Y0 + float64((s.Y1-s.Y0)*u)
}

// ColliderShape is the aabb (or slope polygon) of a collider.
func ColliderShape(c *Collider) Shape {
	if c.Kind != "slope" {
		return AABB((c.MinX+c.MaxX)/2, (c.MinY+c.MaxY)/2, (c.MaxX-c.MinX)/2, (c.MaxY-c.MinY)/2)
	}
	s := c.Slope
	return Polygon(0, 0, []Vec2{{s.X0, c.MaxY}, {s.X1, c.MaxY}, {s.X1, s.Y1}, {s.X0, s.Y0}}, 0)
}

// Scene holds static colliders behind a spatial hash; Query returns insertion order.
type Scene struct {
	Colliders []*Collider
	hash      *SpatialHash
}

func NewScene(colliders []Collider, cellSize float64) *Scene {
	s := &Scene{hash: NewSpatialHash(cellSize)}
	for i := range colliders {
		s.Add(colliders[i])
	}
	return s
}

func (s *Scene) Add(c Collider) *Scene {
	cc := c
	s.hash.Insert(NumID(float64(len(s.Colliders))), Bounds{c.MinX, c.MinY, c.MaxX, c.MaxY}, 1, -1)
	s.Colliders = append(s.Colliders, &cc)
	return s
}

func (s *Scene) Query(b Bounds) []*Collider {
	ids := s.hash.Query(b)
	out := make([]*Collider, len(ids))
	for i, id := range ids {
		out[i] = s.Colliders[int(id.Num)]
	}
	return out
}

// PlatformerWorld is the platformer-physics {groundY,pits,platforms} world.
type PlatformerWorld struct {
	GroundY   float64
	Pits      [][2]float64 // x0, x1
	Platforms []struct {
		X, Y, W float64
		ID      string
	}
}

// SceneFromPlatformerWorld builds ground solids between pits and one-way platform tops (cell size 64).
func SceneFromPlatformerWorld(w PlatformerWorld, minX, maxX, depth float64) *Scene {
	var cs []Collider
	cur := minX
	pits := append([][2]float64(nil), w.Pits...)
	sort.SliceStable(pits, func(i, j int) bool { return pits[i][0] < pits[j][0] })
	for _, p := range pits {
		if p[0] > cur {
			cs = append(cs, Collider{Kind: "solid", MinX: cur, MaxX: p[0], MinY: w.GroundY, MaxY: w.GroundY + depth})
		}
		cur = math.Max(cur, p[1])
	}
	if maxX > cur {
		cs = append(cs, Collider{Kind: "solid", MinX: cur, MaxX: maxX, MinY: w.GroundY, MaxY: w.GroundY + depth})
	}
	for _, p := range w.Platforms {
		cs = append(cs, Collider{Kind: "oneway", MinX: p.X - p.W/2, MaxX: p.X + p.W/2, MinY: p.Y, MaxY: p.Y + 4, ID: p.ID})
	}
	return NewScene(cs, 64)
}

// Tilemap is a fixed-tile-size grid (row-major tiles); Query returns colliders in row-major order.
type Tilemap struct {
	Cols, Rows      int
	TileSize        float64
	X, Y            float64
	Outside         int
	OneWayThickness float64
	Tiles           []int
}

type TilemapOpts struct {
	Cols            int      `json:"cols"`
	Rows            int      `json:"rows"`
	TileSize        float64  `json:"tileSize"`
	Tiles           []int    `json:"tiles"`
	X               float64  `json:"x"`
	Y               float64  `json:"y"`
	Outside         int      `json:"outside"`
	OneWayThickness *float64 `json:"oneWayThickness"`
}

func NewTilemap(o TilemapOpts) *Tilemap {
	t := &Tilemap{Cols: o.Cols, Rows: o.Rows, TileSize: o.TileSize, X: o.X, Y: o.Y, Outside: o.Outside, OneWayThickness: 4}
	if o.OneWayThickness != nil {
		t.OneWayThickness = *o.OneWayThickness
	}
	if o.Tiles != nil {
		t.Tiles = append([]int(nil), o.Tiles...)
	} else {
		t.Tiles = make([]int, o.Cols*o.Rows)
	}
	return t
}

func (t *Tilemap) Get(c, r int) int {
	if c < 0 || r < 0 || c >= t.Cols || r >= t.Rows {
		return t.Outside
	}
	return t.Tiles[r*t.Cols+c]
}

func (t *Tilemap) Set(c, r, k int) {
	if c >= 0 && r >= 0 && c < t.Cols && r < t.Rows {
		t.Tiles[r*t.Cols+c] = k
	}
}

func (t *Tilemap) ColliderAt(c, r int) *Collider {
	k := t.Get(c, r)
	if k == TileEmpty {
		return nil
	}
	ts := t.TileSize
	minX, minY := t.X+float64(c)*ts, t.Y+float64(r)*ts
	maxX, maxY := minX+ts, minY+ts
	if k == TileSolid {
		return &Collider{Kind: "solid", MinX: minX, MinY: minY, MaxX: maxX, MaxY: maxY, Col: c, Row: r, Tile: k}
	}
	if k == TileOneway {
		return &Collider{Kind: "oneway", MinX: minX, MinY: minY, MaxX: maxX, MaxY: minY + math.Min(t.OneWayThickness, ts), Col: c, Row: r, Tile: k}
	}
	s, ok := tileSlopes[k]
	if !ok {
		return nil
	}
	return &Collider{Kind: "slope", MinX: minX, MinY: minY, MaxX: maxX, MaxY: maxY,
		Slope: &Slope{minX, maxY - float64(s[0]*ts), maxX, maxY - float64(s[1]*ts)}, Col: c, Row: r, Tile: k}
}

func (t *Tilemap) TileAt(wx, wy float64) (col, row, kind int) {
	col = int(math.Floor((wx - t.X) / t.TileSize))
	row = int(math.Floor((wy - t.Y) / t.TileSize))
	return col, row, t.Get(col, row)
}

func (t *Tilemap) Query(b Bounds) []*Collider {
	ts := t.TileSize
	c0, c1 := int(math.Floor((b.MinX-t.X)/ts)), int(math.Floor((b.MaxX-t.X)/ts))
	r0, r1 := int(math.Floor((b.MinY-t.Y)/ts)), int(math.Floor((b.MaxY-t.Y)/ts))
	out := []*Collider{}
	for r := r0; r <= r1; r++ {
		for c := c0; c <= c1; c++ {
			if col := t.ColliderAt(c, r); col != nil {
				out = append(out, col)
			}
		}
	}
	return out
}

type SourceHit struct {
	Collider *Collider
	Manifold *Manifold
}

type SourceOpts struct {
	Layer, Mask *int32
	PrevMaxY    *float64
}

// CollideSource collides a shape with a scene/tilemap (manifold normal points collider -> shape). One-way
// colliders only count when the shape arrives from above.
func CollideSource(src Source, shape Shape, o SourceOpts) []SourceHit {
	out := []SourceHit{}
	fl, fm := layerOf(o.Layer), maskOf(o.Mask)
	prev := math.Inf(-1)
	if o.PrevMaxY != nil {
		prev = *o.PrevMaxY
	}
	for _, c := range src.Query(BoundsOf(shape)) {
		if !CanCollide(layerOf(c.Layer), maskOf(c.Mask), fl, fm) {
			continue
		}
		m := Collide(ColliderShape(c), shape)
		if m == nil {
			continue
		}
		if c.Kind == "oneway" && !(m.Normal.Y < -0.5 && prev <= c.MinY+1e-6) {
			continue
		}
		out = append(out, SourceHit{c, m})
	}
	return out
}

// MarshalJSON encodes the id as a JSON number or string.
func (i ID) MarshalJSON() ([]byte, error) {
	if i.IsStr {
		return json.Marshal(i.Str)
	}
	return json.Marshal(i.Num)
}

// UnmarshalJSON decodes a JSON number or string id.
func (i *ID) UnmarshalJSON(b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	switch x := v.(type) {
	case float64:
		*i = ID{Num: x}
	case string:
		*i = ID{Str: x, IsStr: true}
	default:
		return fmt.Errorf("spatial hash id must be a number or string, got %T", v)
	}
	return nil
}

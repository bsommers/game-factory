package engine

// 3D collision: port of templates/web-project/src/lib/collision3d.js (spec/v3/collision3d.md).
// Right-handed, Y up, float64 only. Triangle soups are flat []float64 (9 numbers per triangle, CCW front).
// Ray = o + t*d. Contact {Normal, Depth}: translating A by Normal*Depth separates it from B. Products that feed
// sums are wrapped in float64() so a compiler can never fuse them into an FMA (results match JS bit for bit).
// The kinematic character controller (createCharacter/moveAndSlide) is not ported yet.

import "math"

const (
	EPS3  = 1e-12
	eps3s = 1e-24
)

type V3 = [3]float64

func v3sub(a, b V3) V3         { return V3{a[0] - b[0], a[1] - b[1], a[2] - b[2]} }
func v3add(a, b V3) V3         { return V3{a[0] + b[0], a[1] + b[1], a[2] + b[2]} }
func v3mul(a V3, s float64) V3 { return V3{float64(a[0] * s), float64(a[1] * s), float64(a[2] * s)} }
func v3dot(a, b V3) float64 {
	return float64(a[0]*b[0]) + float64(a[1]*b[1]) + float64(a[2]*b[2])
}
func v3cross(a, b V3) V3 {
	return V3{float64(a[1]*b[2]) - float64(a[2]*b[1]), float64(a[2]*b[0]) - float64(a[0]*b[2]), float64(a[0]*b[1]) - float64(a[1]*b[0])}
}
func v3len2(a V3) float64 { return v3dot(a, a) }
func v3len(a V3) float64  { return math.Sqrt(v3dot(a, a)) }
func v3norm(a V3) V3 {
	l := v3len(a)
	if l > 0 {
		return V3{a[0] / l, a[1] / l, a[2] / l}
	}
	return V3{}
}
func v3clamp(x, lo, hi float64) float64 {
	if x < lo {
		return lo
	}
	if x > hi {
		return hi
	}
	return x
}
func v3madd(a, b V3, s float64) V3 {
	return V3{a[0] + float64(b[0]*s), a[1] + float64(b[1]*s), a[2] + float64(b[2]*s)}
}
func v3neg(a V3) V3 { return V3{-a[0], -a[1], -a[2]} }

// Exported vector helpers.
func V3Add(a, b V3) V3           { return v3add(a, b) }
func V3Sub(a, b V3) V3           { return v3sub(a, b) }
func V3Scale(a V3, s float64) V3 { return v3mul(a, s) }
func V3Dot(a, b V3) float64      { return v3dot(a, b) }
func V3Cross(a, b V3) V3         { return v3cross(a, b) }
func V3Len(a V3) float64         { return v3len(a) }
func V3Normalize(a V3) V3        { return v3norm(a) }

type AABB3 struct{ Min, Max V3 }
type Sphere struct {
	C V3
	R float64
}
type Capsule3 struct {
	A, B V3
	R    float64
}
type Plane struct {
	N V3
	D float64
}
type Tri [3]V3
type OBB3 struct {
	C, H V3
	Axes [3]V3
}

// Contact3 is a penetration contact; nil means no contact.
type Contact3 struct {
	Normal V3
	Depth  float64
}

func NewPlane(n V3, d float64) Plane { return Plane{v3norm(n), d} }

// OBBFromQuat builds an OBB from a (not necessarily unit) quaternion [x,y,z,w].
func OBBFromQuat(c, h V3, q [4]float64) OBB3 {
	n := math.Hypot(math.Hypot(q[0], q[1]), math.Hypot(q[2], q[3]))
	if n == 0 {
		n = 1
	}
	x, y, z, w := q[0]/n, q[1]/n, q[2]/n, q[3]/n
	return OBB3{C: c, H: h, Axes: [3]V3{
		{1 - 2*(float64(y*y)+float64(z*z)), 2 * (float64(x*y) + float64(z*w)), 2 * (float64(x*z) - float64(y*w))},
		{2 * (float64(x*y) - float64(z*w)), 1 - 2*(float64(x*x)+float64(z*z)), 2 * (float64(y*z) + float64(x*w))},
		{2 * (float64(x*z) + float64(y*w)), 2 * (float64(y*z) - float64(x*w)), 1 - 2*(float64(x*x)+float64(y*y))},
	}}
}

func TriNormal(a, b, c V3) V3 { return v3norm(v3cross(v3sub(b, a), v3sub(c, a))) }

func AABB3Overlap(a, b AABB3) bool {
	return a.Min[0] <= b.Max[0] && a.Max[0] >= b.Min[0] && a.Min[1] <= b.Max[1] && a.Max[1] >= b.Min[1] && a.Min[2] <= b.Max[2] && a.Max[2] >= b.Min[2]
}

// ---- closest points ----

func ClosestPointSegment(p, a, b V3) V3 {
	ab := v3sub(b, a)
	l := v3dot(ab, ab)
	t := 0.0
	if l > eps3s {
		t = v3clamp(v3dot(v3sub(p, a), ab)/l, 0, 1)
	}
	return v3madd(a, ab, t)
}

func ClosestPointAABB(p V3, box AABB3) V3 {
	return V3{v3clamp(p[0], box.Min[0], box.Max[0]), v3clamp(p[1], box.Min[1], box.Max[1]), v3clamp(p[2], box.Min[2], box.Max[2])}
}

func ClosestPointOBB(p V3, o OBB3) V3 {
	d := v3sub(p, o.C)
	out := o.C
	for i := 0; i < 3; i++ {
		k := v3clamp(v3dot(d, o.Axes[i]), -o.H[i], o.H[i])
		out[0] += float64(o.Axes[i][0] * k)
		out[1] += float64(o.Axes[i][1] * k)
		out[2] += float64(o.Axes[i][2] * k)
	}
	return out
}

func ClosestPointPlane(p V3, pl Plane) V3 { return v3madd(p, pl.N, pl.D-v3dot(pl.N, p)) }

func ClosestPointSphere(p V3, s Sphere) V3 {
	d := v3sub(p, s.C)
	l := v3len(d)
	if l > 0 {
		return v3madd(s.C, d, s.R/l)
	}
	return V3{s.C[0] + s.R, s.C[1], s.C[2]}
}

// ClosestPointTriangle is Ericson 5.1.5; zero-area triangles fall back to the nearest edge.
func ClosestPointTriangle(p, a, b, c V3) V3 {
	ab, ac, ap := v3sub(b, a), v3sub(c, a), v3sub(p, a)
	d1, d2 := v3dot(ab, ap), v3dot(ac, ap)
	if d1 <= 0 && d2 <= 0 {
		return a
	}
	bp := v3sub(p, b)
	d3, d4 := v3dot(ab, bp), v3dot(ac, bp)
	if d3 >= 0 && d4 <= d3 {
		return b
	}
	vc := float64(d1*d4) - float64(d3*d2)
	if vc <= 0 && d1 >= 0 && d3 <= 0 {
		return v3madd(a, ab, d1/(d1-d3))
	}
	cp := v3sub(p, c)
	d5, d6 := v3dot(ab, cp), v3dot(ac, cp)
	if d6 >= 0 && d5 <= d6 {
		return c
	}
	vb := float64(d5*d2) - float64(d1*d6)
	if vb <= 0 && d2 >= 0 && d6 <= 0 {
		return v3madd(a, ac, d2/(d2-d6))
	}
	va := float64(d3*d6) - float64(d5*d4)
	if va <= 0 && d4-d3 >= 0 && d5-d6 >= 0 {
		return v3madd(b, v3sub(c, b), (d4-d3)/((d4-d3)+(d5-d6)))
	}
	sum := va + vb + vc
	if !(sum > 0) || math.IsInf(1/sum, 0) || math.IsNaN(1/sum) {
		var best V3
		bd := math.Inf(1)
		for _, e := range [][2]V3{{a, b}, {b, c}, {c, a}} {
			q := ClosestPointSegment(p, e[0], e[1])
			dd := v3len2(v3sub(p, q))
			if dd < bd {
				bd, best = dd, q
			}
		}
		return best
	}
	denom := 1 / sum
	return v3add(a, v3add(v3mul(ab, float64(vb*denom)), v3mul(ac, float64(vc*denom))))
}

type SegSeg struct {
	S, T, D2 float64
	P1, P2   V3
}

// ClosestSegSeg is Ericson 5.1.9; s,t in [0,1] along each segment.
func ClosestSegSeg(p1, q1, p2, q2 V3) SegSeg {
	d1, d2, r := v3sub(q1, p1), v3sub(q2, p2), v3sub(p1, p2)
	a, e, f := v3dot(d1, d1), v3dot(d2, d2), v3dot(d2, r)
	var s, t float64
	if a <= eps3s && e <= eps3s {
		s, t = 0, 0
	} else if a <= eps3s {
		s, t = 0, v3clamp(f/e, 0, 1)
	} else {
		c := v3dot(d1, r)
		if e <= eps3s {
			t, s = 0, v3clamp(-c/a, 0, 1)
		} else {
			b := v3dot(d1, d2)
			denom := float64(a*e) - float64(b*b)
			if denom > 0 {
				s = v3clamp((float64(b*f)-float64(c*e))/denom, 0, 1)
			} else {
				s = 0
			}
			t = (float64(b*s) + f) / e
			if t < 0 {
				t = 0
				s = v3clamp(-c/a, 0, 1)
			} else if t > 1 {
				t = 1
				s = v3clamp((b-c)/a, 0, 1)
			}
		}
	}
	c1, c2 := v3madd(p1, d1, s), v3madd(p2, d2, t)
	return SegSeg{S: s, T: t, P1: c1, P2: c2, D2: v3len2(v3sub(c1, c2))}
}

func baryInside(p, a, b, c V3, eps float64) bool {
	v0, v1, v2 := v3sub(c, a), v3sub(b, a), v3sub(p, a)
	d00, d01, d11, d20, d21 := v3dot(v0, v0), v3dot(v0, v1), v3dot(v1, v1), v3dot(v2, v0), v3dot(v2, v1)
	den := float64(d00*d11) - float64(d01*d01)
	if !(den > 0) {
		return false
	}
	u := (float64(d11*d20) - float64(d01*d21)) / den
	v := (float64(d00*d21) - float64(d01*d20)) / den
	return u >= -eps && v >= -eps && u+v <= 1+eps
}

type SegTri struct {
	D2       float64
	Ps, Pt   V3
	Crossing bool
	Da, Db   float64
}

// ClosestSegTri finds the closest points between segment [p,q] and a triangle.
func ClosestSegTri(p, q, a, b, c V3) SegTri {
	n := v3cross(v3sub(b, a), v3sub(c, a))
	if v3len2(n) > 0 {
		da, db := v3dot(v3sub(p, a), n), v3dot(v3sub(q, a), n)
		if (da < 0 && db > 0) || (da > 0 && db < 0) {
			x := v3madd(p, v3sub(q, p), da/(da-db))
			if baryInside(x, a, b, c, EPS3) {
				nl := v3len(n)
				return SegTri{D2: 0, Ps: x, Pt: x, Crossing: true, Da: da / nl, Db: db / nl}
			}
		}
	}
	var best SegTri
	have := false
	take := func(ps, pt V3) {
		d2 := v3len2(v3sub(ps, pt))
		if !have || d2 < best.D2 {
			best, have = SegTri{D2: d2, Ps: ps, Pt: pt}, true
		}
	}
	take(p, ClosestPointTriangle(p, a, b, c))
	take(q, ClosestPointTriangle(q, a, b, c))
	for _, e := range [][2]V3{{a, b}, {b, c}, {c, a}} {
		r := ClosestSegSeg(p, q, e[0], e[1])
		take(r.P1, r.P2)
	}
	return best
}

// ---- overlap + contact ----

var up3 = V3{0, 1, 0}

func SphereSphere(A, B Sphere) *Contact3 {
	d := v3sub(A.C, B.C)
	l2 := v3len2(d)
	R := A.R + B.R
	if !(l2 < float64(R*R)) {
		return nil
	}
	l := math.Sqrt(l2)
	if l > EPS3 {
		return &Contact3{v3mul(d, 1/l), R - l}
	}
	return &Contact3{up3, R}
}

func SpherePlane(s Sphere, pl Plane) *Contact3 {
	dist := v3dot(pl.N, s.C) - pl.D
	if dist < s.R {
		return &Contact3{pl.N, s.R - dist}
	}
	return nil
}

func CapsulePlane(cp Capsule3, pl Plane) *Contact3 {
	da, db := v3dot(pl.N, cp.A)-pl.D, v3dot(pl.N, cp.B)-pl.D
	m := math.Min(da, db)
	if m < cp.R {
		return &Contact3{pl.N, cp.R - m}
	}
	return nil
}

func AABBPlane(box AABB3, pl Plane) *Contact3 {
	c := v3mul(v3add(box.Min, box.Max), 0.5)
	h := v3mul(v3sub(box.Max, box.Min), 0.5)
	rad := float64(h[0]*math.Abs(pl.N[0])) + float64(h[1]*math.Abs(pl.N[1])) + float64(h[2]*math.Abs(pl.N[2]))
	dist := v3dot(pl.N, c) - pl.D
	if dist < rad {
		return &Contact3{pl.N, rad - dist}
	}
	return nil
}

// sphereBoxLocal: sphere centre c local to a box centred at the origin with half extents h.
func sphereBoxLocal(c V3, r float64, h V3) (n V3, depth float64, ok bool) {
	q := V3{v3clamp(c[0], -h[0], h[0]), v3clamp(c[1], -h[1], h[1]), v3clamp(c[2], -h[2], h[2])}
	d := v3sub(c, q)
	l2 := v3len2(d)
	if l2 > 0 {
		if l2 >= float64(r*r) {
			return V3{}, 0, false
		}
		l := math.Sqrt(l2)
		return v3mul(d, 1/l), r - l, true
	}
	ax := 0
	best := h[0] - math.Abs(c[0])
	for i := 1; i < 3; i++ {
		g := h[i] - math.Abs(c[i])
		if g < best {
			best, ax = g, i
		}
	}
	var nn V3
	if c[ax] >= 0 {
		nn[ax] = 1
	} else {
		nn[ax] = -1
	}
	return nn, r + best, true
}

func SphereAABB(s Sphere, box AABB3) *Contact3 {
	ctr := v3mul(v3add(box.Min, box.Max), 0.5)
	h := v3mul(v3sub(box.Max, box.Min), 0.5)
	n, d, ok := sphereBoxLocal(v3sub(s.C, ctr), s.R, h)
	if !ok {
		return nil
	}
	return &Contact3{n, d}
}

func SphereOBB(s Sphere, o OBB3) *Contact3 {
	d := v3sub(s.C, o.C)
	lc := V3{v3dot(d, o.Axes[0]), v3dot(d, o.Axes[1]), v3dot(d, o.Axes[2])}
	n, depth, ok := sphereBoxLocal(lc, s.R, o.H)
	if !ok {
		return nil
	}
	return &Contact3{v3add(v3add(v3mul(o.Axes[0], n[0]), v3mul(o.Axes[1], n[1])), v3mul(o.Axes[2], n[2])), depth}
}

func AABBAABB(A, B AABB3) *Contact3 {
	depth := math.Inf(1)
	ax := -1
	sgn := 1.0
	for i := 0; i < 3; i++ {
		o := math.Min(A.Max[i], B.Max[i]) - math.Max(A.Min[i], B.Min[i])
		if !(o > 0) {
			return nil
		}
		if o < depth {
			depth, ax = o, i
			if (A.Min[i] + A.Max[i]) >= (B.Min[i] + B.Max[i]) {
				sgn = 1
			} else {
				sgn = -1
			}
		}
	}
	var n V3
	n[ax] = sgn
	return &Contact3{n, depth}
}

// OBBOBB is a 15-axis SAT; the normal points from B to A.
func OBBOBB(A, B OBB3) *Contact3 {
	t := v3sub(B.C, A.C)
	depth := math.Inf(1)
	var best V3
	test := func(ax V3) bool {
		l2 := v3len2(ax)
		if l2 < 1e-18 {
			return true
		}
		l := math.Sqrt(l2)
		u := V3{ax[0] / l, ax[1] / l, ax[2] / l}
		rA := float64(A.H[0]*math.Abs(v3dot(u, A.Axes[0]))) + float64(A.H[1]*math.Abs(v3dot(u, A.Axes[1]))) + float64(A.H[2]*math.Abs(v3dot(u, A.Axes[2])))
		rB := float64(B.H[0]*math.Abs(v3dot(u, B.Axes[0]))) + float64(B.H[1]*math.Abs(v3dot(u, B.Axes[1]))) + float64(B.H[2]*math.Abs(v3dot(u, B.Axes[2])))
		dist := v3dot(t, u)
		o := rA + rB - math.Abs(dist)
		if !(o > 0) {
			return false
		}
		if o < depth {
			depth = o
			if dist > 0 {
				best = v3mul(u, -1)
			} else {
				best = u
			}
		}
		return true
	}
	for i := 0; i < 3; i++ {
		if !test(A.Axes[i]) {
			return nil
		}
	}
	for i := 0; i < 3; i++ {
		if !test(B.Axes[i]) {
			return nil
		}
	}
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			if !test(v3cross(A.Axes[i], B.Axes[j])) {
				return nil
			}
		}
	}
	return &Contact3{best, depth}
}

func SphereCapsule(s Sphere, cp Capsule3) *Contact3 {
	q := ClosestPointSegment(s.C, cp.A, cp.B)
	d := v3sub(s.C, q)
	l2 := v3len2(d)
	R := s.R + cp.R
	if !(l2 < float64(R*R)) {
		return nil
	}
	l := math.Sqrt(l2)
	if l > EPS3 {
		return &Contact3{v3mul(d, 1/l), R - l}
	}
	ax := v3norm(v3sub(cp.B, cp.A))
	n := up3
	if v3len2(ax) > 0 {
		ref := V3{1, 0, 0}
		if math.Abs(ax[1]) < 0.9 {
			ref = up3
		}
		n = v3norm(v3cross(ax, ref))
	}
	return &Contact3{n, R}
}

// CapsuleCapsule: the normal points from B to A; intersecting axes fall back to a perpendicular direction.
func CapsuleCapsule(A, B Capsule3) *Contact3 {
	r := ClosestSegSeg(A.A, A.B, B.A, B.B)
	R := A.R + B.R
	if !(r.D2 < float64(R*R)) {
		return nil
	}
	l := math.Sqrt(r.D2)
	if l > EPS3 {
		return &Contact3{v3mul(v3sub(r.P1, r.P2), 1/l), R - l}
	}
	n := v3cross(v3sub(A.B, A.A), v3sub(B.B, B.A))
	if v3len2(n) < eps3s {
		ax := v3sub(A.B, A.A)
		if v3len2(ax) > eps3s {
			ref := V3{1, 0, 0}
			if math.Abs(ax[1]) < float64(0.9*v3len(ax)) {
				ref = up3
			}
			n = v3cross(ax, ref)
		} else {
			n = up3
		}
	}
	return &Contact3{v3norm(n), R}
}

func SphereTriangle(s Sphere, tri Tri) *Contact3 {
	a, b, c := tri[0], tri[1], tri[2]
	q := ClosestPointTriangle(s.C, a, b, c)
	d := v3sub(s.C, q)
	l2 := v3len2(d)
	if !(l2 < float64(s.R*s.R)) {
		return nil
	}
	l := math.Sqrt(l2)
	if l > EPS3 {
		return &Contact3{v3mul(d, 1/l), s.R - l}
	}
	n := TriNormal(a, b, c)
	if !(v3len2(n) > 0) {
		n = up3
	}
	return &Contact3{n, s.R}
}

type capTri struct {
	Normal   V3
	Depth    float64
	Crossing bool
	Ps, Pt   V3
}

func capTriContact(pa, pb V3, r float64, a, b, c V3) *capTri {
	res := ClosestSegTri(pa, pb, a, b, c)
	if res.Crossing {
		n := TriNormal(a, b, c)
		var s float64
		if math.Abs(res.Da) >= math.Abs(res.Db) {
			s = -1
			if res.Da >= 0 {
				s = 1
			}
		} else {
			s = -1
			if res.Db >= 0 {
				s = 1
			}
		}
		return &capTri{v3mul(n, s), r + math.Min(math.Abs(res.Da), math.Abs(res.Db)), true, res.Ps, res.Pt}
	}
	if !(res.D2 < float64(r*r)) {
		return nil
	}
	l := math.Sqrt(res.D2)
	if l > EPS3 {
		return &capTri{Normal: v3mul(v3sub(res.Ps, res.Pt), 1/l), Depth: r - l, Ps: res.Ps, Pt: res.Pt}
	}
	n := TriNormal(a, b, c)
	if !(v3len2(n) > 0) {
		n = up3
	}
	return &capTri{Normal: n, Depth: r, Ps: res.Ps, Pt: res.Pt}
}

func CapsuleTriangle(cp Capsule3, tri Tri) *Contact3 {
	r := capTriContact(cp.A, cp.B, cp.R, tri[0], tri[1], tri[2])
	if r == nil {
		return nil
	}
	return &Contact3{r.Normal, r.Depth}
}

// boxTriSat is a 13-axis box-vs-triangle SAT: depth >= 0 overlapping/touching, -1 separated.
func boxTriSat(bc, h V3, tri Tri) (depth float64, normal V3, hasNormal bool) {
	v := [3]V3{v3sub(tri[0], bc), v3sub(tri[1], bc), v3sub(tri[2], bc)}
	e := [3]V3{v3sub(v[1], v[0]), v3sub(v[2], v[1]), v3sub(v[0], v[2])}
	axes := []V3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}, v3cross(e[0], e[1])}
	for i := 0; i < 3; i++ {
		var u V3
		u[i] = 1
		for j := 0; j < 3; j++ {
			axes = append(axes, v3cross(u, e[j]))
		}
	}
	depth = math.Inf(1)
	var best V3
	have := false
	for k := range axes {
		l2 := v3len2(axes[k])
		if l2 < 1e-18 {
			continue
		}
		l := math.Sqrt(l2)
		u := V3{axes[k][0] / l, axes[k][1] / l, axes[k][2] / l}
		rad := float64(h[0]*math.Abs(u[0])) + float64(h[1]*math.Abs(u[1])) + float64(h[2]*math.Abs(u[2]))
		p0, p1, p2 := v3dot(v[0], u), v3dot(v[1], u), v3dot(v[2], u)
		tmin := math.Min(p0, math.Min(p1, p2))
		tmax := math.Max(p0, math.Max(p1, p2))
		if tmin > rad || tmax < -rad {
			return -1, V3{}, false
		}
		lo := rad - tmin
		hi := tmax + rad
		o := math.Min(lo, hi)
		if o < depth {
			depth = o
			have = true
			if lo < hi {
				best = v3mul(u, -1)
			} else {
				best = u
			}
		}
	}
	return depth, best, have
}

func AABBTriangle(box AABB3, tri Tri) *Contact3 {
	d, n, _ := boxTriSat(v3mul(v3add(box.Min, box.Max), 0.5), v3mul(v3sub(box.Max, box.Min), 0.5), tri)
	if d > 0 {
		return &Contact3{n, d}
	}
	return nil
}

// AABBTriangleOverlap is the inclusive boolean (touching counts).
func AABBTriangleOverlap(box AABB3, tri Tri) bool {
	d, _, _ := boxTriSat(v3mul(v3add(box.Min, box.Max), 0.5), v3mul(v3sub(box.Max, box.Min), 0.5), tri)
	return d >= 0
}

// ---- rays ----

// Hit3 is a ray hit: parameter t along d, hit point, surface normal.
type Hit3 struct {
	T      float64
	Point  V3
	Normal V3
}

func hitAt(o, d V3, t float64, n V3) *Hit3 { return &Hit3{t, v3madd(o, d, t), n} }
func insideNormal(d V3) V3                 { return v3neg(v3norm(d)) }

func RayPlane(o, d V3, pl Plane, tmax float64) *Hit3 {
	den := v3dot(pl.N, d)
	if math.Abs(den) < 1e-300 {
		return nil
	}
	t := (pl.D - v3dot(pl.N, o)) / den
	if t < 0 || t > tmax {
		return nil
	}
	if den < 0 {
		return hitAt(o, d, t, pl.N)
	}
	return hitAt(o, d, t, v3mul(pl.N, -1))
}

func RaySphere(o, d V3, s Sphere, tmax float64) *Hit3 {
	m := v3sub(o, s.C)
	a := v3dot(d, d)
	cc := v3dot(m, m) - float64(s.R*s.R)
	if cc <= 0 {
		return hitAt(o, d, 0, insideNormal(d))
	}
	if !(a > 0) {
		return nil
	}
	b := v3dot(m, d)
	if b >= 0 {
		return nil
	}
	disc := float64(b*b) - float64(a*cc)
	if disc < 0 {
		return nil
	}
	t := (-b - math.Sqrt(disc)) / a
	if t > tmax {
		return nil
	}
	p := v3madd(o, d, t)
	return &Hit3{t, p, v3mul(v3sub(p, s.C), 1/s.R)}
}

// RayBoxT is the slab test: returns entry t (clamped to tmin) or -1, plus the entry axis (-1 if inside) and normal sign.
func RayBoxT(O, D, lo, hi V3, tmin, tmax float64) (t float64, axis int, sign float64) {
	tn, tf := math.Inf(-1), math.Inf(1)
	ax, sg := -1, 0.0
	for i := 0; i < 3; i++ {
		d := D[i]
		if d == 0 {
			if O[i] < lo[i] || O[i] > hi[i] {
				return -1, 0, 0
			}
			continue
		}
		inv := 1 / d
		t1, t2 := float64((lo[i]-O[i])*inv), float64((hi[i]-O[i])*inv)
		if t1 > t2 {
			t1, t2 = t2, t1
		}
		if t1 > tn {
			tn, ax = t1, i
			if d > 0 {
				sg = -1
			} else {
				sg = 1
			}
		}
		if t2 < tf {
			tf = t2
		}
	}
	if tn > tf || tf < tmin {
		return -1, 0, 0
	}
	t = tn
	if tn < tmin {
		t = tmin
		ax = -1
	}
	if t > tmax {
		return -1, 0, 0
	}
	return t, ax, sg
}

func RayAABB(o, d V3, box AABB3, tmax float64) *Hit3 {
	t, ax, sg := RayBoxT(o, d, box.Min, box.Max, 0, tmax)
	if t < 0 {
		return nil
	}
	if ax < 0 {
		return hitAt(o, d, t, insideNormal(d))
	}
	var n V3
	n[ax] = sg
	return hitAt(o, d, t, n)
}

func RayOBB(o, d V3, ob OBB3, tmax float64) *Hit3 {
	lo := v3sub(o, ob.C)
	O := V3{v3dot(lo, ob.Axes[0]), v3dot(lo, ob.Axes[1]), v3dot(lo, ob.Axes[2])}
	D := V3{v3dot(d, ob.Axes[0]), v3dot(d, ob.Axes[1]), v3dot(d, ob.Axes[2])}
	t, ax, sg := RayBoxT(O, D, v3neg(ob.H), ob.H, 0, tmax)
	if t < 0 {
		return nil
	}
	if ax < 0 {
		return hitAt(o, d, t, insideNormal(d))
	}
	return hitAt(o, d, t, v3mul(ob.Axes[ax], sg))
}

// rayCapT is the ray parameter against a capsule, or -1.
func rayCapT(o, d, a, b V3, r, tmax float64) float64 {
	ab := v3sub(b, a)
	dd := v3dot(ab, ab)
	q := ClosestPointSegment(o, a, b)
	if v3len2(v3sub(o, q)) <= float64(r*r) {
		return 0
	}
	a0 := v3dot(d, d)
	if !(a0 > 0) {
		return -1
	}
	best := math.Inf(1)
	sph := func(c V3) {
		m := v3sub(o, c)
		b1 := v3dot(m, d)
		c1 := v3dot(m, m) - float64(r*r)
		if b1 >= 0 {
			return
		}
		disc := float64(b1*b1) - float64(a0*c1)
		if disc < 0 {
			return
		}
		t := (-b1 - math.Sqrt(disc)) / a0
		if t >= 0 && t < best {
			best = t
		}
	}
	sph(a)
	sph(b)
	if dd > eps3s {
		m := v3sub(o, a)
		md, nd := v3dot(m, ab), v3dot(d, ab)
		A := float64(dd*a0) - float64(nd*nd)
		B := float64(dd*v3dot(m, d)) - float64(nd*md)
		C := float64(dd*(v3dot(m, m)-float64(r*r))) - float64(md*md)
		if A > float64(float64(1e-18*dd)*a0) {
			disc := float64(B*B) - float64(A*C)
			if disc >= 0 {
				t := (-B - math.Sqrt(disc)) / A
				s := md + float64(t*nd)
				if t >= 0 && s >= 0 && s <= dd && t < best {
					best = t
				}
			}
		}
	}
	if best <= tmax && !math.IsInf(best, 1) {
		return best
	}
	return -1
}

func RayCapsule(o, d V3, cp Capsule3, tmax float64) *Hit3 {
	t := rayCapT(o, d, cp.A, cp.B, cp.R, tmax)
	if t < 0 {
		return nil
	}
	if t == 0 {
		return hitAt(o, d, 0, insideNormal(d))
	}
	p := v3madd(o, d, t)
	q := ClosestPointSegment(p, cp.A, cp.B)
	return &Hit3{t, p, v3mul(v3sub(p, q), 1/cp.R)}
}

// RayTriangleFlat is Moller-Trumbore on a flat soup (9 per triangle at offset off). It returns t or -1;
// out[0]=u (weight of b), out[1]=v (weight of c), out[2]=det sign (+1 front face). Edge/vertex hits are inclusive
// within 1e-12 barycentric; degenerate triangles and parallel rays never hit.
func RayTriangleFlat(ox, oy, oz, dx, dy, dz float64, T []float64, off int, tmin, tmax float64, cull bool, out *[3]float64) float64 {
	ax, ay, az := T[off], T[off+1], T[off+2]
	e1x, e1y, e1z := T[off+3]-ax, T[off+4]-ay, T[off+5]-az
	e2x, e2y, e2z := T[off+6]-ax, T[off+7]-ay, T[off+8]-az
	px := float64(dy*e2z) - float64(dz*e2y)
	py := float64(dz*e2x) - float64(dx*e2z)
	pz := float64(dx*e2y) - float64(dy*e2x)
	det := float64(e1x*px) + float64(e1y*py) + float64(e1z*pz)
	nx := float64(e1y*e2z) - float64(e1z*e2y)
	ny := float64(e1z*e2x) - float64(e1x*e2z)
	nz := float64(e1x*e2y) - float64(e1y*e2x)
	nl := math.Sqrt(float64(nx*nx) + float64(ny*ny) + float64(nz*nz))
	dl := math.Sqrt(float64(dx*dx) + float64(dy*dy) + float64(dz*dz))
	if nl == 0 || math.Abs(det) <= float64(float64(1e-14*nl)*dl) {
		return -1
	}
	if cull && det < 0 {
		return -1
	}
	inv := 1 / det
	tx, ty, tz := ox-ax, oy-ay, oz-az
	u := (float64(tx*px) + float64(ty*py) + float64(tz*pz)) * inv
	if u < -EPS3 || u > 1+EPS3 {
		return -1
	}
	qx := float64(ty*e1z) - float64(tz*e1y)
	qy := float64(tz*e1x) - float64(tx*e1z)
	qz := float64(tx*e1y) - float64(ty*e1x)
	v := (float64(dx*qx) + float64(dy*qy) + float64(dz*qz)) * inv
	if v < -EPS3 || u+v > 1+EPS3 {
		return -1
	}
	t := (float64(e2x*qx) + float64(e2y*qy) + float64(e2z*qz)) * inv
	if t < tmin || t > tmax {
		return -1
	}
	if out != nil {
		out[0], out[1] = u, v
		if det > 0 {
			out[2] = 1
		} else {
			out[2] = -1
		}
	}
	return t
}

// TriHit is a ray-triangle hit.
type TriHit struct {
	T, U, V float64
	Point   V3
	Normal  V3
	Front   bool
}

func RayTriangle(o, d V3, tri Tri, tmin, tmax float64, cullBack bool) *TriHit {
	T := []float64{tri[0][0], tri[0][1], tri[0][2], tri[1][0], tri[1][1], tri[1][2], tri[2][0], tri[2][1], tri[2][2]}
	var out [3]float64
	t := RayTriangleFlat(o[0], o[1], o[2], d[0], d[1], d[2], T, 0, tmin, tmax, cullBack, &out)
	if t < 0 {
		return nil
	}
	n := TriNormal(tri[0], tri[1], tri[2])
	if !(out[2] > 0) {
		n = v3mul(n, -1)
	}
	return &TriHit{t, out[0], out[1], v3madd(o, d, t), n, out[2] > 0}
}

// ---- sweeps ----

// TriWorld is a triangle soup for sweeps: Tris (9 per triangle), Count triangles and an optional broad phase
// Candidates(min,max) returning ascending triangle indices (see BVH.AsWorld).
type TriWorld struct {
	Tris       []float64
	Count      int
	Candidates func(min, max V3) []int
}

// SoupWorld wraps a flat triangle soup.
func SoupWorld(tris []float64) TriWorld { return TriWorld{Tris: tris, Count: len(tris) / 9} }

func triAt(T []float64, o int) (V3, V3, V3) {
	return V3{T[o], T[o+1], T[o+2]}, V3{T[o+3], T[o+4], T[o+5]}, V3{T[o+6], T[o+7], T[o+8]}
}

func orient3(A, B, C, nrm V3) V3 {
	f := TriNormal(A, B, C)
	if v3len2(f) > 0 {
		if v3dot(f, nrm) >= 0 {
			return f
		}
		return v3mul(f, -1)
	}
	return nrm
}

// SweepHit is a sweep result: T in [0,1] of the displacement, Normal from the surface toward the shape,
// Index the triangle, Face its oriented face normal, Penetrating true (t=0) when already overlapping.
type SweepHit struct {
	T           float64
	Normal      V3
	Face        V3
	Point       V3
	Depth       float64
	Penetrating bool
	Index       int
}

func sweepSphereTri(c V3, r float64, d V3, A, B, C V3) *SweepHit {
	q0 := ClosestPointTriangle(c, A, B, C)
	dv := v3sub(c, q0)
	dd := v3len2(dv)
	n := TriNormal(A, B, C)
	if dd < float64(r*r) {
		dist := math.Sqrt(dd)
		var nrm V3
		if dist > EPS3 {
			nrm = v3mul(dv, 1/dist)
		} else if v3len2(n) > 0 {
			nrm = n
		} else {
			nrm = up3
		}
		if dist <= EPS3 && v3dot(nrm, d) > 0 {
			nrm = v3mul(nrm, -1)
		}
		if v3dot(d, nrm) >= 0 {
			return nil
		}
		return &SweepHit{T: 0, Normal: nrm, Face: orient3(A, B, C, nrm), Point: q0, Depth: r - dist, Penetrating: true}
	}
	best := math.Inf(1)
	if v3len2(n) > 0 {
		sd := v3dot(v3sub(c, A), n)
		s := -1.0
		if sd >= 0 {
			s = 1
		}
		dn := float64(v3dot(d, n) * s)
		if dn < 0 {
			t := (r - float64(s*sd)) / dn
			if t >= 0 && t <= 1 && baryInside(v3madd(v3madd(c, d, t), n, float64(-s*r)), A, B, C, EPS3) {
				best = t
			}
		}
	}
	for _, e := range [][2]V3{{A, B}, {B, C}, {C, A}} {
		t := rayCapT(c, d, e[0], e[1], r, 1)
		if t >= 0 && t < best {
			best = t
		}
	}
	if !(best <= 1) {
		return nil
	}
	hc := v3madd(c, d, best)
	q := ClosestPointTriangle(hc, A, B, C)
	dir := v3sub(hc, q)
	l := v3len(dir)
	var normal V3
	if l > EPS3 {
		normal = v3mul(dir, 1/l)
	} else if v3len2(n) > 0 {
		if v3dot(n, d) < 0 {
			normal = v3mul(n, 1)
		} else {
			normal = v3mul(n, -1)
		}
	} else {
		normal = up3
	}
	return &SweepHit{T: best, Normal: normal, Face: orient3(A, B, C, normal), Point: q}
}

func sweepCapsuleTri(pa, pb V3, r float64, d V3, A, B, C V3) *SweepHit {
	dl2 := v3len2(d)
	t := 0.0
	for it := 0; it < 48; it++ {
		sa, sb := v3madd(pa, d, t), v3madd(pb, d, t)
		res := ClosestSegTri(sa, sb, A, B, C)
		if it == 0 && (res.Crossing || res.D2 < float64(r*r)) {
			k := capTriContact(sa, sb, r, A, B, C)
			if k == nil {
				return nil
			}
			if v3dot(d, k.Normal) >= 0 {
				return nil
			}
			return &SweepHit{T: 0, Normal: k.Normal, Face: orient3(A, B, C, k.Normal), Point: k.Pt, Depth: k.Depth, Penetrating: true}
		}
		if res.Crossing {
			fn := TriNormal(A, B, C)
			nn := fn
			if !(v3dot(fn, d) < 0) {
				nn = v3mul(fn, -1)
			}
			return &SweepHit{T: t, Normal: nn, Face: nn, Point: res.Pt}
		}
		dist := math.Sqrt(res.D2)
		gap := dist - r
		u := up3
		if dist > EPS3 {
			u = v3mul(v3sub(res.Ps, res.Pt), 1/dist)
		}
		closing := -v3dot(d, u)
		if !(closing > 1e-12) || !(dl2 > 0) {
			return nil
		}
		if gap <= 1e-9 {
			return &SweepHit{T: t, Normal: u, Face: orient3(A, B, C, u), Point: res.Pt}
		}
		t += gap / closing
		if t > 1 {
			return nil
		}
	}
	return nil
}

func sweepAll(w TriWorld, bmin, bmax V3, fn func(T []float64, o int) *SweepHit) *SweepHit {
	var list []int
	n := w.Count
	if w.Candidates != nil {
		list = w.Candidates(bmin, bmax)
		n = len(list)
	}
	var best *SweepHit
	for k := 0; k < n; k++ {
		i := k
		if list != nil {
			i = list[k]
		}
		h := fn(w.Tris, i*9)
		if h != nil && (best == nil || h.T < best.T) {
			h.Index = i
			best = h
		}
	}
	return best
}

// SweepSphere sweeps a sphere by the full displacement d against the soup (lowest t wins, ties the lower index).
func SweepSphere(c V3, r float64, d V3, w TriWorld) *SweepHit {
	const P = 1e-6
	lo := V3{math.Min(c[0], c[0]+d[0]) - r - P, math.Min(c[1], c[1]+d[1]) - r - P, math.Min(c[2], c[2]+d[2]) - r - P}
	hi := V3{math.Max(c[0], c[0]+d[0]) + r + P, math.Max(c[1], c[1]+d[1]) + r + P, math.Max(c[2], c[2]+d[2]) + r + P}
	return sweepAll(w, lo, hi, func(T []float64, o int) *SweepHit {
		a, b, cc := triAt(T, o)
		return sweepSphereTri(c, r, d, a, b, cc)
	})
}

// SweepCapsule sweeps a capsule with conservative advancement (<= 48 iterations, contact gap 1e-9).
func SweepCapsule(a, b V3, r float64, d V3, w TriWorld) *SweepHit {
	const P = 1e-6
	var lo, hi V3
	for i := 0; i < 3; i++ {
		lo[i] = math.Min(math.Min(a[i], b[i]), math.Min(a[i]+d[i], b[i]+d[i])) - r - P
		hi[i] = math.Max(math.Max(a[i], b[i]), math.Max(a[i]+d[i], b[i]+d[i])) + r + P
	}
	return sweepAll(w, lo, hi, func(T []float64, o int) *SweepHit {
		x, y, z := triAt(T, o)
		return sweepCapsuleTri(a, b, r, d, x, y, z)
	})
}

// CapsuleContact is a penetrating contact of a capsule against a triangle.
type CapsuleContact struct {
	Index  int
	Normal V3
	Depth  float64
}

// CapsuleContacts returns the penetrating contacts of a capsule against a soup.
func CapsuleContacts(a, b V3, r float64, w TriWorld) []CapsuleContact {
	const P = 1e-6
	var lo, hi V3
	for i := 0; i < 3; i++ {
		lo[i] = math.Min(a[i], b[i]) - r - P
		hi[i] = math.Max(a[i], b[i]) + r + P
	}
	var list []int
	n := w.Count
	if w.Candidates != nil {
		list = w.Candidates(lo, hi)
		n = len(list)
	}
	out := []CapsuleContact{}
	for k := 0; k < n; k++ {
		i := k
		if list != nil {
			i = list[k]
		}
		x, y, z := triAt(w.Tris, i*9)
		if c := capTriContact(a, b, r, x, y, z); c != nil {
			out = append(out, CapsuleContact{i, c.Normal, c.Depth})
		}
	}
	return out
}

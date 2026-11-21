//! 3D collision (port of `collision3d.js`, see `spec/v3/collision3d.md`): contacts, closest points, rays and swept sphere/capsule
//! against triangle soups. The kinematic character controller of the JS file is not ported.
//!
//! Right-handed, Y up. Vectors are `[x, y, z]` f64. Triangle soups are flat slices with 9 numbers per triangle, CCW front face.
//! Contacts are `{normal, depth}`: translating shape A by `normal*depth` separates it from B (normal points B toward A).
//! Touching (depth 0) is not a contact. Operation order follows the JS reference.
// Straight ports of the JS reference: negated comparisons and explicit min/max chains deliberately mirror its NaN and operation-order semantics.
#![allow(
    clippy::neg_cmp_op_on_partial_ord,
    clippy::manual_clamp,
    clippy::needless_range_loop,
    clippy::unnecessary_map_or,
    clippy::manual_range_contains,
    clippy::needless_late_init
)]

pub type V3 = [f64; 3];

pub const EPS: f64 = 1e-12;
const EPS2: f64 = 1e-24;
const UP: V3 = [0.0, 1.0, 0.0];

// ---- vec3 ------------------------------------------------------------------------------------------------
pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn mul(a: V3, s: f64) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
pub fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
pub fn len2(a: V3) -> f64 {
    dot(a, a)
}
pub fn len(a: V3) -> f64 {
    dot(a, a).sqrt()
}
pub fn norm(a: V3) -> V3 {
    let l = len(a);
    if l > 0.0 {
        [a[0] / l, a[1] / l, a[2] / l]
    } else {
        [0.0, 0.0, 0.0]
    }
}
pub fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    if x < lo {
        lo
    } else if x > hi {
        hi
    } else {
        x
    }
}
/// `a + b*s`.
pub fn madd(a: V3, b: V3, s: f64) -> V3 {
    [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
}
fn neg(a: V3) -> V3 {
    [-a[0], -a[1], -a[2]]
}
fn min3(a: f64, b: f64, c: f64) -> f64 {
    f64::min(f64::min(a, b), c)
}
fn max3(a: f64, b: f64, c: f64) -> f64 {
    f64::max(f64::max(a, b), c)
}

// ---- primitives ------------------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aabb {
    pub min: V3,
    pub max: V3,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sphere {
    pub c: V3,
    pub r: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Capsule {
    pub a: V3,
    pub b: V3,
    pub r: f64,
}
/// Plane: points `p` with `dot(n, p) == d`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plane {
    pub n: V3,
    pub d: f64,
}
pub type Tri = [V3; 3];
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Obb {
    pub c: V3,
    pub h: V3,
    pub axes: [V3; 3],
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Contact {
    pub normal: V3,
    pub depth: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    pub t: f64,
    pub point: V3,
    pub normal: V3,
}

pub fn plane(n: V3, d: f64) -> Plane {
    Plane { n: norm(n), d }
}
pub fn aabb_from_center(c: V3, h: V3) -> Aabb {
    Aabb { min: [c[0] - h[0], c[1] - h[1], c[2] - h[2]], max: [c[0] + h[0], c[1] + h[1], c[2] + h[2]] }
}
/// OBB from a quaternion `[x, y, z, w]` (need not be unit).
pub fn obb_from_quat(c: V3, h: V3, q: [f64; 4]) -> Obb {
    let n = {
        let s = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
        if s == 0.0 {
            1.0
        } else {
            s
        }
    };
    let (x, y, z, w) = (q[0] / n, q[1] / n, q[2] / n, q[3] / n);
    Obb {
        c,
        h,
        axes: [
            [1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w)],
            [2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w)],
            [2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y)],
        ],
    }
}
pub fn tri_normal(a: V3, b: V3, c: V3) -> V3 {
    norm(cross(sub(b, a), sub(c, a)))
}

// ---- closest points --------------------------------------------------------------------------------------
pub fn closest_point_segment(p: V3, a: V3, b: V3) -> V3 {
    let ab = sub(b, a);
    let l = dot(ab, ab);
    let t = if l > EPS2 { clamp(dot(sub(p, a), ab) / l, 0.0, 1.0) } else { 0.0 };
    madd(a, ab, t)
}
pub fn closest_point_aabb(p: V3, b: &Aabb) -> V3 {
    [clamp(p[0], b.min[0], b.max[0]), clamp(p[1], b.min[1], b.max[1]), clamp(p[2], b.min[2], b.max[2])]
}
pub fn closest_point_obb(p: V3, o: &Obb) -> V3 {
    let d = sub(p, o.c);
    let mut out = o.c;
    for i in 0..3 {
        let k = clamp(dot(d, o.axes[i]), -o.h[i], o.h[i]);
        out[0] += o.axes[i][0] * k;
        out[1] += o.axes[i][1] * k;
        out[2] += o.axes[i][2] * k;
    }
    out
}
pub fn closest_point_plane(p: V3, pl: &Plane) -> V3 {
    madd(p, pl.n, pl.d - dot(pl.n, p))
}
pub fn closest_point_sphere(p: V3, s: &Sphere) -> V3 {
    let d = sub(p, s.c);
    let l = len(d);
    if l > 0.0 {
        madd(s.c, d, s.r / l)
    } else {
        [s.c[0] + s.r, s.c[1], s.c[2]]
    }
}
/// Ericson 5.1.5; zero-area triangles fall back to the three edges.
pub fn closest_point_triangle(p: V3, a: V3, b: V3, c: V3) -> V3 {
    let ab = sub(b, a);
    let ac = sub(c, a);
    let ap = sub(p, a);
    let d1 = dot(ab, ap);
    let d2 = dot(ac, ap);
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = sub(p, b);
    let d3 = dot(ab, bp);
    let d4 = dot(ac, bp);
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return madd(a, ab, d1 / (d1 - d3));
    }
    let cp = sub(p, c);
    let d5 = dot(ab, cp);
    let d6 = dot(ac, cp);
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return madd(a, ac, d2 / (d2 - d6));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0 {
        return madd(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
    }
    let sum = va + vb + vc;
    if !(sum > 0.0) || !(1.0 / sum).is_finite() {
        let mut best = a;
        let mut bd = f64::INFINITY;
        for (u, v) in [(a, b), (b, c), (c, a)] {
            let q = closest_point_segment(p, u, v);
            let dd = len2(sub(p, q));
            if dd < bd {
                bd = dd;
                best = q;
            }
        }
        return best;
    }
    let denom = 1.0 / sum;
    add(a, add(mul(ab, vb * denom), mul(ac, vc * denom)))
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SegSeg {
    pub s: f64,
    pub t: f64,
    pub p1: V3,
    pub p2: V3,
    pub d2: f64,
}

/// Ericson 5.1.9. `s`, `t` in `[0,1]` along each segment.
pub fn closest_seg_seg(p1: V3, q1: V3, p2: V3, q2: V3) -> SegSeg {
    let d1 = sub(q1, p1);
    let d2 = sub(q2, p2);
    let r = sub(p1, p2);
    let a = dot(d1, d1);
    let e = dot(d2, d2);
    let f = dot(d2, r);
    let (s, t);
    if a <= EPS2 && e <= EPS2 {
        s = 0.0;
        t = 0.0;
    } else if a <= EPS2 {
        s = 0.0;
        t = clamp(f / e, 0.0, 1.0);
    } else {
        let c = dot(d1, r);
        if e <= EPS2 {
            t = 0.0;
            s = clamp(-c / a, 0.0, 1.0);
        } else {
            let b = dot(d1, d2);
            let denom = a * e - b * b;
            let mut s_ = if denom > 0.0 { clamp((b * f - c * e) / denom, 0.0, 1.0) } else { 0.0 };
            let mut t_ = (b * s_ + f) / e;
            if t_ < 0.0 {
                t_ = 0.0;
                s_ = clamp(-c / a, 0.0, 1.0);
            } else if t_ > 1.0 {
                t_ = 1.0;
                s_ = clamp((b - c) / a, 0.0, 1.0);
            }
            s = s_;
            t = t_;
        }
    }
    let c1 = madd(p1, d1, s);
    let c2 = madd(p2, d2, t);
    SegSeg { s, t, p1: c1, p2: c2, d2: len2(sub(c1, c2)) }
}

fn bary_inside(p: V3, a: V3, b: V3, c: V3, eps: f64) -> bool {
    let v0 = sub(c, a);
    let v1 = sub(b, a);
    let v2 = sub(p, a);
    let (d00, d01, d11, d20, d21) = (dot(v0, v0), dot(v0, v1), dot(v1, v1), dot(v2, v0), dot(v2, v1));
    let den = d00 * d11 - d01 * d01;
    if !(den > 0.0) {
        return false;
    }
    let u = (d11 * d20 - d01 * d21) / den;
    let v = (d00 * d21 - d01 * d20) / den;
    u >= -eps && v >= -eps && u + v <= 1.0 + eps
}

#[derive(Clone, Copy, Debug)]
pub struct SegTri {
    pub d2: f64,
    pub ps: V3,
    pub pt: V3,
    pub crossing: bool,
    pub da: f64,
    pub db: f64,
}

/// Closest points between segment `[p,q]` and a triangle.
pub fn closest_seg_tri(p: V3, q: V3, a: V3, b: V3, c: V3) -> SegTri {
    let n = cross(sub(b, a), sub(c, a));
    if len2(n) > 0.0 {
        let da = dot(sub(p, a), n);
        let db = dot(sub(q, a), n);
        if (da < 0.0 && db > 0.0) || (da > 0.0 && db < 0.0) {
            let x = madd(p, sub(q, p), da / (da - db));
            if bary_inside(x, a, b, c, EPS) {
                let nl = len(n);
                return SegTri { d2: 0.0, ps: x, pt: x, crossing: true, da: da / nl, db: db / nl };
            }
        }
    }
    let mut best: Option<SegTri> = None;
    let mut take = |ps: V3, pt: V3| {
        let d2 = len2(sub(ps, pt));
        if best.map_or(true, |b| d2 < b.d2) {
            best = Some(SegTri { d2, ps, pt, crossing: false, da: 0.0, db: 0.0 });
        }
    };
    take(p, closest_point_triangle(p, a, b, c));
    take(q, closest_point_triangle(q, a, b, c));
    for (u, v) in [(a, b), (b, c), (c, a)] {
        let r = closest_seg_seg(p, q, u, v);
        take(r.p1, r.p2);
    }
    best.unwrap()
}

// ---- overlap + contact -----------------------------------------------------------------------------------
pub fn sphere_sphere(a: &Sphere, b: &Sphere) -> Option<Contact> {
    let d = sub(a.c, b.c);
    let l2 = len2(d);
    let r = a.r + b.r;
    if !(l2 < r * r) {
        return None;
    }
    let l = l2.sqrt();
    Some(if l > EPS { Contact { normal: mul(d, 1.0 / l), depth: r - l } } else { Contact { normal: UP, depth: r } })
}
pub fn sphere_plane(s: &Sphere, pl: &Plane) -> Option<Contact> {
    let dist = dot(pl.n, s.c) - pl.d;
    if dist < s.r {
        Some(Contact { normal: pl.n, depth: s.r - dist })
    } else {
        None
    }
}
pub fn capsule_plane(cp: &Capsule, pl: &Plane) -> Option<Contact> {
    let da = dot(pl.n, cp.a) - pl.d;
    let db = dot(pl.n, cp.b) - pl.d;
    let m = f64::min(da, db);
    if m < cp.r {
        Some(Contact { normal: pl.n, depth: cp.r - m })
    } else {
        None
    }
}
pub fn aabb_plane(b: &Aabb, pl: &Plane) -> Option<Contact> {
    let c = mul(add(b.min, b.max), 0.5);
    let h = mul(sub(b.max, b.min), 0.5);
    let rad = h[0] * pl.n[0].abs() + h[1] * pl.n[1].abs() + h[2] * pl.n[2].abs();
    let dist = dot(pl.n, c) - pl.d;
    if dist < rad {
        Some(Contact { normal: pl.n, depth: rad - dist })
    } else {
        None
    }
}

/// Sphere (centre local to a box centred at the origin with half extents `h`) vs box: `(local normal, depth)`.
fn sphere_box_local(c: V3, r: f64, h: V3) -> Option<(V3, f64)> {
    let q = [clamp(c[0], -h[0], h[0]), clamp(c[1], -h[1], h[1]), clamp(c[2], -h[2], h[2])];
    let d = sub(c, q);
    let l2 = len2(d);
    if l2 > 0.0 {
        if l2 >= r * r {
            return None;
        }
        let l = l2.sqrt();
        return Some((mul(d, 1.0 / l), r - l));
    }
    let mut ax = 0usize;
    let mut best = h[0] - c[0].abs();
    for i in 1..3 {
        let g = h[i] - c[i].abs();
        if g < best {
            best = g;
            ax = i;
        }
    }
    let mut n = [0.0; 3];
    n[ax] = if c[ax] >= 0.0 { 1.0 } else { -1.0 };
    Some((n, r + best))
}
pub fn sphere_aabb(s: &Sphere, b: &Aabb) -> Option<Contact> {
    let ctr = mul(add(b.min, b.max), 0.5);
    let h = mul(sub(b.max, b.min), 0.5);
    sphere_box_local(sub(s.c, ctr), s.r, h).map(|(n, depth)| Contact { normal: n, depth })
}
pub fn sphere_obb(s: &Sphere, o: &Obb) -> Option<Contact> {
    let d = sub(s.c, o.c);
    let lc = [dot(d, o.axes[0]), dot(d, o.axes[1]), dot(d, o.axes[2])];
    let (n, depth) = sphere_box_local(lc, s.r, o.h)?;
    Some(Contact { normal: add(add(mul(o.axes[0], n[0]), mul(o.axes[1], n[1])), mul(o.axes[2], n[2])), depth })
}
pub fn aabb_aabb(a: &Aabb, b: &Aabb) -> Option<Contact> {
    let mut depth = f64::INFINITY;
    let mut ax = 0usize;
    let mut sgn = 1.0;
    for i in 0..3 {
        let o = f64::min(a.max[i], b.max[i]) - f64::max(a.min[i], b.min[i]);
        if !(o > 0.0) {
            return None;
        }
        if o < depth {
            depth = o;
            ax = i;
            sgn = if (a.min[i] + a.max[i]) >= (b.min[i] + b.max[i]) { 1.0 } else { -1.0 };
        }
    }
    let mut n = [0.0; 3];
    n[ax] = sgn;
    Some(Contact { normal: n, depth })
}
/// OBB vs OBB, 15-axis SAT. Normal points from B to A.
pub fn obb_obb(a: &Obb, b: &Obb) -> Option<Contact> {
    let t = sub(b.c, a.c);
    let mut depth = f64::INFINITY;
    let mut best: Option<V3> = None;
    let mut test = |ax: V3| -> bool {
        let l2 = len2(ax);
        if l2 < 1e-18 {
            return true;
        }
        let l = l2.sqrt();
        let u = [ax[0] / l, ax[1] / l, ax[2] / l];
        let ra = a.h[0] * dot(u, a.axes[0]).abs() + a.h[1] * dot(u, a.axes[1]).abs() + a.h[2] * dot(u, a.axes[2]).abs();
        let rb = b.h[0] * dot(u, b.axes[0]).abs() + b.h[1] * dot(u, b.axes[1]).abs() + b.h[2] * dot(u, b.axes[2]).abs();
        let dist = dot(t, u);
        let o = ra + rb - dist.abs();
        if !(o > 0.0) {
            return false;
        }
        if o < depth {
            depth = o;
            best = Some(if dist > 0.0 { mul(u, -1.0) } else { u });
        }
        true
    };
    for i in 0..3 {
        if !test(a.axes[i]) {
            return None;
        }
    }
    for i in 0..3 {
        if !test(b.axes[i]) {
            return None;
        }
    }
    for i in 0..3 {
        for j in 0..3 {
            if !test(cross(a.axes[i], b.axes[j])) {
                return None;
            }
        }
    }
    best.map(|n| Contact { normal: n, depth })
}
pub fn sphere_capsule(s: &Sphere, cp: &Capsule) -> Option<Contact> {
    let q = closest_point_segment(s.c, cp.a, cp.b);
    let d = sub(s.c, q);
    let l2 = len2(d);
    let r = s.r + cp.r;
    if !(l2 < r * r) {
        return None;
    }
    let l = l2.sqrt();
    if l > EPS {
        return Some(Contact { normal: mul(d, 1.0 / l), depth: r - l });
    }
    let ax = norm(sub(cp.b, cp.a));
    let n = if len2(ax) > 0.0 { norm(cross(ax, if ax[1].abs() < 0.9 { UP } else { [1.0, 0.0, 0.0] })) } else { UP };
    Some(Contact { normal: n, depth: r })
}
/// Normal points from B to A.
pub fn capsule_capsule(a: &Capsule, b: &Capsule) -> Option<Contact> {
    let r = closest_seg_seg(a.a, a.b, b.a, b.b);
    let rr = a.r + b.r;
    if !(r.d2 < rr * rr) {
        return None;
    }
    let l = r.d2.sqrt();
    if l > EPS {
        return Some(Contact { normal: mul(sub(r.p1, r.p2), 1.0 / l), depth: rr - l });
    }
    let mut n = cross(sub(a.b, a.a), sub(b.b, b.a));
    if len2(n) < EPS2 {
        let ax = sub(a.b, a.a);
        n = if len2(ax) > EPS2 {
            cross(ax, if ax[1].abs() < 0.9 * len(ax) { UP } else { [1.0, 0.0, 0.0] })
        } else {
            UP
        };
    }
    Some(Contact { normal: norm(n), depth: rr })
}
pub fn sphere_triangle(s: &Sphere, tri: &Tri) -> Option<Contact> {
    let [a, b, c] = *tri;
    let q = closest_point_triangle(s.c, a, b, c);
    let d = sub(s.c, q);
    let l2 = len2(d);
    if !(l2 < s.r * s.r) {
        return None;
    }
    let l = l2.sqrt();
    if l > EPS {
        return Some(Contact { normal: mul(d, 1.0 / l), depth: s.r - l });
    }
    let n = tri_normal(a, b, c);
    Some(Contact { normal: if len2(n) > 0.0 { n } else { UP }, depth: s.r })
}

struct CapTri {
    normal: V3,
    depth: f64,
    pt: V3,
}

fn cap_tri_contact(pa: V3, pb: V3, r: f64, a: V3, b: V3, c: V3) -> Option<CapTri> {
    let res = closest_seg_tri(pa, pb, a, b, c);
    if res.crossing {
        let n = tri_normal(a, b, c);
        let s = if res.da.abs() >= res.db.abs() {
            if res.da >= 0.0 {
                1.0
            } else {
                -1.0
            }
        } else if res.db >= 0.0 {
            1.0
        } else {
            -1.0
        };
        return Some(CapTri { normal: mul(n, s), depth: r + f64::min(res.da.abs(), res.db.abs()), pt: res.pt });
    }
    if !(res.d2 < r * r) {
        return None;
    }
    let l = res.d2.sqrt();
    if l > EPS {
        return Some(CapTri { normal: mul(sub(res.ps, res.pt), 1.0 / l), depth: r - l, pt: res.pt });
    }
    let n = tri_normal(a, b, c);
    Some(CapTri { normal: if len2(n) > 0.0 { n } else { UP }, depth: r, pt: res.pt })
}
pub fn capsule_triangle(cp: &Capsule, tri: &Tri) -> Option<Contact> {
    cap_tri_contact(cp.a, cp.b, cp.r, tri[0], tri[1], tri[2]).map(|r| Contact { normal: r.normal, depth: r.depth })
}

/// Box (centre `bc`, half `h`) vs triangle SAT (13 axes): `(depth, normal)`; depth `-1` when separated.
fn box_tri_sat(bc: V3, h: V3, tri: &Tri) -> (f64, Option<V3>) {
    let v = [sub(tri[0], bc), sub(tri[1], bc), sub(tri[2], bc)];
    let e = [sub(v[1], v[0]), sub(v[2], v[1]), sub(v[0], v[2])];
    let mut axes = vec![[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0], cross(e[0], e[1])];
    for i in 0..3 {
        let mut u = [0.0; 3];
        u[i] = 1.0;
        for ej in &e {
            axes.push(cross(u, *ej));
        }
    }
    let mut depth = f64::INFINITY;
    let mut best: Option<V3> = None;
    for ax in &axes {
        let l2 = len2(*ax);
        if l2 < 1e-18 {
            continue;
        }
        let l = l2.sqrt();
        let u = [ax[0] / l, ax[1] / l, ax[2] / l];
        let rad = h[0] * u[0].abs() + h[1] * u[1].abs() + h[2] * u[2].abs();
        let (p0, p1, p2) = (dot(v[0], u), dot(v[1], u), dot(v[2], u));
        let tmin = min3(p0, p1, p2);
        let tmax = max3(p0, p1, p2);
        if tmin > rad || tmax < -rad {
            return (-1.0, None);
        }
        let lo = rad - tmin;
        let hi = tmax + rad;
        let o = f64::min(lo, hi);
        if o < depth {
            depth = o;
            best = Some(if lo < hi { mul(u, -1.0) } else { u });
        }
    }
    (depth, best)
}
pub fn aabb_triangle(b: &Aabb, tri: &Tri) -> Option<Contact> {
    let (depth, n) = box_tri_sat(mul(add(b.min, b.max), 0.5), mul(sub(b.max, b.min), 0.5), tri);
    if depth > 0.0 {
        n.map(|normal| Contact { normal, depth })
    } else {
        None
    }
}
/// Inclusive boolean (touching counts).
pub fn aabb_triangle_overlap(b: &Aabb, tri: &Tri) -> bool {
    box_tri_sat(mul(add(b.min, b.max), 0.5), mul(sub(b.max, b.min), 0.5), tri).0 >= 0.0
}

// ---- rays ------------------------------------------------------------------------------------------------
fn hit_at(o: V3, d: V3, t: f64, n: V3) -> Hit {
    Hit { t, point: madd(o, d, t), normal: n }
}
fn inside_normal(d: V3) -> V3 {
    neg(norm(d))
}
pub fn ray_plane(o: V3, d: V3, pl: &Plane, tmax: f64) -> Option<Hit> {
    let den = dot(pl.n, d);
    if den.abs() < 1e-300 {
        return None;
    }
    let t = (pl.d - dot(pl.n, o)) / den;
    if t < 0.0 || t > tmax {
        return None;
    }
    Some(hit_at(o, d, t, if den < 0.0 { pl.n } else { mul(pl.n, -1.0) }))
}
pub fn ray_sphere(o: V3, d: V3, s: &Sphere, tmax: f64) -> Option<Hit> {
    let m = sub(o, s.c);
    let a = dot(d, d);
    let cc = dot(m, m) - s.r * s.r;
    if cc <= 0.0 {
        return Some(hit_at(o, d, 0.0, inside_normal(d)));
    }
    if !(a > 0.0) {
        return None;
    }
    let b = dot(m, d);
    if b >= 0.0 {
        return None;
    }
    let disc = b * b - a * cc;
    if disc < 0.0 {
        return None;
    }
    let t = (-b - disc.sqrt()) / a;
    if t > tmax {
        return None;
    }
    let p = madd(o, d, t);
    Some(Hit { t, point: p, normal: mul(sub(p, s.c), 1.0 / s.r) })
}
/// Slab test: `(t, entry axis or -1 when inside, normal sign)`.
pub fn ray_box_t(o: V3, d: V3, lo: V3, hi: V3, tmin: f64, tmax: f64) -> Option<(f64, i32, f64)> {
    let (mut tn, mut tf, mut ax, mut sg) = (f64::NEG_INFINITY, f64::INFINITY, -1i32, 0.0);
    for i in 0..3 {
        let dd = d[i];
        if dd == 0.0 {
            if o[i] < lo[i] || o[i] > hi[i] {
                return None;
            }
            continue;
        }
        let inv = 1.0 / dd;
        let mut t1 = (lo[i] - o[i]) * inv;
        let mut t2 = (hi[i] - o[i]) * inv;
        if t1 > t2 {
            std::mem::swap(&mut t1, &mut t2);
        }
        if t1 > tn {
            tn = t1;
            ax = i as i32;
            sg = if dd > 0.0 { -1.0 } else { 1.0 };
        }
        if t2 < tf {
            tf = t2;
        }
    }
    if tn > tf || tf < tmin {
        return None;
    }
    let mut t = tn;
    if tn < tmin {
        t = tmin;
        ax = -1;
    }
    if t > tmax {
        return None;
    }
    Some((t, ax, sg))
}
pub fn ray_aabb(o: V3, d: V3, b: &Aabb, tmax: f64) -> Option<Hit> {
    let (t, ax, sg) = ray_box_t(o, d, b.min, b.max, 0.0, tmax)?;
    if ax < 0 {
        return Some(hit_at(o, d, t, inside_normal(d)));
    }
    let mut n = [0.0; 3];
    n[ax as usize] = sg;
    Some(hit_at(o, d, t, n))
}
pub fn ray_obb(o: V3, d: V3, ob: &Obb, tmax: f64) -> Option<Hit> {
    let lo = sub(o, ob.c);
    let oo = [dot(lo, ob.axes[0]), dot(lo, ob.axes[1]), dot(lo, ob.axes[2])];
    let dd = [dot(d, ob.axes[0]), dot(d, ob.axes[1]), dot(d, ob.axes[2])];
    let (t, ax, sg) = ray_box_t(oo, dd, [-ob.h[0], -ob.h[1], -ob.h[2]], ob.h, 0.0, tmax)?;
    if ax < 0 {
        return Some(hit_at(o, d, t, inside_normal(d)));
    }
    Some(hit_at(o, d, t, mul(ob.axes[ax as usize], sg)))
}
/// Ray parameter against a capsule, `-1` if none (shared with the sweeps).
fn ray_cap_t(o: V3, d: V3, a: V3, b: V3, r: f64, tmax: f64) -> f64 {
    let ab = sub(b, a);
    let dd = dot(ab, ab);
    let q = closest_point_segment(o, a, b);
    if len2(sub(o, q)) <= r * r {
        return 0.0;
    }
    let a0 = dot(d, d);
    if !(a0 > 0.0) {
        return -1.0;
    }
    let mut best = f64::INFINITY;
    let mut sph = |c: V3| {
        let m = sub(o, c);
        let b1 = dot(m, d);
        let c1 = dot(m, m) - r * r;
        if b1 >= 0.0 {
            return;
        }
        let disc = b1 * b1 - a0 * c1;
        if disc < 0.0 {
            return;
        }
        let t = (-b1 - disc.sqrt()) / a0;
        if t >= 0.0 && t < best {
            best = t;
        }
    };
    sph(a);
    sph(b);
    if dd > EPS2 {
        let m = sub(o, a);
        let md = dot(m, ab);
        let nd = dot(d, ab);
        let aa = dd * a0 - nd * nd;
        let bb = dd * dot(m, d) - nd * md;
        let cc = dd * (dot(m, m) - r * r) - md * md;
        if aa > 1e-18 * dd * a0 {
            let disc = bb * bb - aa * cc;
            if disc >= 0.0 {
                let t = (-bb - disc.sqrt()) / aa;
                let s = md + t * nd;
                if t >= 0.0 && s >= 0.0 && s <= dd && t < best {
                    best = t;
                }
            }
        }
    }
    if best <= tmax && best != f64::INFINITY {
        best
    } else {
        -1.0
    }
}
pub fn ray_capsule(o: V3, d: V3, cp: &Capsule, tmax: f64) -> Option<Hit> {
    let t = ray_cap_t(o, d, cp.a, cp.b, cp.r, tmax);
    if t < 0.0 {
        return None;
    }
    if t == 0.0 {
        return Some(hit_at(o, d, 0.0, inside_normal(d)));
    }
    let p = madd(o, d, t);
    let q = closest_point_segment(p, cp.a, cp.b);
    Some(Hit { t, point: p, normal: mul(sub(p, q), 1.0 / cp.r) })
}

/// Moller-Trumbore on a flat soup (9 per triangle at offset `off`): `(t, u, v, det sign)`. Edge/vertex hits are inclusive within 1e-12
/// barycentric; degenerate triangles and parallel rays never hit.
#[allow(clippy::too_many_arguments)]
pub fn ray_triangle_flat(
    o: V3,
    d: V3,
    tris: &[f64],
    off: usize,
    tmin: f64,
    tmax: f64,
    cull: bool,
) -> Option<(f64, f64, f64, f64)> {
    let (ox, oy, oz, dx, dy, dz) = (o[0], o[1], o[2], d[0], d[1], d[2]);
    let t9 = &tris[off..off + 9];
    let (ax, ay, az) = (t9[0], t9[1], t9[2]);
    let (e1x, e1y, e1z) = (t9[3] - ax, t9[4] - ay, t9[5] - az);
    let (e2x, e2y, e2z) = (t9[6] - ax, t9[7] - ay, t9[8] - az);
    let px = dy * e2z - dz * e2y;
    let py = dz * e2x - dx * e2z;
    let pz = dx * e2y - dy * e2x;
    let det = e1x * px + e1y * py + e1z * pz;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    let nl = (nx * nx + ny * ny + nz * nz).sqrt();
    let dl = (dx * dx + dy * dy + dz * dz).sqrt();
    if nl == 0.0 || det.abs() <= 1e-14 * nl * dl {
        return None;
    }
    if cull && det < 0.0 {
        return None;
    }
    let inv = 1.0 / det;
    let (tx, ty, tz) = (ox - ax, oy - ay, oz - az);
    let u = (tx * px + ty * py + tz * pz) * inv;
    if u < -EPS || u > 1.0 + EPS {
        return None;
    }
    let qx = ty * e1z - tz * e1y;
    let qy = tz * e1x - tx * e1z;
    let qz = tx * e1y - ty * e1x;
    let v = (dx * qx + dy * qy + dz * qz) * inv;
    if v < -EPS || u + v > 1.0 + EPS {
        return None;
    }
    let t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if t < tmin || t > tmax {
        return None;
    }
    Some((t, u, v, if det > 0.0 { 1.0 } else { -1.0 }))
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TriHit {
    pub t: f64,
    pub u: f64,
    pub v: f64,
    pub point: V3,
    pub normal: V3,
    pub front: bool,
}

pub fn ray_triangle(o: V3, d: V3, tri: &Tri, tmin: f64, tmax: f64, cull_back: bool) -> Option<TriHit> {
    let flat = [tri[0][0], tri[0][1], tri[0][2], tri[1][0], tri[1][1], tri[1][2], tri[2][0], tri[2][1], tri[2][2]];
    let (t, u, v, sign) = ray_triangle_flat(o, d, &flat, 0, tmin, tmax, cull_back)?;
    let n = tri_normal(tri[0], tri[1], tri[2]);
    Some(TriHit { t, u, v, point: madd(o, d, t), normal: if sign > 0.0 { n } else { mul(n, -1.0) }, front: sign > 0.0 })
}

// ---- sweeps ----------------------------------------------------------------------------------------------
/// Triangle soup for sweeps: a flat slice, optionally with a broad-phase `candidates(min, max) -> ascending indices`.
pub struct World<'a> {
    pub tris: &'a [f64],
    pub count: usize,
    pub candidates: Option<&'a dyn Fn(V3, V3) -> Vec<usize>>,
}

impl<'a> World<'a> {
    pub fn new(tris: &'a [f64]) -> World<'a> {
        World { tris, count: tris.len() / 9, candidates: None }
    }
}

fn tri_at(t: &[f64], o: usize) -> Tri {
    [[t[o], t[o + 1], t[o + 2]], [t[o + 3], t[o + 4], t[o + 5]], [t[o + 6], t[o + 7], t[o + 8]]]
}
fn orient(a: V3, b: V3, c: V3, nrm: V3) -> V3 {
    let f = tri_normal(a, b, c);
    if len2(f) > 0.0 {
        if dot(f, nrm) >= 0.0 {
            f
        } else {
            mul(f, -1.0)
        }
    } else {
        nrm
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SweepHit {
    pub t: f64,
    pub normal: V3,
    pub face: V3,
    pub point: V3,
    pub depth: f64,
    pub penetrating: bool,
    pub index: usize,
}

fn sweep_sphere_tri(c: V3, r: f64, d: V3, a: V3, b: V3, cc: V3) -> Option<SweepHit> {
    let q0 = closest_point_triangle(c, a, b, cc);
    let dv = sub(c, q0);
    let dd = len2(dv);
    let n = tri_normal(a, b, cc);
    if dd < r * r {
        let dist = dd.sqrt();
        let mut nrm = if dist > EPS {
            mul(dv, 1.0 / dist)
        } else if len2(n) > 0.0 {
            n
        } else {
            UP
        };
        if dist <= EPS && dot(nrm, d) > 0.0 {
            nrm = mul(nrm, -1.0);
        }
        if dot(d, nrm) >= 0.0 {
            return None;
        }
        return Some(SweepHit {
            t: 0.0,
            normal: nrm,
            face: orient(a, b, cc, nrm),
            point: q0,
            depth: r - dist,
            penetrating: true,
            index: 0,
        });
    }
    let mut best = f64::INFINITY;
    if len2(n) > 0.0 {
        let sd = dot(sub(c, a), n);
        let s = if sd >= 0.0 { 1.0 } else { -1.0 };
        let dn = dot(d, n) * s;
        if dn < 0.0 {
            let t = (r - s * sd) / dn;
            if t >= 0.0 && t <= 1.0 && bary_inside(madd(madd(c, d, t), n, -s * r), a, b, cc, EPS) {
                best = t;
            }
        }
    }
    for (u, v) in [(a, b), (b, cc), (cc, a)] {
        let t = ray_cap_t(c, d, u, v, r, 1.0);
        if t >= 0.0 && t < best {
            best = t;
        }
    }
    if !(best <= 1.0) {
        return None;
    }
    let hc = madd(c, d, best);
    let q = closest_point_triangle(hc, a, b, cc);
    let dir = sub(hc, q);
    let l = len(dir);
    let normal = if l > EPS {
        mul(dir, 1.0 / l)
    } else if len2(n) > 0.0 {
        mul(n, if dot(n, d) < 0.0 { 1.0 } else { -1.0 })
    } else {
        UP
    };
    Some(SweepHit {
        t: best,
        normal,
        face: orient(a, b, cc, normal),
        point: q,
        depth: 0.0,
        penetrating: false,
        index: 0,
    })
}

fn sweep_capsule_tri(pa: V3, pb: V3, r: f64, d: V3, a: V3, b: V3, c: V3) -> Option<SweepHit> {
    let dl2 = len2(d);
    let mut t = 0.0;
    for it in 0..48 {
        let sa = madd(pa, d, t);
        let sb = madd(pb, d, t);
        let res = closest_seg_tri(sa, sb, a, b, c);
        if it == 0 && (res.crossing || res.d2 < r * r) {
            let k = cap_tri_contact(sa, sb, r, a, b, c)?;
            if dot(d, k.normal) >= 0.0 {
                return None;
            }
            return Some(SweepHit {
                t: 0.0,
                normal: k.normal,
                face: orient(a, b, c, k.normal),
                point: k.pt,
                depth: k.depth,
                penetrating: true,
                index: 0,
            });
        }
        if res.crossing {
            let fnrm = tri_normal(a, b, c);
            let nn = if dot(fnrm, d) < 0.0 { fnrm } else { mul(fnrm, -1.0) };
            return Some(SweepHit { t, normal: nn, face: nn, point: res.pt, depth: 0.0, penetrating: false, index: 0 });
        }
        let dist = res.d2.sqrt();
        let gap = dist - r;
        let u = if dist > EPS { mul(sub(res.ps, res.pt), 1.0 / dist) } else { UP };
        let closing = -dot(d, u);
        if !(closing > 1e-12) || !(dl2 > 0.0) {
            return None;
        }
        if gap <= 1e-9 {
            return Some(SweepHit {
                t,
                normal: u,
                face: orient(a, b, c, u),
                point: res.pt,
                depth: 0.0,
                penetrating: false,
                index: 0,
            });
        }
        t += gap / closing;
        if t > 1.0 {
            return None;
        }
    }
    None
}

fn sweep_all(w: &World, bmin: V3, bmax: V3, f: &dyn Fn(&[f64], usize) -> Option<SweepHit>) -> Option<SweepHit> {
    let list = w.candidates.map(|c| c(bmin, bmax));
    let n = list.as_ref().map_or(w.count, Vec::len);
    let mut best: Option<SweepHit> = None;
    for k in 0..n {
        let i = list.as_ref().map_or(k, |l| l[k]);
        if let Some(mut h) = f(w.tris, i * 9) {
            if best.as_ref().map_or(true, |b| h.t < b.t) {
                h.index = i;
                best = Some(h);
            }
        }
    }
    best
}

/// Swept sphere; `d` is the full displacement, hit `t` in `[0,1]`, `normal` unit from surface toward the shape.
pub fn sweep_sphere(c: V3, r: f64, d: V3, world: &World) -> Option<SweepHit> {
    let p = 1e-6;
    let lo =
        [f64::min(c[0], c[0] + d[0]) - r - p, f64::min(c[1], c[1] + d[1]) - r - p, f64::min(c[2], c[2] + d[2]) - r - p];
    let hi =
        [f64::max(c[0], c[0] + d[0]) + r + p, f64::max(c[1], c[1] + d[1]) + r + p, f64::max(c[2], c[2] + d[2]) + r + p];
    sweep_all(world, lo, hi, &|t, o| {
        let tr = tri_at(t, o);
        sweep_sphere_tri(c, r, d, tr[0], tr[1], tr[2])
    })
}

/// Swept capsule (conservative advancement, at most 48 iterations per triangle).
pub fn sweep_capsule(a: V3, b: V3, r: f64, d: V3, world: &World) -> Option<SweepHit> {
    let p = 1e-6;
    let lo: Vec<f64> = (0..3).map(|i| min3(f64::min(a[i], b[i]), a[i] + d[i], b[i] + d[i]) - r - p).collect();
    let hi: Vec<f64> = (0..3).map(|i| max3(f64::max(a[i], b[i]), a[i] + d[i], b[i] + d[i]) + r + p).collect();
    sweep_all(world, [lo[0], lo[1], lo[2]], [hi[0], hi[1], hi[2]], &|t, o| {
        let tr = tri_at(t, o);
        sweep_capsule_tri(a, b, r, d, tr[0], tr[1], tr[2])
    })
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CapsuleContact {
    pub index: usize,
    pub normal: V3,
    pub depth: f64,
}

/// Penetrating contacts of a capsule against a soup.
pub fn capsule_contacts(a: V3, b: V3, r: f64, world: &World) -> Vec<CapsuleContact> {
    let p = 1e-6;
    let lo = [f64::min(a[0], b[0]) - r - p, f64::min(a[1], b[1]) - r - p, f64::min(a[2], b[2]) - r - p];
    let hi = [f64::max(a[0], b[0]) + r + p, f64::max(a[1], b[1]) + r + p, f64::max(a[2], b[2]) + r + p];
    let list = world.candidates.map(|c| c(lo, hi));
    let n = list.as_ref().map_or(world.count, Vec::len);
    let mut out = Vec::new();
    for k in 0..n {
        let i = list.as_ref().map_or(k, |l| l[k]);
        let t = tri_at(world.tris, i * 9);
        if let Some(c) = cap_tri_contact(a, b, r, t[0], t[1], t[2]) {
            out.push(CapsuleContact { index: i, normal: c.normal, depth: c.depth });
        }
    }
    out
}

// ---- kinematic character controller (capsule move-and-slide) ----------------------------------------------
/// `pos` = FEET centre. Capsule core runs from `pos + r` to `pos + height - r` along +Y. Y is up.
#[derive(Clone, Debug, PartialEq)]
pub struct Character {
    pub pos: V3,
    pub vel: V3,
    pub grounded: bool,
    pub ground_normal: V3,
    pub radius: f64,
    pub height: f64,
    pub step_height: f64,
    pub min_ground_y: f64,
    pub skin: f64,
    pub snap_distance: f64,
    pub max_iterations: usize,
}

/// Optional overrides for `create_character` (`None` = default).
#[derive(Clone, Debug, Default)]
pub struct CharacterOpts {
    pub pos: Option<V3>,
    pub radius: Option<f64>,
    pub height: Option<f64>,
    pub step_height: Option<f64>,
    pub min_ground_y: Option<f64>,
    pub skin: Option<f64>,
    pub snap_distance: Option<f64>,
    pub max_iterations: Option<usize>,
}

pub fn create_character(o: &CharacterOpts) -> Character {
    Character {
        pos: o.pos.unwrap_or([0.0, 0.0, 0.0]),
        vel: [0.0, 0.0, 0.0],
        grounded: false,
        ground_normal: [0.0, 1.0, 0.0],
        radius: o.radius.unwrap_or(0.4),
        height: o.height.unwrap_or(1.8),
        step_height: o.step_height.unwrap_or(0.35),
        min_ground_y: o.min_ground_y.unwrap_or(0.6427876096865394),
        skin: o.skin.unwrap_or(1e-4),
        snap_distance: o.snap_distance.unwrap_or(0.3),
        max_iterations: o.max_iterations.unwrap_or(4),
    }
}

fn cap_a(ch: &Character, p: V3) -> V3 {
    [p[0], p[1] + ch.radius, p[2]]
}
fn cap_b(ch: &Character, p: V3) -> V3 {
    [p[0], p[1] + ch.height - ch.radius, p[2]]
}
fn sweep_ch(ch: &Character, w: &World, p: V3, d: V3) -> Option<SweepHit> {
    sweep_capsule(cap_a(ch, p), cap_b(ch, p), ch.radius, d, w)
}

/// Pushes the character out of penetrating geometry (deepest contact first).
pub fn depenetrate(ch: &mut Character, world: &World, iterations: usize) {
    for _ in 0..iterations {
        let cs: Vec<CapsuleContact> = capsule_contacts(cap_a(ch, ch.pos), cap_b(ch, ch.pos), ch.radius, world)
            .into_iter()
            .filter(|c| c.depth > 1e-9)
            .collect();
        if cs.is_empty() {
            return;
        }
        let mut best = cs[0];
        for c in &cs {
            if c.depth > best.depth {
                best = *c;
            }
        }
        ch.pos = madd(ch.pos, best.normal, best.depth + ch.skin);
    }
}

#[derive(Default)]
struct SlideInfo {
    wall: bool,
    floor: Option<V3>,
    ceil: bool,
}

fn slide(ch: &Character, w: &World, p0: V3, d0: V3, stick: bool, info: &mut SlideInfo) -> V3 {
    let mut p = p0;
    let mut d = d0;
    let mut planes: Vec<V3> = Vec::new();
    let mut it = 0;
    while it < ch.max_iterations && len2(d) > EPS2 {
        it += 1;
        let hit = match sweep_ch(ch, w, p, d) {
            None => {
                p = add(p, d);
                break;
            }
            Some(h) => h,
        };
        p = madd(madd(p, d, hit.t), hit.normal, ch.skin);
        let n = hit.normal;
        let f = hit.face;
        if f[1] >= ch.min_ground_y {
            info.floor = Some(f);
            if stick {
                break;
            }
        } else if n[1] < -0.7 {
            info.ceil = true;
        } else {
            info.wall = true;
        }
        let mut nn = n;
        if n[1] > 0.0 && f[1] < ch.min_ground_y {
            let l = f64::hypot(n[0], n[2]);
            if l > 1e-9 {
                nn = [n[0] / l, 0.0, n[2] / l];
            }
        }
        let mut rem = mul(d, 1.0 - hit.t);
        let into = dot(rem, nn);
        if into < 0.0 {
            rem = madd(rem, nn, -into);
        }
        planes.push(nn);
        for k in 0..planes.len() - 1 {
            if dot(rem, planes[k]) < -1e-9 {
                let cr = cross(nn, planes[k]);
                let l = len(cr);
                rem = if l < 1e-9 { [0.0, 0.0, 0.0] } else { mul(cr, dot(rem, cr) / (l * l)) };
            }
        }
        for pl in &planes {
            if dot(rem, *pl) < -1e-9 {
                rem = [0.0, 0.0, 0.0];
            }
        }
        d = rem;
    }
    p
}

fn h_dist(a: V3, b: V3) -> f64 {
    f64::hypot(a[0] - b[0], a[2] - b[2])
}

fn try_step(ch: &Character, w: &World, start: V3, hd: V3) -> Option<V3> {
    let up = sweep_ch(ch, w, start, [0.0, ch.step_height, 0.0]);
    let rise = up.map_or(ch.step_height, |u| u.t * ch.step_height - ch.skin);
    if rise <= 1e-6 {
        return None;
    }
    let p1 = [start[0], start[1] + rise, start[2]];
    let p2 = slide(ch, w, p1, hd, false, &mut SlideInfo::default());
    let dn = rise + 1e-3;
    let hit = sweep_ch(ch, w, p2, [0.0, -dn, 0.0])?;
    if hit.face[1] < ch.min_ground_y {
        return None;
    }
    Some(madd(madd(p2, [0.0, -dn, 0.0], hit.t), hit.normal, ch.skin))
}

/// Moves the character by `vel*dt`: horizontal slide (with step-up), vertical slide, ground snap. Mutates `ch`
/// (pos, vel, grounded, ground_normal). `vel[1]` includes gravity/jump, supplied by the caller.
pub fn move_and_slide(ch: &mut Character, vel: V3, dt: f64, world: &World) {
    let was_grounded = ch.grounded;
    let start = ch.pos;
    depenetrate(ch, world, 4);
    let mut cur = ch.pos;
    let hd = [vel[0] * dt, 0.0, vel[2] * dt];
    let mut info_h = SlideInfo::default();
    if len2(hd) > 0.0 {
        cur = slide(ch, world, cur, hd, false, &mut info_h);
        if was_grounded && info_h.wall && ch.step_height > 0.0 {
            if let Some(s) = try_step(ch, world, ch.pos, hd) {
                if h_dist(s, ch.pos) > h_dist(cur, ch.pos) + 1e-9 {
                    cur = s;
                }
            }
        }
    }
    let mut info_v = SlideInfo::default();
    let vy = vel[1] * dt;
    if vy != 0.0 {
        cur = slide(ch, world, cur, [0.0, vy, 0.0], true, &mut info_v);
    }
    let mut grounded = false;
    let mut gn = [0.0, 1.0, 0.0];
    if vel[1] <= 0.0 {
        if let Some(f) = info_v.floor {
            grounded = true;
            gn = f;
        } else {
            let dist = if was_grounded { ch.snap_distance } else { ch.skin * 3.0 };
            let dv = [0.0, -dist, 0.0];
            if let Some(hit) = sweep_ch(ch, world, cur, dv) {
                if hit.face[1] >= ch.min_ground_y {
                    cur = madd(madd(cur, dv, hit.t), hit.normal, ch.skin);
                    grounded = true;
                    gn = hit.face;
                }
            }
        }
    }
    ch.pos = cur;
    ch.grounded = grounded;
    ch.ground_normal = gn;
    let inv = if dt > 0.0 { 1.0 / dt } else { 0.0 };
    let mut vy_out = vel[1];
    if grounded || (info_v.ceil && vy_out > 0.0) {
        vy_out = 0.0;
    }
    ch.vel = [(cur[0] - start[0]) * inv, vy_out, (cur[2] - start[2]) * inv];
}

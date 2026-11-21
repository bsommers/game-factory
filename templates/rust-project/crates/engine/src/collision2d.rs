//! 2D collision toolkit (port of `collision2d.js`, see `spec/v2/collision2d.md`).
//!
//! x right, y DOWN, angles in radians (`x' = x*cos - y*sin`, `y' = x*sin + y*cos`). Shapes are plain data with the position at the
//! centre. Everything is f64 and the operation order matches the JS reference, so results agree to well within 1e-9.
//! Contains: shapes + hull reduction, SAT manifolds, distance, point/ray/shape casts, swept AABB, `move_aabb`, a uniform spatial
//! hash, colliders, scenes and tilemaps.
// Straight ports of the JS reference: negated comparisons and explicit min/max chains deliberately mirror its NaN and operation-order semantics.
#![allow(
    clippy::neg_cmp_op_on_partial_ord,
    clippy::manual_clamp,
    clippy::needless_range_loop,
    clippy::unnecessary_map_or,
    clippy::manual_range_contains,
    clippy::needless_late_init
)]

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

const EPS: f64 = 1e-9;

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const fn new(x: f64, y: f64) -> Self {
        Vec2 { x, y }
    }
}

fn len(x: f64, y: f64) -> f64 {
    (x * x + y * y).sqrt()
}

// ---- tile kinds ------------------------------------------------------------------------------------------
pub mod tile {
    pub const EMPTY: i32 = 0;
    pub const SOLID: i32 = 1;
    pub const ONEWAY: i32 = 2;
    pub const SLOPE_R: i32 = 3;
    pub const SLOPE_L: i32 = 4;
    pub const SLOPE_R_LO: i32 = 5;
    pub const SLOPE_R_HI: i32 = 6;
    pub const SLOPE_L_HI: i32 = 7;
    pub const SLOPE_L_LO: i32 = 8;
}

/// kind -> `[left, right]` floor height as a fraction of the tile height.
pub fn slope_fractions(kind: i32) -> Option<[f64; 2]> {
    match kind {
        3 => Some([0.0, 1.0]),
        4 => Some([1.0, 0.0]),
        5 => Some([0.0, 0.5]),
        6 => Some([0.5, 1.0]),
        7 => Some([1.0, 0.5]),
        8 => Some([0.5, 0.0]),
        _ => None,
    }
}

// ---- shapes ----------------------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aabb {
    pub x: f64,
    pub y: f64,
    pub hw: f64,
    pub hh: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Shape {
    Aabb { x: f64, y: f64, hw: f64, hh: f64 },
    Circle { x: f64, y: f64, r: f64 },
    Obb { x: f64, y: f64, hw: f64, hh: f64, angle: f64 },
    Polygon { x: f64, y: f64, angle: f64, points: Vec<Vec2> },
    Capsule { x: f64, y: f64, hl: f64, r: f64, angle: f64 },
}

impl Shape {
    pub fn aabb(x: f64, y: f64, hw: f64, hh: f64) -> Shape {
        Shape::Aabb { x, y, hw, hh }
    }
    pub fn circle(x: f64, y: f64, r: f64) -> Shape {
        Shape::Circle { x, y, r }
    }
    pub fn obb(x: f64, y: f64, hw: f64, hh: f64, angle: f64) -> Shape {
        Shape::Obb { x, y, hw, hh, angle }
    }
    pub fn polygon(x: f64, y: f64, points: Vec<Vec2>, angle: f64) -> Shape {
        Shape::Polygon { x, y, angle, points }
    }
    pub fn capsule(x: f64, y: f64, hl: f64, r: f64, angle: f64) -> Shape {
        Shape::Capsule { x, y, hl, r, angle }
    }
    pub fn from_bounds(b: &Bounds) -> Shape {
        Shape::aabb(
            (b.min_x + b.max_x) / 2.0,
            (b.min_y + b.max_y) / 2.0,
            (b.max_x - b.min_x) / 2.0,
            (b.max_y - b.min_y) / 2.0,
        )
    }
    pub fn x(&self) -> f64 {
        match self {
            Shape::Aabb { x, .. }
            | Shape::Circle { x, .. }
            | Shape::Obb { x, .. }
            | Shape::Polygon { x, .. }
            | Shape::Capsule { x, .. } => *x,
        }
    }
    pub fn y(&self) -> f64 {
        match self {
            Shape::Aabb { y, .. }
            | Shape::Circle { y, .. }
            | Shape::Obb { y, .. }
            | Shape::Polygon { y, .. }
            | Shape::Capsule { y, .. } => *y,
        }
    }
    /// Copy with the position shifted by `(dx, dy)`.
    pub fn translate(&self, dx: f64, dy: f64) -> Shape {
        let mut s = self.clone();
        match &mut s {
            Shape::Aabb { x, y, .. }
            | Shape::Circle { x, y, .. }
            | Shape::Obb { x, y, .. }
            | Shape::Polygon { x, y, .. }
            | Shape::Capsule { x, y, .. } => {
                *x += dx;
                *y += dy;
            }
        }
        s
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

pub fn bounds_overlap(a: &Bounds, b: &Bounds) -> bool {
    a.min_x <= b.max_x && a.max_x >= b.min_x && a.min_y <= b.max_y && a.max_y >= b.min_y
}

/// Layer/mask filter (defaults layer 1, mask all bits): each side's layer bit must be in the other's mask.
pub fn can_collide(a_layer: Option<i32>, a_mask: Option<i32>, b_layer: Option<i32>, b_mask: Option<i32>) -> bool {
    ((a_layer.unwrap_or(1) & b_mask.unwrap_or(-1)) != 0) && ((b_layer.unwrap_or(1) & a_mask.unwrap_or(-1)) != 0)
}

#[derive(Clone, Debug)]
pub struct Hull {
    pub v: Vec<Vec2>,
    pub r: f64,
}

fn area2(v: &[Vec2]) -> f64 {
    let mut s = 0.0;
    for i in 0..v.len() {
        let p = v[i];
        let q = v[(i + 1) % v.len()];
        s += p.x * q.y - q.x * p.y;
    }
    s
}

pub fn hull(s: &Shape) -> Hull {
    match s {
        Shape::Circle { x, y, r } => Hull { v: vec![Vec2::new(*x, *y)], r: *r },
        Shape::Aabb { x, y, hw, hh } => Hull {
            v: vec![
                Vec2::new(x - hw, y - hh),
                Vec2::new(x + hw, y - hh),
                Vec2::new(x + hw, y + hh),
                Vec2::new(x - hw, y + hh),
            ],
            r: 0.0,
        },
        Shape::Obb { x, y, hw, hh, angle } => {
            let pts = [Vec2::new(-hw, -hh), Vec2::new(*hw, -hh), Vec2::new(*hw, *hh), Vec2::new(-hw, *hh)];
            rot_hull(*x, *y, *angle, &pts)
        }
        Shape::Polygon { x, y, angle, points } => rot_hull(*x, *y, *angle, points),
        Shape::Capsule { x, y, hl, r, angle } => {
            let (c, sn) = (angle.cos(), angle.sin());
            Hull { v: vec![Vec2::new(x - hl * c, y - hl * sn), Vec2::new(x + hl * c, y + hl * sn)], r: *r }
        }
    }
}

fn rot_hull(x: f64, y: f64, angle: f64, pts: &[Vec2]) -> Hull {
    let (c, sn) = (angle.cos(), angle.sin());
    let mut v: Vec<Vec2> = pts.iter().map(|p| Vec2::new(x + p.x * c - p.y * sn, y + p.x * sn + p.y * c)).collect();
    if area2(&v) < 0.0 {
        v.reverse();
    }
    Hull { v, r: 0.0 }
}

pub fn bounds(s: &Shape) -> Bounds {
    match s {
        Shape::Aabb { x, y, hw, hh } => Bounds { min_x: x - hw, min_y: y - hh, max_x: x + hw, max_y: y + hh },
        Shape::Circle { x, y, r } => Bounds { min_x: x - r, min_y: y - r, max_x: x + r, max_y: y + r },
        _ => {
            let h = hull(s);
            let (mut min_x, mut min_y, mut max_x, mut max_y) =
                (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
            for p in &h.v {
                if p.x < min_x {
                    min_x = p.x;
                }
                if p.y < min_y {
                    min_y = p.y;
                }
                if p.x > max_x {
                    max_x = p.x;
                }
                if p.y > max_y {
                    max_y = p.y;
                }
            }
            Bounds { min_x: min_x - h.r, min_y: min_y - h.r, max_x: max_x + h.r, max_y: max_y + h.r }
        }
    }
}

// ---- hull helpers ----------------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug)]
struct Face {
    i: i32,
    p: Vec2,
    nx: f64,
    ny: f64,
}

fn faces(h: &Hull) -> Vec<Face> {
    let v = &h.v;
    let n = v.len();
    let mut out = Vec::new();
    if n < 2 {
        return out;
    }
    for i in 0..n {
        let p = v[i];
        let q = v[(i + 1) % n];
        let (ex, ey) = (q.x - p.x, q.y - p.y);
        let l = len(ex, ey);
        if l == 0.0 {
            continue;
        }
        out.push(Face { i: i as i32, p, nx: ey / l, ny: -ex / l });
    }
    if n == 2 {
        let (a, b) = (v[0], v[1]);
        let (ex, ey) = (b.x - a.x, b.y - a.y);
        let l = len(ex, ey);
        if l > 0.0 {
            out.push(Face { i: -1, p: b, nx: ex / l, ny: ey / l });
            out.push(Face { i: -1, p: a, nx: -ex / l, ny: -ey / l });
        }
    }
    out
}

fn min_dot(h: &Hull, f: &Face) -> f64 {
    let mut m = f64::INFINITY;
    for p in &h.v {
        let d = (p.x - f.p.x) * f.nx + (p.y - f.p.y) * f.ny;
        if d < m {
            m = d;
        }
    }
    m
}

struct Sep {
    best: f64,
    f: Option<Face>,
    from_a: bool,
}

fn separation(a: &Hull, b: &Hull) -> Sep {
    let mut best = f64::NEG_INFINITY;
    let mut bf = None;
    let mut from_a = true;
    for f in faces(a) {
        let s = min_dot(b, &f);
        if s > best {
            best = s;
            bf = Some(f);
            from_a = true;
        }
    }
    for f in faces(b) {
        let s = min_dot(a, &f);
        if s > best + EPS {
            best = s;
            bf = Some(f);
            from_a = false;
        }
    }
    Sep { best, f: bf, from_a }
}

fn seg_closest(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> Vec2 {
    let (ex, ey) = (bx - ax, by - ay);
    let l2 = ex * ex + ey * ey;
    let mut t = if l2 > 0.0 { ((px - ax) * ex + (py - ay) * ey) / l2 } else { 0.0 };
    t = if t < 0.0 {
        0.0
    } else if t > 1.0 {
        1.0
    } else {
        t
    };
    Vec2::new(ax + ex * t, ay + ey * t)
}

fn edges_of(h: &Hull) -> Vec<(Vec2, Vec2)> {
    let v = &h.v;
    let n = v.len();
    if n == 1 {
        return vec![(v[0], v[0])];
    }
    if n == 2 {
        return vec![(v[0], v[1])];
    }
    (0..n).map(|i| (v[i], v[(i + 1) % n])).collect()
}

struct Closest {
    dist: f64,
    p_a: Vec2,
    p_b: Vec2,
    n: Vec2,
}

/// Closest points between two disjoint hulls (brute force vertex-vs-edge, first minimum wins).
fn closest_pair(a: &Hull, b: &Hull) -> Closest {
    let mut best = f64::INFINITY;
    let (mut p_a, mut p_b) = (Vec2::default(), Vec2::default());
    let ea = edges_of(a);
    let eb = edges_of(b);
    for v in &a.v {
        for (p, q) in &eb {
            let c = seg_closest(v.x, v.y, p.x, p.y, q.x, q.y);
            let (dx, dy) = (c.x - v.x, c.y - v.y);
            let d2 = dx * dx + dy * dy;
            if d2 < best {
                best = d2;
                p_a = *v;
                p_b = c;
            }
        }
    }
    for w in &b.v {
        for (p, q) in &ea {
            let c = seg_closest(w.x, w.y, p.x, p.y, q.x, q.y);
            let (dx, dy) = (w.x - c.x, w.y - c.y);
            let d2 = dx * dx + dy * dy;
            if d2 < best {
                best = d2;
                p_a = c;
                p_b = *w;
            }
        }
    }
    let dist = best.sqrt();
    let n = if dist > 0.0 { Vec2::new((p_b.x - p_a.x) / dist, (p_b.y - p_a.y) / dist) } else { Vec2::new(1.0, 0.0) };
    Closest { dist, p_a, p_b, n }
}

fn clip_line(p0: Vec2, p1: Vec2, nx: f64, ny: f64, off: f64) -> Vec<Vec2> {
    let d0 = p0.x * nx + p0.y * ny - off;
    let d1 = p1.x * nx + p1.y * ny - off;
    let mut out = Vec::new();
    if d0 <= 0.0 {
        out.push(p0);
    }
    if d1 <= 0.0 {
        out.push(p1);
    }
    if d0 * d1 < 0.0 {
        let t = d0 / (d0 - d1);
        out.push(Vec2::new(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t));
    }
    out
}

fn clip_manifold_points(a: &Hull, b: &Hull, from_a: bool, f: &Face) -> Option<Vec<ContactPoint>> {
    let (r, inc) = if from_a { (a, b) } else { (b, a) };
    let (n, m) = (inc.v.len(), r.v.len());
    let v1 = r.v[f.i as usize];
    let v2 = r.v[(f.i as usize + 1) % m];
    let (mut bi, mut bd) = (0usize, f64::INFINITY);
    for i in 0..n {
        let p = inc.v[i];
        let q = inc.v[(i + 1) % n];
        let (ex, ey) = (q.x - p.x, q.y - p.y);
        let l = len(ex, ey);
        if l == 0.0 {
            continue;
        }
        let d = (ey / l) * f.nx + (-ex / l) * f.ny;
        if d < bd {
            bd = d;
            bi = i;
        }
    }
    let p0 = inc.v[bi];
    let p1 = inc.v[(bi + 1) % n];
    let (mut tx, mut ty) = (v2.x - v1.x, v2.y - v1.y);
    let tl = len(tx, ty);
    tx /= tl;
    ty /= tl;
    let c1 = clip_line(p0, p1, -tx, -ty, -(v1.x * tx + v1.y * ty));
    if c1.len() < 2 {
        return None;
    }
    let c2 = clip_line(c1[0], c1[1], tx, ty, v2.x * tx + v2.y * ty);
    if c2.len() < 2 {
        return None;
    }
    let mut pts = Vec::new();
    for p in c2 {
        let sep = (p.x - v1.x) * f.nx + (p.y - v1.y) * f.ny;
        if sep <= EPS {
            pts.push(ContactPoint { x: p.x - f.nx * sep / 2.0, y: p.y - f.ny * sep / 2.0, depth: f64::max(0.0, -sep) });
        }
    }
    if pts.is_empty() {
        None
    } else {
        Some(pts)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ContactPoint {
    pub x: f64,
    pub y: f64,
    pub depth: f64,
}

/// Contact manifold: unit `normal` from a TOWARD b; moving b by `+normal*depth` separates them. 1 or 2 points.
#[derive(Clone, Debug, PartialEq)]
pub struct Manifold {
    pub normal: Vec2,
    pub depth: f64,
    pub points: Vec<ContactPoint>,
}

fn collide_aabb(a: &Aabb, b: &Aabb) -> Option<Manifold> {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let ox = a.hw + b.hw - dx.abs();
    let oy = a.hh + b.hh - dy.abs();
    if ox <= 0.0 || oy <= 0.0 {
        return None;
    }
    let x0 = f64::max(a.x - a.hw, b.x - b.hw);
    let x1 = f64::min(a.x + a.hw, b.x + b.hw);
    let y0 = f64::max(a.y - a.hh, b.y - b.hh);
    let y1 = f64::min(a.y + a.hh, b.y + b.hh);
    if ox < oy {
        let xm = (x0 + x1) / 2.0;
        Some(Manifold {
            normal: Vec2::new(if dx < 0.0 { -1.0 } else { 1.0 }, 0.0),
            depth: ox,
            points: vec![ContactPoint { x: xm, y: y0, depth: ox }, ContactPoint { x: xm, y: y1, depth: ox }],
        })
    } else {
        let ym = (y0 + y1) / 2.0;
        Some(Manifold {
            normal: Vec2::new(0.0, if dy < 0.0 { -1.0 } else { 1.0 }),
            depth: oy,
            points: vec![ContactPoint { x: x0, y: ym, depth: oy }, ContactPoint { x: x1, y: ym, depth: oy }],
        })
    }
}

fn collide_hulls(a: &Hull, b: &Hull) -> Option<Manifold> {
    let rr = a.r + b.r;
    let Sep { best, f, from_a } = separation(a, b);
    let face = match f {
        Some(f) if !(best > 0.0) => f,
        _ => {
            if rr == 0.0 && f.is_some() {
                return None;
            }
            let cp = closest_pair(a, b);
            let depth = rr - cp.dist;
            if depth <= 0.0 {
                return None;
            }
            let sax = cp.p_a.x + cp.n.x * a.r;
            let say = cp.p_a.y + cp.n.y * a.r;
            let sbx = cp.p_b.x - cp.n.x * b.r;
            let sby = cp.p_b.y - cp.n.y * b.r;
            let mut pts = vec![ContactPoint { x: (sax + sbx) / 2.0, y: (say + sby) / 2.0, depth }];
            let n = cp.n;
            if b.v.len() == 2 || a.v.len() == 2 {
                let seg_b = b.v.len() == 2;
                let mut two = Vec::new();
                for v in if seg_b { &b.v } else { &a.v } {
                    let s = if seg_b {
                        (v.x - cp.p_a.x) * n.x + (v.y - cp.p_a.y) * n.y
                    } else {
                        (cp.p_b.x - v.x) * n.x + (cp.p_b.y - v.y) * n.y
                    };
                    let d = rr - s;
                    if d > 0.0 {
                        two.push(if seg_b {
                            ContactPoint {
                                x: v.x - n.x * b.r + n.x * d / 2.0,
                                y: v.y - n.y * b.r + n.y * d / 2.0,
                                depth: d,
                            }
                        } else {
                            ContactPoint {
                                x: v.x + n.x * a.r - n.x * d / 2.0,
                                y: v.y + n.y * a.r - n.y * d / 2.0,
                                depth: d,
                            }
                        });
                    }
                }
                if two.len() == 2 {
                    pts = two;
                }
            }
            return Some(Manifold { normal: n, depth, points: pts });
        }
    };
    let depth = rr - best;
    if depth <= 0.0 {
        return None;
    }
    let n = if from_a { Vec2::new(face.nx, face.ny) } else { Vec2::new(-face.nx, -face.ny) };
    let mut pts = None;
    if rr == 0.0 && a.v.len() >= 3 && b.v.len() >= 3 {
        pts = clip_manifold_points(a, b, from_a, &face);
    }
    let pts = match pts {
        Some(p) => p,
        None => {
            let other = if from_a { b } else { a };
            let mut cand: Vec<(usize, Vec2, f64)> = other
                .v
                .iter()
                .enumerate()
                .map(|(k, v)| (k, *v, (v.x - face.p.x) * face.nx + (v.y - face.p.y) * face.ny))
                .collect();
            cand.sort_by(|p, q| p.2.partial_cmp(&q.2).unwrap_or(Ordering::Equal).then(p.0.cmp(&q.0)));
            let mut out: Vec<ContactPoint> = Vec::new();
            for c in cand.iter().take(2) {
                let d = rr - c.2;
                if d <= 0.0 && !out.is_empty() {
                    break;
                }
                let dd = f64::max(d, 0.0);
                out.push(if from_a {
                    ContactPoint {
                        x: c.1.x - n.x * b.r + n.x * dd / 2.0,
                        y: c.1.y - n.y * b.r + n.y * dd / 2.0,
                        depth: dd,
                    }
                } else {
                    ContactPoint {
                        x: c.1.x + n.x * a.r - n.x * dd / 2.0,
                        y: c.1.y + n.y * a.r - n.y * dd / 2.0,
                        depth: dd,
                    }
                });
            }
            out
        }
    };
    Some(Manifold { normal: n, depth, points: pts })
}

/// Contact manifold between two shapes, or `None` (touching is not a collision).
pub fn collide(a: &Shape, b: &Shape) -> Option<Manifold> {
    if let (Shape::Aabb { x, y, hw, hh }, Shape::Aabb { x: x2, y: y2, hw: hw2, hh: hh2 }) = (a, b) {
        return collide_aabb(&Aabb { x: *x, y: *y, hw: *hw, hh: *hh }, &Aabb { x: *x2, y: *y2, hw: *hw2, hh: *hh2 });
    }
    collide_hulls(&hull(a), &hull(b))
}

pub fn overlaps(a: &Shape, b: &Shape) -> bool {
    collide(a, b).is_some()
}

/// Indices of the shapes in `list` overlapping `shape` (ascending).
pub fn overlap_all(shape: &Shape, list: &[Shape]) -> Vec<usize> {
    (0..list.len()).filter(|&i| collide(shape, &list[i]).is_some()).collect()
}

#[derive(Clone, Debug, PartialEq)]
pub struct Distance {
    pub distance: f64,
    pub overlap: bool,
    pub normal: Vec2,
    pub point_a: Option<Vec2>,
    pub point_b: Option<Vec2>,
}

pub fn distance(a: &Shape, b: &Shape) -> Distance {
    let (ha, hb) = (hull(a), hull(b));
    let Sep { best, f, from_a } = separation(&ha, &hb);
    if let Some(f) = f {
        if best <= 0.0 {
            return Distance {
                distance: 0.0,
                overlap: true,
                normal: if from_a { Vec2::new(f.nx, f.ny) } else { Vec2::new(-f.nx, -f.ny) },
                point_a: None,
                point_b: None,
            };
        }
    }
    let cp = closest_pair(&ha, &hb);
    let d = cp.dist - ha.r - hb.r;
    if d <= 0.0 {
        return Distance { distance: 0.0, overlap: true, normal: cp.n, point_a: None, point_b: None };
    }
    Distance {
        distance: d,
        overlap: false,
        normal: cp.n,
        point_a: Some(Vec2::new(cp.p_a.x + cp.n.x * ha.r, cp.p_a.y + cp.n.y * ha.r)),
        point_b: Some(Vec2::new(cp.p_b.x - cp.n.x * hb.r, cp.p_b.y - cp.n.y * hb.r)),
    }
}

// ---- point / ray / shape casts ---------------------------------------------------------------------------
pub fn contains_point(s: &Shape, px: f64, py: f64) -> bool {
    let h = hull(s);
    if h.v.len() < 3 {
        let (p, q) = edges_of(&h)[0];
        let c = seg_closest(px, py, p.x, p.y, q.x, q.y);
        let (dx, dy) = (px - c.x, py - c.y);
        return dx * dx + dy * dy <= h.r * h.r;
    }
    for f in faces(&h) {
        if (px - f.p.x) * f.nx + (py - f.p.y) * f.ny > 0.0 {
            return false;
        }
    }
    true
}

#[derive(Clone, Debug, PartialEq)]
pub struct RayHit {
    pub t: f64,
    pub x: f64,
    pub y: f64,
    pub normal: Vec2,
    pub inside: bool,
}

#[allow(clippy::many_single_char_names)]
fn ray_circle(cx: f64, cy: f64, r: f64, ox: f64, oy: f64, dx: f64, dy: f64, max_t: f64) -> Option<RayHit> {
    let (fx, fy) = (ox - cx, oy - cy);
    let a = dx * dx + dy * dy;
    let b = 2.0 * (fx * dx + fy * dy);
    let c = fx * fx + fy * fy - r * r;
    if a == 0.0 {
        return None;
    }
    if c <= 0.0 {
        let l = a.sqrt();
        return Some(RayHit { t: 0.0, x: ox, y: oy, normal: Vec2::new(-dx / l, -dy / l), inside: true });
    }
    let disc = b * b - 4.0 * a * c;
    if disc < 0.0 {
        return None;
    }
    let t = (-b - disc.sqrt()) / (2.0 * a);
    if t < 0.0 || t > max_t {
        return None;
    }
    let (x, y) = (ox + dx * t, oy + dy * t);
    Some(RayHit { t, x, y, normal: Vec2::new((x - cx) / r, (y - cy) / r), inside: false })
}

fn ray_poly(h: &Hull, ox: f64, oy: f64, dx: f64, dy: f64, max_t: f64) -> Option<RayHit> {
    let l = len(dx, dy);
    if l == 0.0 {
        return None;
    }
    let (mut tmin, mut tmax, mut nx, mut ny) = (f64::NEG_INFINITY, f64::INFINITY, 0.0, 0.0);
    for f in faces(h) {
        let denom = dx * f.nx + dy * f.ny;
        let dist = (ox - f.p.x) * f.nx + (oy - f.p.y) * f.ny;
        if denom == 0.0 {
            if dist > 0.0 {
                return None;
            }
            continue;
        }
        let t = -dist / denom;
        if denom < 0.0 {
            if t > tmin {
                tmin = t;
                nx = f.nx;
                ny = f.ny;
            }
        } else if t < tmax {
            tmax = t;
        }
    }
    if tmin > tmax {
        return None;
    }
    if tmin < 0.0 {
        if tmax < 0.0 {
            return None;
        }
        return Some(RayHit { t: 0.0, x: ox, y: oy, normal: Vec2::new(-dx / l, -dy / l), inside: true });
    }
    if tmin > max_t {
        return None;
    }
    Some(RayHit { t: tmin, x: ox + dx * tmin, y: oy + dy * tmin, normal: Vec2::new(nx, ny), inside: false })
}

/// Ray `o + d*t`, `t` in `[0, max_t]` (`d` need not be unit). Nearest hit or `None`.
pub fn raycast(s: &Shape, ox: f64, oy: f64, dx: f64, dy: f64, max_t: f64) -> Option<RayHit> {
    match s {
        Shape::Circle { x, y, r } => ray_circle(*x, *y, *r, ox, oy, dx, dy, max_t),
        Shape::Capsule { x, y, hl, r, angle } => {
            let h = hull(s);
            let (a, b) = (h.v[0], h.v[1]);
            let cand = [
                ray_circle(a.x, a.y, *r, ox, oy, dx, dy, max_t),
                ray_circle(b.x, b.y, *r, ox, oy, dx, dy, max_t),
                ray_poly(&hull(&Shape::obb(*x, *y, *hl, *r, *angle)), ox, oy, dx, dy, max_t),
            ];
            let mut best: Option<RayHit> = None;
            for c in cand.into_iter().flatten() {
                if c.inside {
                    return Some(c);
                }
                if best.as_ref().map_or(true, |b| c.t < b.t) {
                    best = Some(c);
                }
            }
            best
        }
        _ => ray_poly(&hull(s), ox, oy, dx, dy, max_t),
    }
}

/// Segment `(x0,y0)->(x1,y1)` cast: raycast with `t` in `[0,1]`.
pub fn segmentcast(s: &Shape, x0: f64, y0: f64, x1: f64, y1: f64) -> Option<RayHit> {
    raycast(s, x0, y0, x1 - x0, y1 - y0, 1.0)
}

/// Nearest raycast hit over a list of shapes: `(index, hit)` (ties: lowest index).
pub fn raycast_nearest(list: &[Shape], ox: f64, oy: f64, dx: f64, dy: f64, max_t: f64) -> Option<(usize, RayHit)> {
    let mut best: Option<(usize, RayHit)> = None;
    for (i, s) in list.iter().enumerate() {
        if let Some(h) = raycast(s, ox, oy, dx, dy, max_t) {
            if best.as_ref().map_or(true, |b| h.t < b.1.t) {
                best = Some((i, h));
            }
        }
    }
    best
}

#[derive(Clone, Debug, PartialEq)]
pub struct CastHit {
    pub t: f64,
    pub normal: Vec2,
    pub x: f64,
    pub y: f64,
    pub overlap: bool,
}

/// Continuous shape cast of `a` by `(dx, dy)` against static `b` (conservative advancement, max 128 iterations).
pub fn shape_cast(a: &Shape, dx: f64, dy: f64, b: &Shape) -> Option<CastHit> {
    let mut t = 0.0;
    for it in 0..128 {
        let at = a.translate(dx * t, dy * t);
        if let Some(m) = collide(&at, b) {
            return Some(CastHit {
                t,
                normal: Vec2::new(-m.normal.x, -m.normal.y),
                x: m.points[0].x,
                y: m.points[0].y,
                overlap: it == 0,
            });
        }
        let d = distance(&at, b);
        if d.overlap {
            return Some(CastHit {
                t,
                normal: Vec2::new(-d.normal.x, -d.normal.y),
                x: at.x(),
                y: at.y(),
                overlap: it == 0,
            });
        }
        let closing = dx * d.normal.x + dy * d.normal.y;
        if closing <= 0.0 {
            return None;
        }
        if d.distance <= EPS {
            let (pa, pb) = (d.point_a.unwrap(), d.point_b.unwrap());
            return Some(CastHit {
                t,
                normal: Vec2::new(-d.normal.x, -d.normal.y),
                x: (pa.x + pb.x) / 2.0,
                y: (pa.y + pb.y) / 2.0,
                overlap: false,
            });
        }
        t += d.distance / closing;
        if t > 1.0 {
            return None;
        }
    }
    None
}

// ---- swept AABB ------------------------------------------------------------------------------------------
/// Move box `a` by `(dx, dy)` against static box `b`. `t` in `[0,1]`, normal faces the mover.
pub fn swept_aabb(a: &Aabb, dx: f64, dy: f64, b: &Aabb) -> Option<CastHit> {
    let hx = a.hw + b.hw;
    let hy = a.hh + b.hh;
    let (mut n0, mut f0, mut n1, mut f1) = (f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY);
    if dx == 0.0 {
        if (a.x - b.x).abs() >= hx {
            return None;
        }
    } else {
        let t1 = (b.x - hx - a.x) / dx;
        let t2 = (b.x + hx - a.x) / dx;
        n0 = f64::min(t1, t2);
        f0 = f64::max(t1, t2);
    }
    if dy == 0.0 {
        if (a.y - b.y).abs() >= hy {
            return None;
        }
    } else {
        let t1 = (b.y - hy - a.y) / dy;
        let t2 = (b.y + hy - a.y) / dy;
        n1 = f64::min(t1, t2);
        f1 = f64::max(t1, t2);
    }
    let entry = f64::max(n0, n1);
    let exit = f64::min(f0, f1);
    if entry >= exit || exit <= 0.0 || entry > 1.0 {
        return None;
    }
    if entry < 0.0 {
        let m = collide_aabb(b, a)?;
        return Some(CastHit { t: 0.0, normal: m.normal, x: a.x, y: a.y, overlap: true });
    }
    let normal = if n0 > n1 {
        Vec2::new(if dx > 0.0 { -1.0 } else { 1.0 }, 0.0)
    } else {
        Vec2::new(0.0, if dy > 0.0 { -1.0 } else { 1.0 })
    };
    Some(CastHit { t: entry, normal, x: a.x + dx * entry, y: a.y + dy * entry, overlap: false })
}

#[derive(Clone, Debug, PartialEq)]
pub struct MoveHit {
    pub index: usize,
    pub t: f64,
    pub normal: Vec2,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MoveResult {
    pub x: f64,
    pub y: f64,
    pub hits: Vec<MoveHit>,
}

/// Move-and-slide an AABB through static AABBs with swept tests (no tunnelling at any speed).
pub fn move_aabb(a: &Aabb, dx: f64, dy: f64, boxes: &[Aabb], iterations: usize) -> MoveResult {
    let (mut x, mut y, mut rx, mut ry) = (a.x, a.y, dx, dy);
    let mut hits = Vec::new();
    for _ in 0..iterations {
        if rx == 0.0 && ry == 0.0 {
            break;
        }
        let mut best: Option<CastHit> = None;
        let mut bi = 0usize;
        for (i, bx) in boxes.iter().enumerate() {
            if let Some(s) = swept_aabb(&Aabb { x, y, hw: a.hw, hh: a.hh }, rx, ry, bx) {
                if best.as_ref().map_or(true, |b| s.t < b.t) {
                    best = Some(s);
                    bi = i;
                }
            }
        }
        let Some(best) = best else {
            x += rx;
            y += ry;
            break;
        };
        x += rx * best.t;
        y += ry * best.t;
        hits.push(MoveHit { index: bi, t: best.t, normal: best.normal });
        let rem = 1.0 - best.t;
        let (mut px, mut py) = (rx * rem, ry * rem);
        let dot = px * best.normal.x + py * best.normal.y;
        if dot < 0.0 {
            px -= best.normal.x * dot;
            py -= best.normal.y * dot;
        }
        rx = px;
        ry = py;
    }
    MoveResult { x, y, hits }
}

// ---- uniform spatial hash --------------------------------------------------------------------------------
/// Hash id: a number or a string. Numbers sort before strings.
#[derive(Clone, Debug, PartialEq)]
pub enum Id {
    Num(f64),
    Str(String),
}

pub fn cmp_id(a: &Id, b: &Id) -> Ordering {
    match (a, b) {
        (Id::Num(x), Id::Num(y)) => x.partial_cmp(y).unwrap_or(Ordering::Equal),
        (Id::Str(x), Id::Str(y)) => x.encode_utf16().cmp(y.encode_utf16()),
        (Id::Num(_), Id::Str(_)) => Ordering::Less,
        (Id::Str(_), Id::Num(_)) => Ordering::Greater,
    }
}

#[derive(Clone, PartialEq, Eq, Hash)]
enum IdKey {
    N(u64),
    S(String),
}

fn id_key(id: &Id) -> IdKey {
    match id {
        Id::Num(n) => IdKey::N((if *n == 0.0 { 0.0 } else { *n }).to_bits()),
        Id::Str(s) => IdKey::S(s.clone()),
    }
}

#[derive(Clone)]
struct HashItem {
    id: Id,
    bounds: Bounds,
    layer: Option<i32>,
    mask: Option<i32>,
    keys: Vec<(i64, i64)>,
    ord: u64,
}

/// Uniform grid broadphase. All results are sorted by id (numbers before strings), independent of insertion order.
#[derive(Clone)]
pub struct SpatialHash {
    cell_size: f64,
    cells: HashMap<(i64, i64), Vec<usize>>,
    slots: Vec<Option<HashItem>>,
    index: HashMap<IdKey, usize>,
    ord: u64,
}

impl SpatialHash {
    pub fn new(cell_size: f64) -> Self {
        SpatialHash { cell_size, cells: HashMap::new(), slots: Vec::new(), index: HashMap::new(), ord: 0 }
    }
    fn cell_range(&self, b: &Bounds) -> (i64, i64, i64, i64) {
        let cs = self.cell_size;
        (
            (b.min_x / cs).floor() as i64,
            (b.min_y / cs).floor() as i64,
            (b.max_x / cs).floor() as i64,
            (b.max_y / cs).floor() as i64,
        )
    }
    fn put(&mut self, id: Id, bounds: Bounds, layer: Option<i32>, mask: Option<i32>, ord: u64) {
        let (x0, y0, x1, y1) = self.cell_range(&bounds);
        let slot = self.slots.len();
        let mut keys = Vec::new();
        for cy in y0..=y1 {
            for cx in x0..=x1 {
                self.cells.entry((cx, cy)).or_default().push(slot);
                keys.push((cx, cy));
            }
        }
        self.index.insert(id_key(&id), slot);
        self.slots.push(Some(HashItem { id, bounds, layer, mask, keys, ord }));
    }
    fn drop_id(&mut self, id: &Id) {
        let Some(slot) = self.index.remove(&id_key(id)) else { return };
        let it = self.slots[slot].take().unwrap();
        for k in it.keys {
            if let Some(c) = self.cells.get_mut(&k) {
                if let Some(i) = c.iter().position(|&s| s == slot) {
                    c.remove(i);
                }
                if c.is_empty() {
                    self.cells.remove(&k);
                }
            }
        }
    }
    /// Insert (or replace; a replaced id gets a new order).
    pub fn insert(&mut self, id: Id, bounds: Bounds, layer: Option<i32>, mask: Option<i32>) {
        self.drop_id(&id);
        let o = self.ord;
        self.ord += 1;
        self.put(id, bounds, layer, mask, o);
    }
    /// Move an item (keeps its order and layer/mask). Errors on an unknown id.
    pub fn update(&mut self, id: &Id, bounds: Bounds) -> Result<(), String> {
        let slot = *self.index.get(&id_key(id)).ok_or_else(|| "spatial hash: unknown id".to_string())?;
        let it = self.slots[slot].clone().unwrap();
        self.drop_id(id);
        self.put(it.id, bounds, it.layer, it.mask, it.ord);
        Ok(())
    }
    pub fn remove(&mut self, id: &Id) {
        self.drop_id(id);
    }
    pub fn clear(&mut self) {
        self.cells.clear();
        self.slots.clear();
        self.index.clear();
        self.ord = 0;
    }
    pub fn has(&self, id: &Id) -> bool {
        self.index.contains_key(&id_key(id))
    }
    pub fn size(&self) -> usize {
        self.index.len()
    }
    pub fn query(&self, b: &Bounds) -> Vec<Id> {
        let (x0, y0, x1, y1) = self.cell_range(b);
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out = Vec::new();
        for cy in y0..=y1 {
            for cx in x0..=x1 {
                if let Some(c) = self.cells.get(&(cx, cy)) {
                    for &s in c {
                        if !seen.insert(s) {
                            continue;
                        }
                        let it = self.slots[s].as_ref().unwrap();
                        if bounds_overlap(&it.bounds, b) {
                            out.push(it.id.clone());
                        }
                    }
                }
            }
        }
        out.sort_by(cmp_id);
        out
    }
    pub fn query_point(&self, x: f64, y: f64) -> Vec<Id> {
        self.query(&Bounds { min_x: x, min_y: y, max_x: x, max_y: y })
    }
    /// Sorted `[lo, hi]` id pairs with overlapping bounds, passing the layer/mask test and the optional filter
    /// (the filter receives the ids in sorted order).
    pub fn pairs(&self, filter: Option<&dyn Fn(&Id, &Id) -> bool>) -> Vec<(Id, Id)> {
        let mut seen: HashSet<(u64, u64)> = HashSet::new();
        let mut out: Vec<(Id, Id)> = Vec::new();
        for c in self.cells.values() {
            for i in 0..c.len() {
                for j in (i + 1)..c.len() {
                    let a = self.slots[c[i]].as_ref().unwrap();
                    let b = self.slots[c[j]].as_ref().unwrap();
                    let (lo, hi) = if a.ord < b.ord { (a, b) } else { (b, a) };
                    if !seen.insert((lo.ord, hi.ord)) {
                        continue;
                    }
                    if !bounds_overlap(&a.bounds, &b.bounds) || !can_collide(a.layer, a.mask, b.layer, b.mask) {
                        continue;
                    }
                    let (p, q) =
                        if cmp_id(&a.id, &b.id) != Ordering::Greater { (&a.id, &b.id) } else { (&b.id, &a.id) };
                    if let Some(f) = filter {
                        if !f(p, q) {
                            continue;
                        }
                    }
                    out.push((p.clone(), q.clone()));
                }
            }
        }
        out.sort_by(|p, q| cmp_id(&p.0, &q.0).then_with(|| cmp_id(&p.1, &q.1)));
        out
    }
}

// ---- colliders, scene, tilemap ---------------------------------------------------------------------------
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Solid,
    Oneway,
    Slope,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Solid => "solid",
            Kind::Oneway => "oneway",
            Kind::Slope => "slope",
        }
    }
    pub fn parse(s: &str) -> Option<Kind> {
        match s {
            "solid" => Some(Kind::Solid),
            "oneway" => Some(Kind::Oneway),
            "slope" => Some(Kind::Slope),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Slope {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Collider {
    pub kind: Kind,
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
    pub slope: Option<Slope>,
    pub layer: Option<i32>,
    pub mask: Option<i32>,
    pub col: Option<i32>,
    pub row: Option<i32>,
    pub tile: Option<i32>,
    pub id: Option<f64>,
}

impl Collider {
    pub fn new(kind: Kind, min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Collider {
        Collider {
            kind,
            min_x,
            min_y,
            max_x,
            max_y,
            slope: None,
            layer: None,
            mask: None,
            col: None,
            row: None,
            tile: None,
            id: None,
        }
    }
    pub fn bounds(&self) -> Bounds {
        Bounds { min_x: self.min_x, min_y: self.min_y, max_x: self.max_x, max_y: self.max_y }
    }
}

/// Floor height of a collider at world x (slope: interpolated and clamped to its span; others: top edge).
pub fn surface_y(c: &Collider, x: f64) -> f64 {
    if c.kind != Kind::Slope {
        return c.min_y;
    }
    let s = c.slope.expect("slope collider needs a slope");
    let u = f64::min(1.0, f64::max(0.0, (x - s.x0) / (s.x1 - s.x0)));
    s.y0 + (s.y1 - s.y0) * u
}

/// Shape of a collider (aabb, or a polygon for slopes) for `collide()` / `raycast()`.
pub fn collider_shape(c: &Collider) -> Shape {
    if c.kind != Kind::Slope {
        return Shape::aabb(
            (c.min_x + c.max_x) / 2.0,
            (c.min_y + c.max_y) / 2.0,
            (c.max_x - c.min_x) / 2.0,
            (c.max_y - c.min_y) / 2.0,
        );
    }
    let s = c.slope.expect("slope collider needs a slope");
    Shape::polygon(
        0.0,
        0.0,
        vec![Vec2::new(s.x0, c.max_y), Vec2::new(s.x1, c.max_y), Vec2::new(s.x1, s.y1), Vec2::new(s.x0, s.y0)],
        0.0,
    )
}

/// Anything that can answer "which colliders overlap these bounds" (scene or tilemap).
pub trait Source {
    fn query(&self, b: &Bounds) -> Vec<Collider>;
}

/// Static geometry container; `query` returns colliders in insertion order.
pub struct Scene {
    pub colliders: Vec<Collider>,
    hash: SpatialHash,
}

impl Scene {
    pub fn new(colliders: Vec<Collider>, cell_size: f64) -> Scene {
        let mut s = Scene { colliders: Vec::new(), hash: SpatialHash::new(cell_size) };
        for c in colliders {
            s.add(c);
        }
        s
    }
    pub fn add(&mut self, c: Collider) {
        self.hash.insert(Id::Num(self.colliders.len() as f64), c.bounds(), c.layer, c.mask);
        self.colliders.push(c);
    }
}

impl Source for Scene {
    fn query(&self, b: &Bounds) -> Vec<Collider> {
        self.hash
            .query(b)
            .into_iter()
            .map(|id| match id {
                Id::Num(i) => self.colliders[i as usize].clone(),
                Id::Str(_) => unreachable!(),
            })
            .collect()
    }
}

/// Tilemap of fixed tile size; `tiles` is row-major. `query` returns colliders in row-major order.
#[derive(Clone, Debug)]
pub struct Tilemap {
    pub cols: i32,
    pub rows: i32,
    pub tile_size: f64,
    pub tiles: Vec<i32>,
    pub x: f64,
    pub y: f64,
    pub outside: i32,
    pub one_way_thickness: f64,
}

impl Tilemap {
    pub fn new(cols: i32, rows: i32, tile_size: f64, tiles: Option<Vec<i32>>) -> Tilemap {
        Tilemap {
            cols,
            rows,
            tile_size,
            tiles: tiles.unwrap_or_else(|| vec![0; (cols * rows).max(0) as usize]),
            x: 0.0,
            y: 0.0,
            outside: 0,
            one_way_thickness: 4.0,
        }
    }
    pub fn get(&self, c: i32, r: i32) -> i32 {
        if c < 0 || r < 0 || c >= self.cols || r >= self.rows {
            self.outside
        } else {
            self.tiles[(r * self.cols + c) as usize]
        }
    }
    pub fn set(&mut self, c: i32, r: i32, k: i32) {
        if c >= 0 && r >= 0 && c < self.cols && r < self.rows {
            self.tiles[(r * self.cols + c) as usize] = k;
        }
    }
    pub fn collider_at(&self, c: i32, r: i32) -> Option<Collider> {
        let k = self.get(c, r);
        if k == tile::EMPTY {
            return None;
        }
        let ts = self.tile_size;
        let min_x = self.x + c as f64 * ts;
        let min_y = self.y + r as f64 * ts;
        let max_x = min_x + ts;
        let max_y = min_y + ts;
        let mut col = Collider::new(Kind::Solid, min_x, min_y, max_x, max_y);
        col.col = Some(c);
        col.row = Some(r);
        col.tile = Some(k);
        if k == tile::SOLID {
            return Some(col);
        }
        if k == tile::ONEWAY {
            col.kind = Kind::Oneway;
            col.max_y = min_y + f64::min(self.one_way_thickness, ts);
            return Some(col);
        }
        let s = slope_fractions(k)?;
        col.kind = Kind::Slope;
        col.slope = Some(Slope { x0: min_x, y0: max_y - s[0] * ts, x1: max_x, y1: max_y - s[1] * ts });
        Some(col)
    }
    /// `(col, row, kind)` of the tile under a world point.
    pub fn tile_at(&self, wx: f64, wy: f64) -> (i32, i32, i32) {
        let c = ((wx - self.x) / self.tile_size).floor() as i32;
        let r = ((wy - self.y) / self.tile_size).floor() as i32;
        (c, r, self.get(c, r))
    }
}

impl Source for Tilemap {
    fn query(&self, b: &Bounds) -> Vec<Collider> {
        let ts = self.tile_size;
        let c0 = ((b.min_x - self.x) / ts).floor() as i32;
        let c1 = ((b.max_x - self.x) / ts).floor() as i32;
        let r0 = ((b.min_y - self.y) / ts).floor() as i32;
        let r1 = ((b.max_y - self.y) / ts).floor() as i32;
        let mut out = Vec::new();
        for r in r0..=r1 {
            for c in c0..=c1 {
                if let Some(col) = self.collider_at(c, r) {
                    out.push(col);
                }
            }
        }
        out
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SourceOpts {
    pub layer: Option<i32>,
    pub mask: Option<i32>,
    pub prev_max_y: Option<f64>,
}

/// Collide a shape with a scene/tilemap: `(collider, manifold)` pairs (manifold normal points collider -> shape).
/// One-way colliders only count when the shape arrives from above.
pub fn collide_source(src: &dyn Source, shape: &Shape, opts: &SourceOpts) -> Vec<(Collider, Manifold)> {
    let mut out = Vec::new();
    for c in src.query(&bounds(shape)) {
        if !can_collide(c.layer, c.mask, opts.layer, opts.mask) {
            continue;
        }
        let Some(m) = collide(&collider_shape(&c), shape) else { continue };
        if c.kind == Kind::Oneway
            && !(m.normal.y < -0.5 && opts.prev_max_y.unwrap_or(f64::NEG_INFINITY) <= c.min_y + 1e-6)
        {
            continue;
        }
        out.push((c, m));
    }
    out
}

/// Platformer-physics world (`ground_y`, pits `(x0, x1)`, platforms `(x, y, w, id)`) -> collision scene.
pub fn from_platformer_world(
    ground_y: f64,
    pits: &[(f64, f64)],
    platforms: &[(f64, f64, f64, Option<f64>)],
    min_x: f64,
    max_x: f64,
    depth: f64,
) -> Scene {
    let mut cs = Vec::new();
    let mut cur = min_x;
    let mut sorted = pits.to_vec();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));
    for (x0, x1) in sorted {
        if x0 > cur {
            cs.push(Collider::new(Kind::Solid, cur, ground_y, x0, ground_y + depth));
        }
        cur = f64::max(cur, x1);
    }
    if max_x > cur {
        cs.push(Collider::new(Kind::Solid, cur, ground_y, max_x, ground_y + depth));
    }
    for &(x, y, w, id) in platforms {
        let mut c = Collider::new(Kind::Oneway, x - w / 2.0, y, x + w / 2.0, y + 4.0);
        c.id = id;
        cs.push(c);
    }
    Scene::new(cs, 64.0)
}

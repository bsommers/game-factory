//! Deterministic SAH-binned BVH over triangles or AABBs (port of `bvh.js`, see `spec/v3/bvh.md`).
//!
//! Build math is f64; node bounds are stored as f32 rounded OUTWARD so traversal never misses. [`Bvh::serialize`] produces the exact
//! little-endian buffer of the spec (also the GPU upload format). Triangle input is flat (9 numbers per triangle), AABB input flat
//! (6 per box: min xyz, max xyz). Query results report ORIGINAL primitive indices.
// Straight ports of the JS reference: negated comparisons and explicit min/max chains deliberately mirror its NaN and operation-order semantics.
#![allow(
    clippy::neg_cmp_op_on_partial_ord,
    clippy::manual_clamp,
    clippy::needless_range_loop,
    clippy::unnecessary_map_or,
    clippy::manual_range_contains,
    clippy::needless_late_init
)]

use crate::collision3d::{aabb_triangle_overlap, closest_point_triangle, ray_triangle_flat, Aabb, V3};

pub const MAGIC: u32 = 0x3348_5642;
pub const VERSION: u32 = 1;
pub const KIND_TRI: u32 = 0;
pub const KIND_AABB: u32 = 1;
pub const NODE_WORDS: usize = 8;
pub const HEADER_WORDS: usize = 16;
const BINS: usize = 16;

fn f32_down(x: f64) -> f32 {
    let mut r = x as f32;
    if (r as f64) > x {
        let b = r.to_bits();
        r = f32::from_bits(if r > 0.0 {
            b - 1
        } else if r == 0.0 {
            0x8000_0001
        } else {
            b + 1
        });
    }
    r
}

fn f32_up(x: f64) -> f32 {
    let mut r = x as f32;
    if (r as f64) < x {
        let b = r.to_bits();
        r = f32::from_bits(if r >= 0.0 {
            if r == 0.0 {
                1
            } else {
                b + 1
            }
        } else {
            b - 1
        });
    }
    r
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Node {
    pub min: [f32; 3],
    pub max: [f32; 3],
    /// Interior: left child index (right = left + 1). Leaf: first primitive (leaf order).
    pub left_first: u32,
    /// 0 = interior, > 0 = leaf primitive count.
    pub count: u32,
}

#[derive(Clone, Debug)]
pub struct Bvh {
    pub kind: u32,
    pub count: usize,
    pub stride: usize,
    pub nodes: Vec<Node>,
    /// `order[leafIndex]` = original primitive index.
    pub order: Vec<u32>,
    /// Primitive data in LEAF order (f64).
    pub prims: Vec<f64>,
    /// Primitive data in original order (f64).
    pub src: Vec<f64>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct BuildOpts {
    pub max_leaf_size: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RayOpts {
    pub tmax: f64,
    pub cull_back: bool,
    pub any: bool,
}

impl Default for RayOpts {
    fn default() -> Self {
        RayOpts { tmax: f64::INFINITY, cull_back: false, any: false }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BvhHit {
    pub t: f64,
    pub index: u32,
    pub u: f64,
    pub v: f64,
    pub front: bool,
    pub point: V3,
}

pub fn build_triangles(tris: &[f64], opts: BuildOpts) -> Result<Bvh, String> {
    build(KIND_TRI, tris, opts)
}
pub fn build_aabbs(boxes: &[f64], opts: BuildOpts) -> Result<Bvh, String> {
    build(KIND_AABB, boxes, opts)
}

fn build(kind: u32, input: &[f64], opts: BuildOpts) -> Result<Bvh, String> {
    let st = if kind == KIND_TRI { 9 } else { 6 };
    let n = input.len() / st;
    let max_leaf = opts.max_leaf_size.unwrap_or(4).max(1);
    let src: Vec<f64> = input.to_vec();
    let mut mn = vec![0.0f64; n * 3];
    let mut mx = vec![0.0f64; n * 3];
    for i in 0..n {
        for k in 0..3 {
            let (lo, hi);
            if kind == KIND_TRI {
                let (a, b, c) = (src[i * 9 + k], src[i * 9 + 3 + k], src[i * 9 + 6 + k]);
                lo = f64::min(f64::min(a, b), c);
                hi = f64::max(f64::max(a, b), c);
            } else {
                lo = src[i * 6 + k];
                hi = src[i * 6 + 3 + k];
            }
            if !lo.is_finite() || !hi.is_finite() {
                return Err(format!("bvh: non-finite primitive {i}"));
            }
            mn[i * 3 + k] = lo;
            mx[i * 3 + k] = hi;
        }
    }
    let mut order: Vec<u32> = (0..n as u32).collect();
    let max_nodes = std::cmp::max(1, 2 * n);
    let mut nodes = vec![Node::default(); max_nodes];
    let mut tmp = vec![0u32; n];
    let mut used = 1usize;
    let mut stack: Vec<(usize, usize, usize)> = vec![(0, 0, n)];
    let cen = |i: usize, k: usize| 0.5 * (mn[i * 3 + k] + mx[i * 3 + k]);
    while let Some((node, s, e)) = stack.pop() {
        let cnt = e - s;
        let mut bmin = [f64::INFINITY; 3];
        let mut bmax = [f64::NEG_INFINITY; 3];
        for j in s..e {
            let i = order[j] as usize;
            for k in 0..3 {
                if mn[i * 3 + k] < bmin[k] {
                    bmin[k] = mn[i * 3 + k];
                }
                if mx[i * 3 + k] > bmax[k] {
                    bmax[k] = mx[i * 3 + k];
                }
            }
        }
        if cnt == 0 {
            nodes[node] = Node::default();
            continue;
        }
        for k in 0..3 {
            nodes[node].min[k] = f32_down(bmin[k]);
            nodes[node].max[k] = f32_up(bmax[k]);
        }
        if cnt <= max_leaf {
            nodes[node].left_first = s as u32;
            nodes[node].count = cnt as u32;
            continue;
        }
        let mut cmin = [f64::INFINITY; 3];
        let mut cmax = [f64::NEG_INFINITY; 3];
        for j in s..e {
            let i = order[j] as usize;
            for k in 0..3 {
                let c = cen(i, k);
                if c < cmin[k] {
                    cmin[k] = c;
                }
                if c > cmax[k] {
                    cmax[k] = c;
                }
            }
        }
        let (mut best_cost, mut best_axis, mut best_split) = (f64::INFINITY, -1i32, -1i32);
        for ax in 0..3usize {
            let ext = cmax[ax] - cmin[ax];
            if !(ext > 0.0) {
                continue;
            }
            let mut bc = [0u32; BINS];
            let mut bl = [f64::INFINITY; BINS * 3];
            let mut bh = [f64::NEG_INFINITY; BINS * 3];
            let scale = BINS as f64 / ext;
            for j in s..e {
                let i = order[j] as usize;
                let mut b = ((cen(i, ax) - cmin[ax]) * scale).floor() as i64;
                if b >= BINS as i64 {
                    b = BINS as i64 - 1;
                }
                if b < 0 {
                    b = 0;
                }
                let b = b as usize;
                bc[b] += 1;
                for k in 0..3 {
                    if mn[i * 3 + k] < bl[b * 3 + k] {
                        bl[b * 3 + k] = mn[i * 3 + k];
                    }
                    if mx[i * 3 + k] > bh[b * 3 + k] {
                        bh[b * 3 + k] = mx[i * 3 + k];
                    }
                }
            }
            let mut l_a = [0.0f64; BINS - 1];
            let mut l_c = [0u32; BINS - 1];
            let mut c0 = 0u32;
            let mut lo = [f64::INFINITY; 3];
            let mut hi = [f64::NEG_INFINITY; 3];
            for b in 0..BINS - 1 {
                c0 += bc[b];
                if bc[b] != 0 {
                    for k in 0..3 {
                        lo[k] = f64::min(lo[k], bl[b * 3 + k]);
                        hi[k] = f64::max(hi[k], bh[b * 3 + k]);
                    }
                }
                l_c[b] = c0;
                let (dx, dy, dz) = (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
                l_a[b] = if c0 != 0 { dx * dy + dy * dz + dz * dx } else { 0.0 };
            }
            let mut c1 = 0u32;
            let mut lo2 = [f64::INFINITY; 3];
            let mut hi2 = [f64::NEG_INFINITY; 3];
            for b in (1..BINS).rev() {
                c1 += bc[b];
                if bc[b] != 0 {
                    for k in 0..3 {
                        lo2[k] = f64::min(lo2[k], bl[b * 3 + k]);
                        hi2[k] = f64::max(hi2[k], bh[b * 3 + k]);
                    }
                }
                let sp = b - 1;
                if l_c[sp] == 0 || c1 == 0 {
                    continue;
                }
                let (dx, dy, dz) = (hi2[0] - lo2[0], hi2[1] - lo2[1], hi2[2] - lo2[2]);
                let cost = l_c[sp] as f64 * l_a[sp] + c1 as f64 * (dx * dy + dy * dz + dz * dx);
                if cost < best_cost || (cost == best_cost && ax as i32 == best_axis && (sp as i32) < best_split) {
                    best_cost = cost;
                    best_axis = ax as i32;
                    best_split = sp as i32;
                }
            }
        }
        let mid;
        if best_axis < 0 {
            mid = s + (cnt >> 1);
        } else {
            let ba = best_axis as usize;
            let ext = cmax[ba] - cmin[ba];
            let scale = BINS as f64 / ext;
            let (mut l, mut r) = (0usize, 0usize);
            for j in s..e {
                let i = order[j] as usize;
                let mut b = ((cen(i, ba) - cmin[ba]) * scale).floor() as i64;
                if b >= BINS as i64 {
                    b = BINS as i64 - 1;
                }
                if b < 0 {
                    b = 0;
                }
                if b <= best_split as i64 {
                    order[s + l] = i as u32;
                    l += 1;
                } else {
                    tmp[r] = i as u32;
                    r += 1;
                }
            }
            for q in 0..r {
                order[s + l + q] = tmp[q];
            }
            mid = s + l;
        }
        let left = used;
        used += 2;
        nodes[node].left_first = left as u32;
        nodes[node].count = 0;
        stack.push((left + 1, mid, e));
        stack.push((left, s, mid));
    }
    nodes.truncate(used);
    let mut prims = vec![0.0f64; n * st];
    for j in 0..n {
        for q in 0..st {
            prims[j * st + q] = src[order[j] as usize * st + q];
        }
    }
    Ok(Bvh { kind, count: n, stride: st, nodes, order, prims, src })
}

impl Bvh {
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Refit for moved primitives (same count, ORIGINAL order); topology and `order` are unchanged.
    pub fn refit(&mut self, input: &[f64]) -> Result<(), String> {
        let (st, n) = (self.stride, self.count);
        if input.len() < n * st {
            return Err(format!("bvh.refit: expected {} numbers", n * st));
        }
        self.src[..n * st].copy_from_slice(&input[..n * st]);
        for j in 0..n {
            for q in 0..st {
                self.prims[j * st + q] = self.src[self.order[j] as usize * st + q];
            }
        }
        for node in (0..self.nodes.len()).rev() {
            let cnt = self.nodes[node].count;
            let mut lo = [f64::INFINITY; 3];
            let mut hi = [f64::NEG_INFINITY; 3];
            if cnt > 0 {
                let first = self.nodes[node].left_first as usize;
                for j in first..first + cnt as usize {
                    for k in 0..3 {
                        let (a, b);
                        if self.kind == KIND_TRI {
                            let (x, y, z) =
                                (self.prims[j * 9 + k], self.prims[j * 9 + 3 + k], self.prims[j * 9 + 6 + k]);
                            a = f64::min(f64::min(x, y), z);
                            b = f64::max(f64::max(x, y), z);
                        } else {
                            a = self.prims[j * 6 + k];
                            b = self.prims[j * 6 + 3 + k];
                        }
                        if a < lo[k] {
                            lo[k] = a;
                        }
                        if b > hi[k] {
                            hi[k] = b;
                        }
                    }
                }
            } else if self.nodes[node].left_first != 0 {
                let l = self.nodes[node].left_first as usize;
                let (nl, nr) = (self.nodes[l], self.nodes[l + 1]);
                for k in 0..3 {
                    lo[k] = f64::min(nl.min[k] as f64, nr.min[k] as f64);
                    hi[k] = f64::max(nl.max[k] as f64, nr.max[k] as f64);
                }
            } else {
                continue;
            }
            for k in 0..3 {
                self.nodes[node].min[k] = f32_down(lo[k]);
                self.nodes[node].max[k] = f32_up(hi[k]);
            }
        }
        Ok(())
    }

    /// Serialized little-endian buffer (see `spec/v3/bvh.md`).
    pub fn serialize(&self) -> Vec<u8> {
        let (st, n, nc) = (self.stride, self.count, self.nodes.len());
        let nodes_off = HEADER_WORDS;
        let order_off = nodes_off + nc * NODE_WORDS;
        let prims_off = order_off + n;
        let total = prims_off + n * st;
        let mut out: Vec<u8> = Vec::with_capacity(total * 4);
        let push_u = |v: u32, out: &mut Vec<u8>| out.extend_from_slice(&v.to_le_bytes());
        for w in [
            MAGIC,
            VERSION,
            self.kind,
            nc as u32,
            n as u32,
            nodes_off as u32,
            order_off as u32,
            prims_off as u32,
            st as u32,
        ] {
            push_u(w, &mut out);
        }
        for _ in 9..HEADER_WORDS {
            push_u(0, &mut out);
        }
        for nd in &self.nodes {
            for k in 0..3 {
                out.extend_from_slice(&nd.min[k].to_le_bytes());
            }
            push_u(nd.left_first, &mut out);
            for k in 0..3 {
                out.extend_from_slice(&nd.max[k].to_le_bytes());
            }
            push_u(nd.count, &mut out);
        }
        for o in &self.order {
            push_u(*o, &mut out);
        }
        for p in &self.prims {
            out.extend_from_slice(&(*p as f32).to_le_bytes());
        }
        out
    }

    /// Closest hit (ties: lowest original index). `None` for an empty BVH or a miss.
    pub fn raycast(&self, o: V3, d: V3, opts: RayOpts) -> Option<BvhHit> {
        if self.count == 0 {
            return None;
        }
        let mut tmax = opts.tmax;
        let (ix, iy, iz) = (inv(d[0]), inv(d[1]), inv(d[2]));
        let mut best: Option<BvhHit> = None;
        let mut stack: Vec<usize> = vec![0];
        if slab(&self.nodes[0], o, [ix, iy, iz], tmax) < 0.0 {
            return None;
        }
        while let Some(node) = stack.pop() {
            let nd = &self.nodes[node];
            if nd.count > 0 {
                for j in nd.left_first as usize..(nd.left_first + nd.count) as usize {
                    let Some((t, u, v, sign)) = self.prim_ray(j, o, d, tmax, opts.cull_back) else { continue };
                    let idx = self.order[j];
                    if best.as_ref().map_or(true, |b| t < b.t || (t == b.t && idx < b.index)) {
                        best = Some(BvhHit { t, index: idx, u, v, front: sign > 0.0, point: [0.0; 3] });
                        tmax = t;
                        if opts.any {
                            best.as_mut().unwrap().point = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
                            return best;
                        }
                    }
                }
            } else {
                let (l, r) = (nd.left_first as usize, nd.left_first as usize + 1);
                let tl = slab(&self.nodes[l], o, [ix, iy, iz], tmax);
                let tr = slab(&self.nodes[r], o, [ix, iy, iz], tmax);
                if tl >= 0.0 && tr >= 0.0 {
                    if tr < tl {
                        stack.push(l);
                        stack.push(r);
                    } else {
                        stack.push(r);
                        stack.push(l);
                    }
                } else if tl >= 0.0 {
                    stack.push(l);
                } else if tr >= 0.0 {
                    stack.push(r);
                }
            }
        }
        if let Some(b) = best.as_mut() {
            b.point = [o[0] + d[0] * b.t, o[1] + d[1] * b.t, o[2] + d[2] * b.t];
        }
        best
    }

    pub fn ray_any(&self, o: V3, d: V3, mut opts: RayOpts) -> bool {
        opts.any = true;
        self.raycast(o, d, opts).is_some()
    }

    fn prim_ray(&self, j: usize, o: V3, d: V3, tmax: f64, cull: bool) -> Option<(f64, f64, f64, f64)> {
        if self.kind == KIND_TRI {
            return ray_triangle_flat(o, d, &self.prims, j * 9, 0.0, tmax, cull);
        }
        let p = &self.prims;
        let q = j * 6;
        let (mut tn, mut tf) = (0.0f64, tmax);
        for i in 0..3 {
            if d[i] == 0.0 {
                if o[i] < p[q + i] || o[i] > p[q + 3 + i] {
                    return None;
                }
                continue;
            }
            let mut t1 = (p[q + i] - o[i]) / d[i];
            let mut t2 = (p[q + 3 + i] - o[i]) / d[i];
            if t1 > t2 {
                std::mem::swap(&mut t1, &mut t2);
            }
            if t1 > tn {
                tn = t1;
            }
            if t2 < tf {
                tf = t2;
            }
        }
        if tn <= tf {
            Some((tn, 0.0, 0.0, 0.0))
        } else {
            None
        }
    }

    fn walk(&self, node_test: &dyn Fn(&Node) -> bool, prim_test: &dyn Fn(usize) -> bool) -> Vec<u32> {
        let mut out = Vec::new();
        if self.count == 0 {
            return out;
        }
        let mut stack = vec![0usize];
        while let Some(node) = stack.pop() {
            let nd = &self.nodes[node];
            if !node_test(nd) {
                continue;
            }
            if nd.count > 0 {
                for j in nd.left_first as usize..(nd.left_first + nd.count) as usize {
                    if prim_test(j) {
                        out.push(self.order[j]);
                    }
                }
            } else {
                stack.push(nd.left_first as usize + 1);
                stack.push(nd.left_first as usize);
            }
        }
        out.sort_unstable();
        out
    }

    fn prim_box(&self, j: usize) -> [f64; 6] {
        let p = &self.prims;
        if self.kind == KIND_AABB {
            return [p[j * 6], p[j * 6 + 1], p[j * 6 + 2], p[j * 6 + 3], p[j * 6 + 4], p[j * 6 + 5]];
        }
        let q = j * 9;
        let mut b = [0.0; 6];
        for k in 0..3 {
            b[k] = f64::min(f64::min(p[q + k], p[q + 3 + k]), p[q + 6 + k]);
            b[3 + k] = f64::max(f64::max(p[q + k], p[q + 3 + k]), p[q + 6 + k]);
        }
        b
    }

    fn prim_tri(&self, j: usize) -> [V3; 3] {
        let (p, q) = (&self.prims, j * 9);
        [[p[q], p[q + 1], p[q + 2]], [p[q + 3], p[q + 4], p[q + 5]], [p[q + 6], p[q + 7], p[q + 8]]]
    }

    /// Ascending original indices of primitives overlapping the box (inclusive). Triangles: exact SAT.
    pub fn query_aabb(&self, bx: &Aabb) -> Vec<u32> {
        let (lo, hi) = (bx.min, bx.max);
        self.walk(
            &|n| {
                n.min[0] as f64 <= hi[0]
                    && n.max[0] as f64 >= lo[0]
                    && n.min[1] as f64 <= hi[1]
                    && n.max[1] as f64 >= lo[1]
                    && n.min[2] as f64 <= hi[2]
                    && n.max[2] as f64 >= lo[2]
            },
            &|j| {
                if self.kind == KIND_AABB {
                    let b = self.prim_box(j);
                    return b[0] <= hi[0]
                        && b[3] >= lo[0]
                        && b[1] <= hi[1]
                        && b[4] >= lo[1]
                        && b[2] <= hi[2]
                        && b[5] >= lo[2];
                }
                aabb_triangle_overlap(bx, &self.prim_tri(j))
            },
        )
    }

    /// Primitives within distance `r` (inclusive) of centre `c`.
    pub fn query_sphere(&self, c: V3, r: f64) -> Vec<u32> {
        let r2 = r * r;
        let d2box = |lo0: f64, lo1: f64, lo2: f64, hi0: f64, hi1: f64, hi2: f64| {
            let x = f64::max(f64::max(lo0 - c[0], 0.0), c[0] - hi0);
            let y = f64::max(f64::max(lo1 - c[1], 0.0), c[1] - hi1);
            let z = f64::max(f64::max(lo2 - c[2], 0.0), c[2] - hi2);
            x * x + y * y + z * z
        };
        self.walk(
            &|n| {
                d2box(
                    n.min[0] as f64,
                    n.min[1] as f64,
                    n.min[2] as f64,
                    n.max[0] as f64,
                    n.max[1] as f64,
                    n.max[2] as f64,
                ) <= r2
            },
            &|j| {
                if self.kind == KIND_AABB {
                    let b = self.prim_box(j);
                    return d2box(b[0], b[1], b[2], b[3], b[4], b[5]) <= r2;
                }
                let t = self.prim_tri(j);
                let p = closest_point_triangle(c, t[0], t[1], t[2]);
                let (x, y, z) = (p[0] - c[0], p[1] - c[1], p[2] - c[2]);
                x * x + y * y + z * z <= r2
            },
        )
    }

    /// Candidate indices by per-primitive bounds (conservative), ascending; for `collision3d::World::candidates`.
    pub fn query_bounds(&self, lo: V3, hi: V3) -> Vec<u32> {
        self.walk(
            &|n| {
                n.min[0] as f64 <= hi[0]
                    && n.max[0] as f64 >= lo[0]
                    && n.min[1] as f64 <= hi[1]
                    && n.max[1] as f64 >= lo[1]
                    && n.min[2] as f64 <= hi[2]
                    && n.max[2] as f64 >= lo[2]
            },
            &|j| {
                let b = self.prim_box(j);
                b[0] <= hi[0] && b[3] >= lo[0] && b[1] <= hi[1] && b[4] >= lo[1] && b[2] <= hi[2] && b[5] >= lo[2]
            },
        )
    }
}

/// `1/d`, with 0 as the "parallel to this slab" flag.
fn inv(d: f64) -> f64 {
    if d == 0.0 {
        0.0
    } else {
        1.0 / d
    }
}

/// Slab test against a node box (inclusive; far slab widened by `1 + 1e-6`). Entry `t` or `-1`.
fn slab(n: &Node, o: V3, i: [f64; 3], tmax: f64) -> f64 {
    let (mut tn, mut tf) = (0.0f64, f64::INFINITY);
    for k in 0..3 {
        let (lo, hi) = (n.min[k] as f64, n.max[k] as f64);
        if i[k] == 0.0 {
            if o[k] < lo || o[k] > hi {
                return -1.0;
            }
        } else {
            let t1 = (lo - o[k]) * i[k];
            let t2 = (hi - o[k]) * i[k];
            let (l, h) = if t1 < t2 { (t1, t2) } else { (t2, t1) };
            if l > tn {
                tn = l;
            }
            if h < tf {
                tf = h;
            }
        }
    }
    tf = tf * (1.0 + 1e-6) + 1e-30;
    if tn <= tf && tn <= tmax {
        tn
    } else {
        -1.0
    }
}

/// FNV-1a 32-bit over raw bytes (used to checksum serialized buffers).
pub fn fnv1a32_bytes(buf: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in buf {
        h ^= *b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

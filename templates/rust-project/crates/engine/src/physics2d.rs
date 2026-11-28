//! Deterministic 2D rigid-body engine and kinematic character controller (port of `physics2d.js`, see `spec/v2/physics2d.md`).
//!
//! Fixed-step, id-ordered, no clocks, no RNG. The solver reproduces the JS order of floating point operations exactly
//! (sequential impulses with warm starting, soft/rigid joints, sleeping islands, CCD against static bodies).
//! x right, y DOWN, angles in radians (positive = clockwise on screen).
// Straight ports of the JS reference: negated comparisons and explicit min/max chains deliberately mirror its NaN and operation-order semantics.
#![allow(
    clippy::neg_cmp_op_on_partial_ord,
    clippy::manual_clamp,
    clippy::needless_range_loop,
    clippy::unnecessary_map_or,
    clippy::manual_range_contains,
    clippy::needless_late_init
)]

use crate::collision2d::{
    bounds, bounds_overlap, can_collide, collide, contains_point, raycast, shape_cast, surface_y, Bounds, Collider, Id,
    Kind, RayHit, Shape, Source, SpatialHash, Vec2,
};
use std::collections::{HashMap, HashSet};

fn cross(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    ax * by - ay * bx
}

#[derive(Clone, Debug)]
pub struct WorldConfig {
    pub gravity: Vec2,
    pub velocity_iterations: usize,
    pub slop: f64,
    pub baumgarte: f64,
    pub max_bias: f64,
    pub restitution_threshold: f64,
    pub warm_radius: f64,
    pub cell_size: f64,
    pub sleep: bool,
    pub ccd: bool,
    pub time_to_sleep: f64,
    pub linear_sleep: f64,
    pub angular_sleep: f64,
}

impl Default for WorldConfig {
    fn default() -> Self {
        WorldConfig {
            gravity: Vec2::new(0.0, 600.0),
            velocity_iterations: 10,
            slop: 0.25,
            baumgarte: 0.2,
            max_bias: 150.0,
            restitution_threshold: 30.0,
            warm_radius: 4.0,
            cell_size: 64.0,
            sleep: true,
            ccd: true,
            time_to_sleep: 0.5,
            linear_sleep: 5.0,
            angular_sleep: 0.1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BodyType {
    Static,
    Dynamic,
    Kinematic,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BodyShape {
    Circle { r: f64 },
    Box { hw: f64, hh: f64 },
    Capsule { hl: f64, r: f64 },
    Polygon { points: Vec<Vec2> },
}

/// Body definition; `None` fields take the JS defaults.
#[derive(Clone, Debug, Default)]
pub struct BodyDef {
    pub kind: Option<BodyType>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub angle: Option<f64>,
    pub vx: Option<f64>,
    pub vy: Option<f64>,
    pub w: Option<f64>,
    pub shape: Option<BodyShape>,
    pub density: Option<f64>,
    pub friction: Option<f64>,
    pub restitution: Option<f64>,
    pub layer: Option<i32>,
    pub mask: Option<i32>,
    pub sensor: bool,
    pub linear_damping: Option<f64>,
    pub angular_damping: Option<f64>,
    pub gravity_scale: Option<f64>,
    pub fixed_rotation: bool,
    pub allow_sleep: Option<bool>,
}

#[derive(Clone, Debug)]
pub struct Body {
    pub id: u32,
    pub kind: BodyType,
    pub x: f64,
    pub y: f64,
    pub angle: f64,
    pub vx: f64,
    pub vy: f64,
    pub w: f64,
    pub fx: f64,
    pub fy: f64,
    pub torque: f64,
    pub shape: BodyShape,
    pub density: f64,
    pub friction: f64,
    pub restitution: f64,
    pub layer: i32,
    pub mask: i32,
    pub sensor: bool,
    pub linear_damping: f64,
    pub angular_damping: f64,
    pub gravity_scale: f64,
    pub fixed_rotation: bool,
    pub allow_sleep: bool,
    pub inv_mass: f64,
    pub inv_i: f64,
    pub asleep: bool,
    pub sleep_t: f64,
    pub island: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JointType {
    Distance,
    Spring,
    Revolute,
}

#[derive(Clone, Debug, Default)]
pub struct JointDef {
    pub kind: Option<JointType>,
    pub a: u32,
    pub b: u32,
    pub anchor_a: Option<Vec2>,
    pub anchor_b: Option<Vec2>,
    pub length: Option<f64>,
    pub stiffness: Option<f64>,
    pub damping: Option<f64>,
    pub collide_connected: bool,
}

#[derive(Clone, Debug)]
pub struct Joint {
    pub id: u32,
    pub kind: JointType,
    pub a: u32,
    pub b: u32,
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    pub length: f64,
    pub stiffness: f64,
    pub damping: f64,
    pub collide_connected: bool,
    j: f64,
    jx: f64,
    jy: f64,
    rax: f64,
    ray: f64,
    rbx: f64,
    rby: f64,
    m11: f64,
    m12: f64,
    m22: f64,
    bias_x: f64,
    bias_y: f64,
    ux: f64,
    uy: f64,
    gamma: f64,
    bias: f64,
    mass: f64,
}

#[derive(Clone, Debug, Default)]
pub struct ContactPoint {
    pub x: f64,
    pub y: f64,
    pub depth: f64,
    pub jn: f64,
    pub jt: f64,
    rax: f64,
    ray: f64,
    rbx: f64,
    rby: f64,
    mass_n: f64,
    mass_t: f64,
    bias: f64,
}

#[derive(Clone, Debug)]
pub struct Contact {
    pub key: String,
    pub a: u32,
    pub b: u32,
    pub nx: f64,
    pub ny: f64,
    pub friction: f64,
    pub restitution: f64,
    pub points: Vec<ContactPoint>,
    carried: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SensorHit {
    pub key: String,
    pub sensor: u32,
    pub other: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    Begin { a: u32, b: u32 },
    End { a: u32, b: u32 },
    Enter { sensor: u32, other: u32 },
    Stay { sensor: u32, other: u32 },
    Exit { sensor: u32, other: u32 },
}

// ---- mass properties -------------------------------------------------------------------------------------
struct PolyProps {
    area: f64,
    cx: f64,
    cy: f64,
    i: f64,
}

fn poly_props(pts: &[Vec2]) -> PolyProps {
    let (mut a2, mut cx, mut cy, mut i) = (0.0, 0.0, 0.0, 0.0);
    for k in 0..pts.len() {
        let p = pts[k];
        let q = pts[(k + 1) % pts.len()];
        let cr = p.x * q.y - q.x * p.y;
        a2 += cr;
        cx += (p.x + q.x) * cr;
        cy += (p.y + q.y) * cr;
        i += cr * (p.x * p.x + p.x * q.x + q.x * q.x + p.y * p.y + p.y * q.y + q.y * q.y);
    }
    let area = a2 / 2.0;
    let sgn = if area < 0.0 { -1.0 } else { 1.0 };
    let aa = area.abs();
    cx /= 6.0 * area;
    cy /= 6.0 * area;
    let io = sgn * i / 12.0;
    PolyProps { area: aa, cx, cy, i: io - aa * (cx * cx + cy * cy) }
}

/// `(mass, inertia)` of a shape at the given density.
fn mass_props(sh: &BodyShape, density: f64) -> (f64, f64) {
    match sh {
        BodyShape::Circle { r } => {
            let m = density * std::f64::consts::PI * r * r;
            (m, 0.5 * m * r * r)
        }
        BodyShape::Box { hw, hh } => {
            let m = density * 4.0 * hw * hh;
            (m, m * (4.0 * hw * hw + 4.0 * hh * hh) / 12.0)
        }
        BodyShape::Capsule { hl, r } => {
            let mr = density * 4.0 * hl * r;
            let mc = density * std::f64::consts::PI * r * r;
            let d = 4.0 * r / (3.0 * std::f64::consts::PI);
            let hm = mc / 2.0;
            let ir = mr * (4.0 * hl * hl + 4.0 * r * r) / 12.0;
            let ih = 0.5 * hm * r * r - hm * d * d + hm * (hl + d) * (hl + d);
            (mr + mc, ir + 2.0 * ih)
        }
        BodyShape::Polygon { points } => {
            let pp = poly_props(points);
            (density * pp.area, density * pp.i)
        }
    }
}

/// The collision2d shape of a body at its current pose.
pub fn placed(b: &Body) -> Shape {
    match &b.shape {
        BodyShape::Circle { r } => Shape::circle(b.x, b.y, *r),
        BodyShape::Box { hw, hh } => {
            if b.angle == 0.0 {
                Shape::aabb(b.x, b.y, *hw, *hh)
            } else {
                Shape::obb(b.x, b.y, *hw, *hh, b.angle)
            }
        }
        BodyShape::Capsule { hl, r } => Shape::capsule(b.x, b.y, *hl, *r, b.angle),
        BodyShape::Polygon { points } => Shape::polygon(b.x, b.y, points.clone(), b.angle),
    }
}

fn pair_key(a: u32, b: u32) -> String {
    format!("{a}:{b}")
}

fn apply_p(b: &mut Body, px: f64, py: f64, rx: f64, ry: f64, k: f64) {
    b.vx += px * b.inv_mass * k;
    b.vy += py * b.inv_mass * k;
    b.w += b.inv_i * cross(rx, ry, px, py) * k;
}

fn settled(b: &Body) -> bool {
    b.kind == BodyType::Static
        || b.asleep
        || (b.kind == BodyType::Kinematic && b.vx == 0.0 && b.vy == 0.0 && b.w == 0.0)
}

fn awake(o: &Body) -> bool {
    (o.kind == BodyType::Dynamic && !o.asleep) || (o.kind == BodyType::Kinematic && !settled(o))
}

fn find(par: &mut [usize], mut i: usize) -> usize {
    while par[i] != i {
        par[i] = par[par[i]];
        i = par[i];
    }
    i
}

// ---- world -----------------------------------------------------------------------------------------------
/// The physics world. `Clone` is the snapshot: a cloned world replays bit-identically.
#[derive(Clone)]
pub struct World {
    pub config: WorldConfig,
    pub bodies: Vec<Body>,
    pub joints: Vec<Joint>,
    pub contacts: Vec<Contact>,
    pub sensors: Vec<SensorHit>,
    pub events: Vec<Event>,
    pub time: f64,
    pub steps: u64,
    next_id: u32,
    next_joint: u32,
    next_island: u32,
    index: HashMap<u32, usize>,
}

impl World {
    pub fn new(config: WorldConfig) -> World {
        World {
            config,
            bodies: Vec::new(),
            joints: Vec::new(),
            contacts: Vec::new(),
            sensors: Vec::new(),
            events: Vec::new(),
            time: 0.0,
            steps: 0,
            next_id: 1,
            next_joint: 1,
            next_island: 1,
            index: HashMap::new(),
        }
    }

    fn reindex(&mut self) {
        self.index = self.bodies.iter().enumerate().map(|(i, b)| (b.id, i)).collect();
    }

    fn idx(&self, id: u32) -> usize {
        self.index[&id]
    }

    pub fn body(&self, id: u32) -> Option<&Body> {
        self.index.get(&id).map(|&i| &self.bodies[i])
    }

    fn need(&self, id: u32) -> Result<usize, String> {
        self.index.get(&id).copied().ok_or_else(|| format!("physics2d: no body {id}"))
    }

    fn wake_idx(&mut self, bi: usize) {
        if !self.bodies[bi].asleep {
            self.bodies[bi].sleep_t = 0.0;
            return;
        }
        let isl = self.bodies[bi].island;
        for oi in 0..self.bodies.len() {
            if self.bodies[oi].asleep && (oi == bi || (isl.is_some() && self.bodies[oi].island == isl)) {
                let o = &mut self.bodies[oi];
                o.asleep = false;
                o.island = None;
                o.sleep_t = 0.0;
            }
        }
    }

    pub fn wake(&mut self, id: u32) -> Result<(), String> {
        let i = self.need(id)?;
        self.wake_idx(i);
        Ok(())
    }

    pub fn add_body(&mut self, def: &BodyDef) -> Result<u32, String> {
        let sh = def.shape.clone().ok_or_else(|| "physics2d: body needs a shape".to_string())?;
        let kind = def.kind.unwrap_or(BodyType::Dynamic);
        let density = def.density.unwrap_or(1.0);
        let (mut x, mut y) = (def.x.unwrap_or(0.0), def.y.unwrap_or(0.0));
        let angle = def.angle.unwrap_or(0.0);
        let mut shape = sh;
        if let BodyShape::Polygon { points } = &mut shape {
            let pp = poly_props(points);
            let (c, s) = (angle.cos(), angle.sin());
            x += pp.cx * c - pp.cy * s;
            y += pp.cx * s + pp.cy * c;
            for p in points.iter_mut() {
                *p = Vec2::new(p.x - pp.cx, p.y - pp.cy);
            }
        }
        let (mut inv_mass, mut inv_i) = (0.0, 0.0);
        if kind == BodyType::Dynamic {
            let (m, i) = mass_props(&shape, density);
            inv_mass = if m > 0.0 { 1.0 / m } else { 0.0 };
            inv_i = if def.fixed_rotation || i <= 0.0 { 0.0 } else { 1.0 / i };
        }
        let id = self.next_id;
        self.next_id += 1;
        let b = Body {
            id,
            kind,
            x,
            y,
            angle,
            vx: def.vx.unwrap_or(0.0),
            vy: def.vy.unwrap_or(0.0),
            w: def.w.unwrap_or(0.0),
            fx: 0.0,
            fy: 0.0,
            torque: 0.0,
            shape,
            density,
            friction: def.friction.unwrap_or(0.5),
            restitution: def.restitution.unwrap_or(0.0),
            layer: def.layer.unwrap_or(1),
            mask: def.mask.unwrap_or(-1),
            sensor: def.sensor,
            linear_damping: def.linear_damping.unwrap_or(0.0),
            angular_damping: def.angular_damping.unwrap_or(0.0),
            gravity_scale: def.gravity_scale.unwrap_or(1.0),
            fixed_rotation: def.fixed_rotation,
            allow_sleep: def.allow_sleep.unwrap_or(true),
            inv_mass,
            inv_i,
            asleep: false,
            sleep_t: 0.0,
            island: None,
        };
        self.bodies.push(b);
        self.index.insert(id, self.bodies.len() - 1);
        Ok(id)
    }

    pub fn remove_body(&mut self, id: u32) {
        self.bodies.retain(|b| b.id != id);
        self.joints.retain(|j| j.a != id && j.b != id);
        self.contacts.retain(|c| c.a != id && c.b != id);
        self.reindex();
    }

    fn anchor(b: &Body, lx: f64, ly: f64) -> (f64, f64) {
        let (c, s) = (b.angle.cos(), b.angle.sin());
        (b.x + lx * c - ly * s, b.y + lx * s + ly * c)
    }

    pub fn add_joint(&mut self, def: &JointDef) -> Result<u32, String> {
        let (Some(&ia), Some(&ib)) = (self.index.get(&def.a), self.index.get(&def.b)) else {
            return Err("physics2d: joint needs two bodies".to_string());
        };
        let la = def.anchor_a.unwrap_or(Vec2::new(0.0, 0.0));
        let lb = def.anchor_b.unwrap_or(Vec2::new(0.0, 0.0));
        let kind = def.kind.unwrap_or(JointType::Distance);
        let mut length = def.length.unwrap_or(0.0);
        if kind != JointType::Revolute && def.length.is_none() {
            let (pax, pay) = Self::anchor(&self.bodies[ia], la.x, la.y);
            let (pbx, pby) = Self::anchor(&self.bodies[ib], lb.x, lb.y);
            length = ((pbx - pax) * (pbx - pax) + (pby - pay) * (pby - pay)).sqrt();
        }
        let id = self.next_joint;
        self.next_joint += 1;
        self.joints.push(Joint {
            id,
            kind,
            a: def.a,
            b: def.b,
            ax: la.x,
            ay: la.y,
            bx: lb.x,
            by: lb.y,
            length,
            stiffness: def.stiffness.unwrap_or(if def.kind == Some(JointType::Spring) { 200.0 } else { 0.0 }),
            damping: def.damping.unwrap_or(0.0),
            collide_connected: def.collide_connected,
            j: 0.0,
            jx: 0.0,
            jy: 0.0,
            rax: 0.0,
            ray: 0.0,
            rbx: 0.0,
            rby: 0.0,
            m11: 0.0,
            m12: 0.0,
            m22: 0.0,
            bias_x: 0.0,
            bias_y: 0.0,
            ux: 0.0,
            uy: 0.0,
            gamma: 0.0,
            bias: 0.0,
            mass: 0.0,
        });
        self.wake_idx(ia);
        self.wake_idx(ib);
        Ok(id)
    }

    pub fn remove_joint(&mut self, id: u32) {
        self.joints.retain(|j| j.id != id);
    }

    // ---- control -----------------------------------------------------------------------------------------
    pub fn set_velocity(&mut self, id: u32, vx: f64, vy: f64, w: Option<f64>) -> Result<(), String> {
        let i = self.need(id)?;
        self.wake_idx(i);
        let b = &mut self.bodies[i];
        b.vx = vx;
        b.vy = vy;
        if let Some(w) = w {
            b.w = w;
        }
        Ok(())
    }
    pub fn set_position(&mut self, id: u32, x: f64, y: f64, angle: Option<f64>) -> Result<(), String> {
        let i = self.need(id)?;
        self.wake_idx(i);
        let b = &mut self.bodies[i];
        b.x = x;
        b.y = y;
        if let Some(a) = angle {
            b.angle = a;
        }
        Ok(())
    }
    pub fn apply_force(&mut self, id: u32, fx: f64, fy: f64) -> Result<(), String> {
        let i = self.need(id)?;
        self.wake_idx(i);
        self.bodies[i].fx += fx;
        self.bodies[i].fy += fy;
        Ok(())
    }
    pub fn apply_torque(&mut self, id: u32, t: f64) -> Result<(), String> {
        let i = self.need(id)?;
        self.wake_idx(i);
        self.bodies[i].torque += t;
        Ok(())
    }
    /// `v += i*invMass`; `w += invI*cross(p-pos, i)` only when a point is given.
    pub fn apply_impulse(&mut self, id: u32, ix: f64, iy: f64, point: Option<(f64, f64)>) -> Result<(), String> {
        let i = self.need(id)?;
        self.wake_idx(i);
        let b = &mut self.bodies[i];
        b.vx += ix * b.inv_mass;
        b.vy += iy * b.inv_mass;
        if let Some((px, py)) = point {
            b.w += b.inv_i * cross(px - b.x, py - b.y, ix, iy);
        }
        Ok(())
    }
    pub fn kinematic_step(&mut self, id: u32, vx: f64, vy: f64, w: f64) -> Result<(), String> {
        let i = self.need(id)?;
        let b = &mut self.bodies[i];
        b.vx = vx;
        b.vy = vy;
        b.w = w;
        Ok(())
    }

    // ---- step --------------------------------------------------------------------------------------------
    pub fn step(&mut self, dt: f64) {
        self.events.clear();
        let cfg = self.config.clone();
        let g = cfg.gravity;
        // 1. integrate velocities
        for b in self.bodies.iter_mut() {
            if b.kind != BodyType::Dynamic || b.asleep {
                b.fx = 0.0;
                b.fy = 0.0;
                b.torque = 0.0;
                continue;
            }
            b.vx += (g.x * b.gravity_scale + b.fx * b.inv_mass) * dt;
            b.vy += (g.y * b.gravity_scale + b.fy * b.inv_mass) * dt;
            b.w += b.torque * b.inv_i * dt;
            b.vx /= 1.0 + dt * b.linear_damping;
            b.vy /= 1.0 + dt * b.linear_damping;
            b.w /= 1.0 + dt * b.angular_damping;
            b.fx = 0.0;
            b.fy = 0.0;
            b.torque = 0.0;
        }
        // 2. broadphase + narrowphase
        let mut hash = SpatialHash::new(cfg.cell_size);
        let margin = cfg.slop * 2.0;
        for b in &self.bodies {
            let bb = bounds(&placed(b));
            hash.insert(
                Id::Num(b.id as f64),
                Bounds {
                    min_x: bb.min_x - margin,
                    min_y: bb.min_y - margin,
                    max_x: bb.max_x + margin,
                    max_y: bb.max_y + margin,
                },
                Some(b.layer),
                Some(b.mask),
            );
        }
        let skip: HashSet<String> = self
            .joints
            .iter()
            .filter(|j| !j.collide_connected)
            .map(|j| if j.a < j.b { pair_key(j.a, j.b) } else { pair_key(j.b, j.a) })
            .collect();
        let prev: HashMap<String, usize> = self.contacts.iter().enumerate().map(|(i, c)| (c.key.clone(), i)).collect();
        let prev_sensors: HashSet<String> = self.sensors.iter().map(|s| s.key.clone()).collect();
        let mut contacts: Vec<Contact> = Vec::new();
        let mut sensors: Vec<SensorHit> = Vec::new();
        for (pa, pb) in hash.pairs(None) {
            let (Id::Num(fa), Id::Num(fb)) = (pa, pb) else { unreachable!() };
            let (ida, idb) = (fa as u32, fb as u32);
            let (ia, ib) = (self.idx(ida), self.idx(idb));
            let key = pair_key(ida, idb);
            let (a_sensor, b_sensor) = (self.bodies[ia].sensor, self.bodies[ib].sensor);
            let sp = a_sensor || b_sensor;
            if a_sensor && b_sensor {
                continue;
            }
            let (ak, bk) = (self.bodies[ia].kind, self.bodies[ib].kind);
            if sp {
                if ak == BodyType::Static && bk == BodyType::Static {
                    continue;
                }
            } else if ak != BodyType::Dynamic && bk != BodyType::Dynamic {
                continue;
            }
            if skip.contains(&key) {
                continue;
            }
            if !sp && settled(&self.bodies[ia]) && settled(&self.bodies[ib]) {
                if let Some(&pi) = prev.get(&key) {
                    let mut c = self.contacts[pi].clone();
                    c.carried = true;
                    contacts.push(c);
                }
                continue;
            }
            let m = collide(&placed(&self.bodies[ia]), &placed(&self.bodies[ib]));
            let Some(m) = m else { continue };
            if sp {
                sensors.push(SensorHit {
                    key,
                    sensor: if a_sensor { ida } else { idb },
                    other: if a_sensor { idb } else { ida },
                });
                continue;
            }
            if self.bodies[ia].asleep && awake(&self.bodies[ib]) {
                self.wake_idx(ia);
            }
            if self.bodies[ib].asleep && awake(&self.bodies[ia]) {
                self.wake_idx(ib);
            }
            let old = prev.get(&key).map(|&i| &self.contacts[i]);
            let pts: Vec<ContactPoint> = m
                .points
                .iter()
                .map(|p| {
                    let (mut jn, mut jt) = (0.0, 0.0);
                    if let Some(old) = old {
                        let mut bd = cfg.warm_radius * cfg.warm_radius;
                        for q in &old.points {
                            let d2 = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
                            if d2 < bd {
                                bd = d2;
                                jn = q.jn;
                                jt = q.jt;
                            }
                        }
                    }
                    ContactPoint { x: p.x, y: p.y, depth: p.depth, jn, jt, ..Default::default() }
                })
                .collect();
            let (ba, bb) = (&self.bodies[ia], &self.bodies[ib]);
            contacts.push(Contact {
                key,
                a: ida,
                b: idb,
                nx: m.normal.x,
                ny: m.normal.y,
                friction: (ba.friction * bb.friction).sqrt(),
                restitution: f64::max(ba.restitution, bb.restitution),
                points: pts,
                carried: false,
            });
        }
        // events
        let cur_c: HashSet<&str> = contacts.iter().map(|c| c.key.as_str()).collect();
        let prev_c: HashSet<&str> = self.contacts.iter().map(|c| c.key.as_str()).collect();
        let mut events = Vec::new();
        for c in &contacts {
            if !prev_c.contains(c.key.as_str()) {
                events.push(Event::Begin { a: c.a, b: c.b });
            }
        }
        for c in &self.contacts {
            if !cur_c.contains(c.key.as_str()) {
                events.push(Event::End { a: c.a, b: c.b });
            }
        }
        let cur_s: HashSet<&str> = sensors.iter().map(|s| s.key.as_str()).collect();
        for s in &sensors {
            events.push(if prev_sensors.contains(&s.key) {
                Event::Stay { sensor: s.sensor, other: s.other }
            } else {
                Event::Enter { sensor: s.sensor, other: s.other }
            });
        }
        for s in &self.sensors {
            if !cur_s.contains(s.key.as_str()) {
                events.push(Event::Exit { sensor: s.sensor, other: s.other });
            }
        }
        self.events = events;

        // 3. pre-solve
        let solve: Vec<usize> = (0..contacts.len()).filter(|&i| !contacts[i].carried).collect();
        for &ci in &solve {
            let (ia, ib) = (self.idx(contacts[ci].a), self.idx(contacts[ci].b));
            let (nx, ny) = (contacts[ci].nx, contacts[ci].ny);
            let (tx, ty) = (ny, -nx);
            let restitution = contacts[ci].restitution;
            for p in contacts[ci].points.iter_mut() {
                let (a, b) = (&self.bodies[ia], &self.bodies[ib]);
                p.rax = p.x - a.x;
                p.ray = p.y - a.y;
                p.rbx = p.x - b.x;
                p.rby = p.y - b.y;
                let rn_a = cross(p.rax, p.ray, nx, ny);
                let rn_b = cross(p.rbx, p.rby, nx, ny);
                let rt_a = cross(p.rax, p.ray, tx, ty);
                let rt_b = cross(p.rbx, p.rby, tx, ty);
                let k_n = a.inv_mass + b.inv_mass + a.inv_i * rn_a * rn_a + b.inv_i * rn_b * rn_b;
                let k_t = a.inv_mass + b.inv_mass + a.inv_i * rt_a * rt_a + b.inv_i * rt_b * rt_b;
                p.mass_n = if k_n > 0.0 { 1.0 / k_n } else { 0.0 };
                p.mass_t = if k_t > 0.0 { 1.0 / k_t } else { 0.0 };
                let dvx = (b.vx - b.w * p.rby) - (a.vx - a.w * p.ray);
                let dvy = (b.vy + b.w * p.rbx) - (a.vy + a.w * p.rax);
                let vn = dvx * nx + dvy * ny;
                let bias_r = if vn < -cfg.restitution_threshold { -restitution * vn } else { 0.0 };
                let bias_p = f64::min(cfg.max_bias, f64::max(0.0, p.depth - cfg.slop) * cfg.baumgarte / dt);
                p.bias = f64::max(bias_r, bias_p);
                let px = p.jn * nx + p.jt * tx;
                let py = p.jn * ny + p.jt * ty;
                apply_p(&mut self.bodies[ia], px, py, p.rax, p.ray, -1.0);
                apply_p(&mut self.bodies[ib], px, py, p.rbx, p.rby, 1.0);
            }
        }
        for ji in 0..self.joints.len() {
            let (ia, ib) = (self.idx(self.joints[ji].a), self.idx(self.joints[ji].b));
            if self.bodies[ia].asleep && awake(&self.bodies[ib]) {
                self.wake_idx(ia);
            }
            if self.bodies[ib].asleep && awake(&self.bodies[ia]) {
                self.wake_idx(ib);
            }
        }
        let jlive: Vec<usize> = (0..self.joints.len())
            .filter(|&ji| {
                let j = &self.joints[ji];
                !(settled(&self.bodies[self.idx(j.a)]) && settled(&self.bodies[self.idx(j.b)]))
            })
            .collect();
        for &ji in &jlive {
            self.prestep_joint(ji, dt);
        }

        // 4. velocity iterations
        for _ in 0..cfg.velocity_iterations {
            for &ji in &jlive {
                self.solve_joint(ji);
            }
            for &ci in &solve {
                let (ia, ib) = (self.idx(contacts[ci].a), self.idx(contacts[ci].b));
                let (nx, ny) = (contacts[ci].nx, contacts[ci].ny);
                let (tx, ty) = (ny, -nx);
                let friction = contacts[ci].friction;
                for p in contacts[ci].points.iter_mut() {
                    let (a, b) = (&self.bodies[ia], &self.bodies[ib]);
                    let dvx = (b.vx - b.w * p.rby) - (a.vx - a.w * p.ray);
                    let dvy = (b.vy + b.w * p.rbx) - (a.vy + a.w * p.rax);
                    let lam = -p.mass_t * (dvx * tx + dvy * ty);
                    let max_f = friction * p.jn;
                    let nj = f64::min(max_f, f64::max(-max_f, p.jt + lam));
                    let d = nj - p.jt;
                    p.jt = nj;
                    apply_p(&mut self.bodies[ia], tx * d, ty * d, p.rax, p.ray, -1.0);
                    apply_p(&mut self.bodies[ib], tx * d, ty * d, p.rbx, p.rby, 1.0);
                }
                for p in contacts[ci].points.iter_mut() {
                    let (a, b) = (&self.bodies[ia], &self.bodies[ib]);
                    let dvx = (b.vx - b.w * p.rby) - (a.vx - a.w * p.ray);
                    let dvy = (b.vy + b.w * p.rbx) - (a.vy + a.w * p.rax);
                    let lam = -p.mass_n * (dvx * nx + dvy * ny - p.bias);
                    let nj = f64::max(p.jn + lam, 0.0);
                    let d = nj - p.jn;
                    p.jn = nj;
                    apply_p(&mut self.bodies[ia], nx * d, ny * d, p.rax, p.ray, -1.0);
                    apply_p(&mut self.bodies[ib], nx * d, ny * d, p.rbx, p.rby, 1.0);
                }
            }
        }
        // 5. integrate positions
        for bi in 0..self.bodies.len() {
            if self.bodies[bi].kind == BodyType::Static || self.bodies[bi].asleep {
                continue;
            }
            let (mut mx, mut my) = (self.bodies[bi].vx * dt, self.bodies[bi].vy * dt);
            if self.bodies[bi].kind == BodyType::Dynamic && !self.bodies[bi].sensor && cfg.ccd {
                let t = self.ccd_fraction(bi, mx, my);
                if t < 1.0 {
                    mx *= t;
                    my *= t;
                }
            }
            let b = &mut self.bodies[bi];
            b.x += mx;
            b.y += my;
            b.angle += b.w * dt;
        }
        // 6. sleeping
        if cfg.sleep {
            let live: Vec<usize> = (0..self.bodies.len())
                .filter(|&i| self.bodies[i].kind == BodyType::Dynamic && !self.bodies[i].asleep)
                .collect();
            let idx: HashMap<u32, usize> = live.iter().enumerate().map(|(i, &bi)| (self.bodies[bi].id, i)).collect();
            let mut par: Vec<usize> = (0..live.len()).collect();
            let uni = |a: u32, b: u32, par: &mut Vec<usize>| {
                let (Some(&x), Some(&y)) = (idx.get(&a), idx.get(&b)) else { return };
                let (rx, ry) = (find(par, x), find(par, y));
                if rx != ry {
                    par[rx.max(ry)] = rx.min(ry);
                }
            };
            for &ci in &solve {
                uni(contacts[ci].a, contacts[ci].b, &mut par);
            }
            for &ji in &jlive {
                uni(self.joints[ji].a, self.joints[ji].b, &mut par);
            }
            let mut min_t: HashMap<usize, f64> = HashMap::new();
            for (i, &bi) in live.iter().enumerate() {
                let b = &mut self.bodies[bi];
                let still = b.allow_sleep
                    && b.vx * b.vx + b.vy * b.vy < cfg.linear_sleep * cfg.linear_sleep
                    && b.w * b.w < cfg.angular_sleep * cfg.angular_sleep;
                b.sleep_t = if still { b.sleep_t + dt } else { 0.0 };
                let r = find(&mut par, i);
                let e = min_t.entry(r).or_insert(f64::INFINITY);
                *e = f64::min(*e, self.bodies[bi].sleep_t);
            }
            let mut isl: HashMap<usize, u32> = HashMap::new();
            for (i, &bi) in live.iter().enumerate() {
                let r = find(&mut par, i);
                if min_t[&r] >= cfg.time_to_sleep {
                    let id = *isl.entry(r).or_insert_with(|| {
                        let v = self.next_island;
                        self.next_island += 1;
                        v
                    });
                    let b = &mut self.bodies[bi];
                    b.asleep = true;
                    b.island = Some(id);
                    b.vx = 0.0;
                    b.vy = 0.0;
                    b.w = 0.0;
                }
            }
        }
        // 7. store
        for c in contacts.iter_mut() {
            c.carried = false;
        }
        self.contacts = contacts;
        self.sensors = sensors;
        self.time += dt;
        self.steps += 1;
    }

    /// Fraction of the displacement that is safe against static solids; bounces/stops the velocity on impact.
    fn ccd_fraction(&mut self, bi: usize, mx: f64, my: f64) -> f64 {
        let cfg = &self.config;
        let b = &self.bodies[bi];
        let sh = placed(b);
        let bb = bounds(&sh);
        let min_dim = f64::min(bb.max_x - bb.min_x, bb.max_y - bb.min_y) / 2.0;
        let d = (mx * mx + my * my).sqrt();
        if d <= min_dim * 0.5 {
            return 1.0;
        }
        let mut best: Option<(f64, Vec2, usize)> = None;
        for (oi, o) in self.bodies.iter().enumerate() {
            if o.kind != BodyType::Static
                || o.sensor
                || !can_collide(Some(b.layer), Some(b.mask), Some(o.layer), Some(o.mask))
            {
                continue;
            }
            let po = placed(o);
            let ob = bounds(&po);
            let swept = Bounds {
                min_x: bb.min_x + f64::min(0.0, mx),
                min_y: bb.min_y + f64::min(0.0, my),
                max_x: bb.max_x + f64::max(0.0, mx),
                max_y: bb.max_y + f64::max(0.0, my),
            };
            if !bounds_overlap(&swept, &ob) {
                continue;
            }
            if let Some(h) = shape_cast(&sh, mx, my, &po) {
                if !h.overlap && h.t < best.as_ref().map_or(1.0, |b| b.0) {
                    best = Some((h.t, h.normal, oi));
                }
            }
        }
        let Some((t, normal, oi)) = best else { return 1.0 };
        let (vx, vy, restitution) = (b.vx, b.vy, b.restitution);
        let o_rest = self.bodies[oi].restitution;
        let threshold = cfg.restitution_threshold;
        let vn = vx * normal.x + vy * normal.y;
        if vn < 0.0 {
            let e = f64::max(restitution, o_rest) * if -vn > threshold { 1.0 } else { 0.0 };
            let b = &mut self.bodies[bi];
            b.vx -= (1.0 + e) * vn * normal.x;
            b.vy -= (1.0 + e) * vn * normal.y;
        }
        t * (1.0 - 1e-6)
    }

    // ---- joints ------------------------------------------------------------------------------------------
    fn prestep_joint(&mut self, ji: usize, dt: f64) {
        let cfg = self.config.clone();
        let (ia, ib) = (self.idx(self.joints[ji].a), self.idx(self.joints[ji].b));
        let (ca, sa) = (self.bodies[ia].angle.cos(), self.bodies[ia].angle.sin());
        let (cb, sb) = (self.bodies[ib].angle.cos(), self.bodies[ib].angle.sin());
        let (a, b) = (self.bodies[ia].clone(), self.bodies[ib].clone());
        let j = &mut self.joints[ji];
        j.rax = j.ax * ca - j.ay * sa;
        j.ray = j.ax * sa + j.ay * ca;
        j.rbx = j.bx * cb - j.by * sb;
        j.rby = j.bx * sb + j.by * cb;
        let dx = b.x + j.rbx - a.x - j.rax;
        let dy = b.y + j.rby - a.y - j.ray;
        if j.kind == JointType::Revolute {
            let (i_a, i_b, mm) = (a.inv_i, b.inv_i, a.inv_mass + b.inv_mass);
            let k11 = mm + i_a * j.ray * j.ray + i_b * j.rby * j.rby;
            let k12 = -i_a * j.rax * j.ray - i_b * j.rbx * j.rby;
            let k22 = mm + i_a * j.rax * j.rax + i_b * j.rbx * j.rbx;
            let det = k11 * k22 - k12 * k12;
            let id = if det != 0.0 { 1.0 / det } else { 0.0 };
            j.m11 = k22 * id;
            j.m12 = -k12 * id;
            j.m22 = k11 * id;
            j.bias_x = dx * cfg.baumgarte / dt;
            j.bias_y = dy * cfg.baumgarte / dt;
            let (jx, jy, rax, ray, rbx, rby) = (j.jx, j.jy, j.rax, j.ray, j.rbx, j.rby);
            apply_p(&mut self.bodies[ia], jx, jy, rax, ray, -1.0);
            apply_p(&mut self.bodies[ib], jx, jy, rbx, rby, 1.0);
            return;
        }
        let l = (dx * dx + dy * dy).sqrt();
        j.ux = if l > 0.0 { dx / l } else { 1.0 };
        j.uy = if l > 0.0 { dy / l } else { 0.0 };
        let c = l - j.length;
        let cr_a = cross(j.rax, j.ray, j.ux, j.uy);
        let cr_b = cross(j.rbx, j.rby, j.ux, j.uy);
        let k = a.inv_mass + b.inv_mass + a.inv_i * cr_a * cr_a + b.inv_i * cr_b * cr_b;
        if j.stiffness > 0.0 {
            j.gamma = 1.0 / (dt * (j.damping + dt * j.stiffness));
            j.bias = c * dt * j.stiffness * j.gamma;
        } else {
            j.gamma = 0.0;
            j.bias = c * cfg.baumgarte / dt;
        }
        j.mass = if k + j.gamma > 0.0 { 1.0 / (k + j.gamma) } else { 0.0 };
        let (px, py, rax, ray, rbx, rby) = (j.ux * j.j, j.uy * j.j, j.rax, j.ray, j.rbx, j.rby);
        apply_p(&mut self.bodies[ia], px, py, rax, ray, -1.0);
        apply_p(&mut self.bodies[ib], px, py, rbx, rby, 1.0);
    }

    fn solve_joint(&mut self, ji: usize) {
        let (ia, ib) = (self.idx(self.joints[ji].a), self.idx(self.joints[ji].b));
        let (a, b) = (&self.bodies[ia], &self.bodies[ib]);
        let j = &mut self.joints[ji];
        let cx = (b.vx - b.w * j.rby) - (a.vx - a.w * j.ray);
        let cy = (b.vy + b.w * j.rbx) - (a.vy + a.w * j.rax);
        if j.kind == JointType::Revolute {
            let rx = -(cx + j.bias_x);
            let ry = -(cy + j.bias_y);
            let ix = j.m11 * rx + j.m12 * ry;
            let iy = j.m12 * rx + j.m22 * ry;
            j.jx += ix;
            j.jy += iy;
            let (rax, ray, rbx, rby) = (j.rax, j.ray, j.rbx, j.rby);
            apply_p(&mut self.bodies[ia], ix, iy, rax, ray, -1.0);
            apply_p(&mut self.bodies[ib], ix, iy, rbx, rby, 1.0);
            return;
        }
        let imp = -j.mass * (cx * j.ux + cy * j.uy + j.bias + j.gamma * j.j);
        j.j += imp;
        let (px, py, rax, ray, rbx, rby) = (j.ux * imp, j.uy * imp, j.rax, j.ray, j.rbx, j.rby);
        apply_p(&mut self.bodies[ia], px, py, rax, ray, -1.0);
        apply_p(&mut self.bodies[ib], px, py, rbx, rby, 1.0);
    }

    // ---- queries -----------------------------------------------------------------------------------------
    /// Kinetic + gravitational potential energy of all dynamic bodies.
    pub fn energy(&self) -> f64 {
        let g = self.config.gravity;
        let mut e = 0.0;
        for b in &self.bodies {
            if b.kind == BodyType::Dynamic && b.inv_mass > 0.0 {
                let m = 1.0 / b.inv_mass;
                e += 0.5 * m * (b.vx * b.vx + b.vy * b.vy)
                    + (if b.inv_i > 0.0 { 0.5 * (1.0 / b.inv_i) * b.w * b.w } else { 0.0 })
                    - m * (g.x * b.x + g.y * b.y) * b.gravity_scale;
            }
        }
        e
    }

    /// Nearest ray hit among non-sensor bodies (or sensors with `include_sensors`): `(body id, hit)`, ties lowest id.
    pub fn raycast(
        &self,
        ox: f64,
        oy: f64,
        dx: f64,
        dy: f64,
        max_t: f64,
        include_sensors: bool,
        layer: Option<i32>,
        mask: Option<i32>,
    ) -> Option<(u32, RayHit)> {
        let mut best: Option<(u32, RayHit)> = None;
        for b in &self.bodies {
            if (b.sensor && !include_sensors) || !can_collide(Some(b.layer), Some(b.mask), layer, mask) {
                continue;
            }
            if let Some(h) = raycast(&placed(b), ox, oy, dx, dy, max_t) {
                if best.as_ref().map_or(true, |bb| h.t < bb.1.t) {
                    best = Some((b.id, h));
                }
            }
        }
        best
    }
    pub fn query_aabb(&self, bb: &Bounds) -> Vec<u32> {
        self.bodies.iter().filter(|b| bounds_overlap(&bounds(&placed(b)), bb)).map(|b| b.id).collect()
    }
    pub fn query_point(&self, x: f64, y: f64) -> Vec<u32> {
        self.bodies.iter().filter(|b| contains_point(&placed(b), x, y)).map(|b| b.id).collect()
    }
    /// Deep copy of the whole state; `restore` rewinds exactly.
    pub fn snapshot(&self) -> World {
        self.clone()
    }
    pub fn restore(&mut self, snap: &World) {
        *self = snap.clone();
        self.events.clear();
    }
}

// ---- kinematic character controller ----------------------------------------------------------------------
#[derive(Clone, Debug)]
pub struct CharConfig {
    pub gravity: f64,
    pub jump_v: f64,
    pub run_speed: f64,
    pub air_speed: f64,
    pub air_accel: f64,
    pub hit_w: f64,
    pub hit_h: f64,
    pub step_height: f64,
    pub snap_dist: f64,
    pub max_fall: f64,
    pub drop_time: f64,
}

impl Default for CharConfig {
    fn default() -> Self {
        CharConfig {
            gravity: 520.0,
            jump_v: 200.0,
            run_speed: 60.0,
            air_speed: 60.0,
            air_accel: 160.0,
            hit_w: 8.0,
            hit_h: 16.0,
            step_height: 4.0,
            snap_dist: 4.0,
            max_fall: 1000.0,
            drop_time: 0.25,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CharMode {
    Ground,
    Air,
}

impl CharMode {
    pub fn name(self) -> &'static str {
        match self {
            CharMode::Ground => "ground",
            CharMode::Air => "air",
        }
    }
}

/// Feet-anchored character state.
#[derive(Clone, Debug)]
pub struct Character {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub face: i32,
    pub mode: CharMode,
    pub layer: i32,
    pub on_platform: Option<Collider>,
    pub landed: bool,
    pub t: f64,
    pub drop_t: f64,
    pub ground: Option<Collider>,
}

impl Character {
    pub fn new(x: f64, y: f64) -> Character {
        Character {
            x,
            y,
            vx: 0.0,
            vy: 0.0,
            face: 1,
            mode: CharMode::Ground,
            layer: 0,
            on_platform: None,
            landed: true,
            t: 0.0,
            drop_t: 0.0,
            ground: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct CharInput {
    pub dx: i32,
    pub dy: i32,
    pub jump_pressed: bool,
}

fn open_ov(a0: f64, a1: f64, b0: f64, b1: f64) -> bool {
    a0 < b1 && b0 < a1
}

/// Highest floor `s` with `y-eps <= s <= y+max_drop` under the box: `(s, index into cs)`.
fn find_support(cs: &[Collider], b: &Character, hw: f64, max_drop: f64) -> Option<(f64, usize)> {
    let mut best = f64::INFINITY;
    let mut bc = None;
    for (i, c) in cs.iter().enumerate() {
        if c.kind == Kind::Oneway && b.drop_t > 0.0 {
            continue;
        }
        let s;
        if c.kind == Kind::Slope {
            if b.x < c.min_x || b.x > c.max_x {
                continue;
            }
            s = surface_y(c, b.x);
        } else {
            if !open_ov(b.x - hw, b.x + hw, c.min_x, c.max_x) {
                continue;
            }
            s = c.min_y;
        }
        if s >= b.y - 1e-6 && s <= b.y + max_drop + 1e-9 && s < best {
            best = s;
            bc = Some(i);
        }
    }
    bc.map(|i| (best, i))
}

fn char_query(world: &dyn Source, b: &Character, hw: f64, hh: f64, m: f64) -> Vec<Collider> {
    world.query(&Bounds { min_x: b.x - hw - m, max_x: b.x + hw + m, min_y: b.y - hh - m, max_y: b.y + m })
}

fn move_character(b: &mut Character, dx: f64, dy: f64, world: &dyn Source, cfg: &CharConfig, was_ground: bool) {
    let hw = cfg.hit_w / 2.0;
    let hh = cfg.hit_h;
    let mut landed = false;
    let mut ground: Option<Collider> = None;
    let nx = f64::min(256.0, f64::max(1.0, (dx.abs() / hw).ceil())) as i32;
    let sx = dx / nx as f64;
    let mut i = 0;
    while i < nx && dx != 0.0 {
        b.x += sx;
        let cs = char_query(world, b, hw, hh, sx.abs() + cfg.step_height);
        for c in &cs {
            if c.kind != Kind::Solid
                || !open_ov(b.x - hw, b.x + hw, c.min_x, c.max_x)
                || !open_ov(b.y - hh, b.y, c.min_y, c.max_y)
            {
                continue;
            }
            let rise = b.y - c.min_y;
            if (was_ground || landed)
                && rise > 0.0
                && rise <= cfg.step_height
                && !cs.iter().any(|o| {
                    o.kind == Kind::Solid
                        && open_ov(b.x - hw, b.x + hw, o.min_x, o.max_x)
                        && open_ov(b.y - rise - hh, b.y - rise, o.min_y, o.max_y)
                })
            {
                b.y -= rise;
            } else {
                b.x = if sx > 0.0 { c.min_x - hw } else { c.max_x + hw };
                b.vx = 0.0;
            }
        }
        for c in &cs {
            if c.kind != Kind::Slope || b.x < c.min_x || b.x > c.max_x {
                continue;
            }
            let s = surface_y(c, b.x);
            if !(b.y > s && b.y - hh < c.max_y) {
                continue;
            }
            let sl = c.slope.unwrap();
            let grad = (sl.y1 - sl.y0).abs() / (sl.x1 - sl.x0);
            if b.y - s <= sx.abs() * grad + 1e-4 {
                b.y = s;
                landed = true;
                ground = Some(c.clone());
            } else {
                b.x = if sx > 0.0 { c.min_x - hw } else { c.max_x + hw };
                b.vx = 0.0;
            }
        }
        i += 1;
    }
    // vertical: swept ceilings and floors
    let prev_y = b.y;
    let cs = char_query(world, b, hw, hh, dy.abs() + cfg.snap_dist + 1.0);
    if dy < 0.0 {
        let mut cl = f64::NEG_INFINITY;
        for c in &cs {
            if c.kind == Kind::Oneway {
                continue;
            }
            let inx = if c.kind == Kind::Slope {
                b.x >= c.min_x && b.x <= c.max_x
            } else {
                open_ov(b.x - hw, b.x + hw, c.min_x, c.max_x)
            };
            if inx && prev_y - hh >= c.max_y - 1e-6 && prev_y + dy - hh < c.max_y && c.max_y > cl {
                cl = c.max_y;
            }
        }
        if cl > f64::NEG_INFINITY {
            b.y = cl + hh;
            b.vy = 0.0;
        } else {
            b.y = prev_y + dy;
        }
        landed = false;
        ground = None;
    } else if let Some((s, ci)) = find_support(&cs, b, hw, dy) {
        b.y = s;
        landed = true;
        ground = Some(cs[ci].clone());
    } else {
        b.y = prev_y + dy;
    }
    if !landed && was_ground && b.vy >= 0.0 {
        let q = char_query(world, b, hw, hh, cfg.snap_dist + 1.0);
        if let Some((s, ci)) = find_support(&q, b, hw, cfg.snap_dist) {
            b.y = s;
            landed = true;
            ground = Some(q[ci].clone());
        }
    }
    b.landed = landed;
    b.on_platform = match &ground {
        Some(g) if g.kind == Kind::Oneway => Some(g.clone()),
        _ => None,
    };
    b.ground = ground;
    if landed {
        b.vy = 0.0;
        b.mode = CharMode::Ground;
    } else {
        b.mode = CharMode::Air;
    }
}

/// Advance one character one fixed tick (`input.dy` up is negative). `emit` receives `"jump"`, `"hardland"` and `"land"`.
pub fn step_character(
    b: &mut Character,
    input: CharInput,
    dt: f64,
    world: &dyn Source,
    cfg: &CharConfig,
    emit: &mut dyn FnMut(&str, &Character),
) {
    b.t += dt;
    if b.drop_t > 0.0 {
        b.drop_t -= dt;
    }
    let (dx, dy) = (input.dx, input.dy);
    let mut was_ground = b.mode == CharMode::Ground;
    if dx != 0 {
        b.face = dx;
    }
    if was_ground {
        if input.jump_pressed && dy > 0 && b.ground.as_ref().map_or(false, |g| g.kind == Kind::Oneway) {
            b.drop_t = cfg.drop_time;
            b.vy = 0.0;
            b.vx = dx as f64 * cfg.run_speed;
            was_ground = false;
        } else if input.jump_pressed {
            b.vy = -cfg.jump_v;
            b.vx = dx as f64 * cfg.air_speed;
            b.mode = CharMode::Air;
            b.landed = false;
            b.ground = None;
            b.on_platform = None;
            emit("jump", b);
            return;
        } else {
            b.vx = dx as f64 * cfg.run_speed;
            b.vy = 0.0;
        }
    }
    if !was_ground {
        if dx != 0 {
            let target = dx as f64 * cfg.air_speed;
            let a = cfg.air_accel * dt;
            b.vx = if b.vx < target { f64::min(target, b.vx + a) } else { f64::max(target, b.vx - a) };
        }
        b.vy = f64::min(cfg.max_fall, b.vy + cfg.gravity * dt);
    }
    let impact = b.vy;
    let was = b.mode;
    let (mvx, mvy) = (b.vx * dt, b.vy * dt);
    move_character(b, mvx, mvy, world, cfg, was_ground);
    if b.mode == CharMode::Ground && (was == CharMode::Air || !was_ground) {
        if impact > 140.0 {
            emit("hardland", b);
        }
        emit("land", b);
    }
}

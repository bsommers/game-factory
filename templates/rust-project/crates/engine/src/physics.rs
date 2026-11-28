//! Fixed-step platformer physics (port of `platformer-physics.js`, see `spec/platformer-physics.md`).
//!
//! Coordinates: x right, y DOWN; a body's `(x, y)` is its feet centre. The world refers to things by index, so
//! `Body::rope`, `Body::ladder` and `Body::on_platform` are indices into `World::{ropes, ladders, platforms}`.
//! Events are pushed to a caller-supplied `Vec<Event>` (the JS `cfg.emit` sink).

use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Ground,
    Air,
    Climb,
    Swing,
    Dead,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub gravity: f64,
    pub jump_v: f64,
    pub run_speed: f64,
    pub air_speed: f64,
    pub air_accel: f64,
    pub climb_speed: f64,
    pub hit_w: f64,
    pub hit_h: f64,
    pub grab_r: f64,
    pub grab_cooldown: f64,
    pub swing_blend: f64,
    pub edge_l: f64,
    pub edge_r: f64,
    /// Screens skipped per edge crossing (JS also allows a function; use a number here).
    pub stride: i64,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            gravity: 520.0,
            jump_v: 200.0,
            run_speed: 60.0,
            air_speed: 60.0,
            air_accel: 160.0,
            climb_speed: 40.0,
            hit_w: 8.0,
            hit_h: 16.0,
            grab_r: 8.0,
            grab_cooldown: 0.35,
            swing_blend: 0.12,
            edge_l: 4.0,
            edge_r: 316.0,
            stride: 1,
        }
    }
}

/// Max horizontal distance a run-jump covers on flat ground.
pub fn jump_range(cfg: &Config) -> f64 {
    cfg.run_speed * 2.0 * cfg.jump_v / cfg.gravity
}

/// Apex height of a jump.
pub fn jump_height(cfg: &Config) -> f64 {
    cfg.jump_v * cfg.jump_v / (2.0 * cfg.gravity)
}

#[derive(Clone, Debug)]
pub struct Body {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub face: i32,
    pub mode: Mode,
    pub layer: i32,
    pub on_platform: Option<usize>,
    pub landed: bool,
    pub grab_cd: f64,
    pub swing_k: f64,
    pub off_x: f64,
    pub off_y: f64,
    pub rope: Option<usize>,
    pub ladder: Option<usize>,
    pub t: f64,
    pub death_kind: Option<String>,
}

impl Body {
    pub fn new(x: f64, y: f64) -> Self {
        Body {
            x,
            y,
            vx: 0.0,
            vy: 0.0,
            face: 1,
            mode: Mode::Ground,
            layer: 0,
            on_platform: None,
            landed: true,
            grab_cd: 0.0,
            swing_k: 0.0,
            off_x: 0.0,
            off_y: 0.0,
            rope: None,
            ladder: None,
            t: 0.0,
            death_kind: None,
        }
    }
}

/// Pendulum rope / vine: `angle = amp * sin(2 pi t / period)`; the tip hangs `len` below `(px, py)`.
#[derive(Clone, Debug)]
pub struct Pendulum {
    pub px: f64,
    pub py: f64,
    pub len: f64,
    pub amp: f64,
    pub period: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tip {
    pub x: f64,
    pub y: f64,
    pub a: f64,
}

impl Pendulum {
    fn w(&self) -> f64 {
        (2.0 * PI) / self.period
    }

    pub fn angle(&self, t: f64) -> f64 {
        self.amp * (self.w() * t).sin()
    }

    pub fn tip(&self, t: f64) -> Tip {
        let a = self.angle(t);
        Tip { x: self.px + a.sin() * self.len, y: self.py + a.cos() * self.len, a }
    }

    /// Tip velocity `(x, y)`.
    pub fn tip_vel(&self, t: f64) -> (f64, f64) {
        let w = self.w();
        let a = self.angle(t);
        let om = self.amp * w * (w * t).cos();
        (self.len * om * a.cos(), -self.len * om * a.sin())
    }
}

/// Ping-pong platform on the segment `(x0,y0)-(x1,y1)`. Call [`MovingPlatform::update`] each tick.
#[derive(Clone, Debug)]
pub struct MovingPlatform {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
    pub w: f64,
    pub speed: f64,
    pub x: f64,
    pub y: f64,
    pub dx: f64,
    pub dy: f64,
    pub t: f64,
    span: f64,
}

impl MovingPlatform {
    /// JS defaults: `x1 = x0`, `y1 = y0`, `w = 24`, `speed = 20`, `phase = 0`.
    pub fn new(x0: f64, y0: f64, x1: f64, y1: f64, w: f64, speed: f64, phase: f64) -> Self {
        let h = (x1 - x0).hypot(y1 - y0);
        let mut p = MovingPlatform {
            x0,
            y0,
            x1,
            y1,
            w,
            speed,
            x: x0,
            y: y0,
            dx: 0.0,
            dy: 0.0,
            t: phase,
            span: if h == 0.0 { 1.0 } else { h },
        };
        p.place();
        p
    }

    fn place(&mut self) {
        let d = (self.t * self.speed) % (2.0 * self.span);
        let u = (if d <= self.span { d } else { 2.0 * self.span - d }) / self.span;
        self.x = self.x0 + (self.x1 - self.x0) * u;
        self.y = self.y0 + (self.y1 - self.y0) * u;
    }

    pub fn update(&mut self, dt: f64) {
        let (ox, oy) = (self.x, self.y);
        self.t += dt;
        self.place();
        self.dx = self.x - ox;
        self.dy = self.y - oy;
    }

    /// Copy the current position and per-tick delta into a world platform.
    pub fn write_to(&self, p: &mut Platform) {
        p.x = self.x;
        p.y = self.y;
        p.w = self.w;
        p.dx = self.dx;
        p.dy = self.dy;
    }
}

/// One-way platform (land from above only). `dx/dy` carry a standing body (set by [`MovingPlatform::write_to`]).
#[derive(Clone, Debug, Default)]
pub struct Platform {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub dx: f64,
    pub dy: f64,
}

impl Platform {
    pub fn new(x: f64, y: f64, w: f64) -> Self {
        Platform { x, y, w, dx: 0.0, dy: 0.0 }
    }
}

/// A hole in the ground between `x0` and `x1`. `drop`: safe hole (no death). Otherwise deadly, `kind` is the death kind.
#[derive(Clone, Debug)]
pub struct Pit {
    pub x0: f64,
    pub x1: f64,
    pub kind: Option<String>,
    pub drop: bool,
}

impl Pit {
    pub fn new(x0: f64, x1: f64) -> Self {
        Pit { x0, x1, kind: None, drop: false }
    }
}

#[derive(Clone, Debug)]
pub struct Ladder {
    pub x: f64,
    pub top: f64,
    pub bottom: f64,
    /// Grab width (JS default 8).
    pub w: f64,
}

impl Ladder {
    pub fn new(x: f64, top: f64, bottom: f64) -> Self {
        Ladder { x, top, bottom, w: 8.0 }
    }
}

#[derive(Clone, Debug, Default)]
pub struct World {
    pub ground_y: f64,
    pub pits: Vec<Pit>,
    pub platforms: Vec<Platform>,
    pub ladders: Vec<Ladder>,
    pub ropes: Vec<Pendulum>,
    /// `bounds.minY`: ceiling for the top of the hitbox.
    pub min_y: Option<f64>,
    /// Shared clock driving ropes; falls back to `Body::t` when `None`.
    pub t: Option<f64>,
}

/// What an [`Event`] refers to.
#[derive(Clone, Debug, PartialEq)]
pub enum Extra {
    None,
    Platform(usize),
    Pit(usize),
    Ladder(usize),
    Tip { x: f64, y: f64, a: f64 },
    Text(&'static str),
}

/// Events: `jump`, `land`, `hardland`, `death`, `drop`, `climb`, `climbEnd`, `grab`, `release`.
#[derive(Clone, Debug, PartialEq)]
pub struct Event {
    pub name: &'static str,
    pub extra: Extra,
}

fn emit(ev: &mut Vec<Event>, name: &'static str, extra: Extra) {
    ev.push(Event { name, extra });
}

/// Per-tick input: `dx`/`dy` in -1..=1 (up is negative `dy`).
#[derive(Clone, Copy, Debug, Default)]
pub struct Input {
    pub dx: i32,
    pub dy: i32,
    pub jump_pressed: bool,
}

// ---- support queries ---------------------------------------------------------------------------

pub fn pit_at(world: &World, x: f64) -> Option<usize> {
    world.pits.iter().position(|q| x > q.x0 && x < q.x1)
}

pub fn ladder_at(world: &World, x: f64, feet_y: f64) -> Option<usize> {
    world.ladders.iter().position(|l| (x - l.x).abs() <= l.w / 2.0 && feet_y >= l.top - 1.0 && feet_y <= l.bottom + 1.0)
}

fn platform_under(world: &World, x: f64, y: f64, prev_y: f64) -> Option<usize> {
    world.platforms.iter().position(|p| (x - p.x).abs() <= p.w / 2.0 && prev_y <= p.y + 1.0 && y >= p.y)
}

fn platform_carrying(world: &World, x: f64, y: f64) -> Option<usize> {
    world.platforms.iter().position(|p| (x - p.x).abs() <= p.w / 2.0 && (y - p.y).abs() <= 3.0)
}

/// Walkable support under a standing body (`platform` is `Some` when standing on one).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Support {
    pub y: f64,
    pub platform: Option<usize>,
}

pub fn support_at(world: &World, x: f64, y: f64) -> Option<Support> {
    if let Some(i) = platform_carrying(world, x, y) {
        return Some(Support { y: world.platforms[i].y, platform: Some(i) });
    }
    if pit_at(world, x).is_some() {
        return None;
    }
    Some(Support { y: world.ground_y, platform: None })
}

// ---- stepping ----------------------------------------------------------------------------------

fn enter_pit(b: &mut Body, qi: usize, world: &World, ev: &mut Vec<Event>) {
    let q = &world.pits[qi];
    if q.drop {
        b.vx = 0.0;
        b.vy = 0.0;
        b.y = world.ground_y;
        b.landed = true;
        emit(ev, "drop", Extra::Pit(qi));
        return;
    }
    b.mode = Mode::Dead;
    b.death_kind = Some(q.kind.clone().unwrap_or_else(|| "pit".to_string()));
    b.vx = 0.0;
    b.vy = 0.0;
    b.y = world.ground_y;
    emit(ev, "death", Extra::Pit(qi));
}

fn ballistic(b: &mut Body, dt: f64, dx: i32, world: &World, cfg: &Config, ev: &mut Vec<Event>) {
    let prev_y = b.y;
    if dx != 0 {
        let target = f64::from(dx) * cfg.air_speed;
        let a = cfg.air_accel * dt;
        b.vx = if b.vx < target { target.min(b.vx + a) } else { target.max(b.vx - a) };
    }
    b.vy += cfg.gravity * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.landed = false;
    b.on_platform = None;
    if let Some(min_y) = world.min_y {
        if b.y - cfg.hit_h < min_y {
            b.y = min_y + cfg.hit_h;
            if b.vy < 0.0 {
                b.vy = 0.0;
            }
        }
    }
    if b.vy >= 0.0 {
        if let Some(pi) = platform_under(world, b.x, b.y, prev_y) {
            b.y = world.platforms[pi].y;
            b.vy = 0.0;
            b.vx *= 0.5;
            b.landed = true;
            b.on_platform = Some(pi);
            emit(ev, "land", Extra::Platform(pi));
            return;
        }
    }
    if b.vy >= 0.0 && b.y >= world.ground_y {
        if let Some(qi) = pit_at(world, b.x) {
            enter_pit(b, qi, world, ev);
            return;
        }
        if b.vy > 140.0 {
            emit(ev, "hardland", Extra::None);
        }
        b.y = world.ground_y;
        b.vy = 0.0;
        b.landed = true;
        emit(ev, "land", Extra::None);
    }
}

fn try_grab(b: &mut Body, world: &World, t: f64, cfg: &Config, ev: &mut Vec<Event>) -> bool {
    if b.grab_cd > 0.0 {
        return false;
    }
    let (hx, hy) = (b.x, b.y - cfg.hit_h);
    for (ri, r) in world.ropes.iter().enumerate() {
        let tip = r.tip(t);
        if (tip.x - hx).hypot(tip.y - hy) <= cfg.grab_r {
            b.mode = Mode::Swing;
            b.rope = Some(ri);
            b.swing_k = 1.0;
            b.off_x = hx - tip.x;
            b.off_y = hy - tip.y;
            b.vx = 0.0;
            b.vy = 0.0;
            emit(ev, "grab", Extra::Tip { x: tip.x, y: tip.y, a: tip.a });
            return true;
        }
    }
    false
}

fn step_ground(b: &mut Body, input: Input, dt: f64, world: &World, cfg: &Config, ev: &mut Vec<Event>) {
    let (dx, dy) = (input.dx, input.dy);
    if let Some(li) = ladder_at(world, b.x, b.y) {
        let l = &world.ladders[li];
        if (dy < 0 && b.y > l.top + 1.0) || (dy > 0 && b.y < l.bottom - 1.0) {
            b.mode = Mode::Climb;
            b.x = l.x;
            b.vx = 0.0;
            b.vy = 0.0;
            b.ladder = Some(li);
            emit(ev, "climb", Extra::Ladder(li));
            return;
        }
    }
    if input.jump_pressed {
        b.vy = -cfg.jump_v;
        b.vx = f64::from(dx) * cfg.air_speed;
        if dx != 0 {
            b.face = dx;
        }
        b.mode = Mode::Air;
        b.on_platform = None;
        b.landed = false;
        emit(ev, "jump", Extra::None);
        return;
    }
    b.vx = f64::from(dx) * cfg.run_speed;
    if dx != 0 {
        b.face = dx;
    }
    let prev_x = b.x;
    b.x += b.vx * dt;
    if let Some(ci) = platform_carrying(world, prev_x, b.y) {
        b.x += world.platforms[ci].dx;
        b.y += world.platforms[ci].dy;
    }
    match support_at(world, b.x, b.y) {
        None => {
            b.mode = Mode::Air;
            b.vy = 0.0;
            b.on_platform = None;
        }
        Some(s) => {
            b.y = s.y;
            b.on_platform = s.platform;
        }
    }
}

fn step_air(b: &mut Body, input: Input, dt: f64, world: &World, cfg: &Config, ev: &mut Vec<Event>) {
    let dx = input.dx;
    if dx != 0 {
        b.face = dx;
    }
    ballistic(b, dt, dx, world, cfg, ev);
    if b.mode != Mode::Air {
        return;
    }
    if b.landed {
        b.mode = Mode::Ground;
        return;
    }
    try_grab(b, world, world.t.unwrap_or(b.t), cfg, ev);
}

fn step_swing(b: &mut Body, input: Input, dt: f64, world: &World, cfg: &Config, ev: &mut Vec<Event>) {
    let Some(ri) = b.rope else {
        b.mode = Mode::Air;
        return;
    };
    let t = world.t.unwrap_or(b.t);
    let r = &world.ropes[ri];
    let tip = r.tip(t);
    let tv = r.tip_vel(t);
    b.swing_k = (b.swing_k - dt / cfg.swing_blend).max(0.0);
    b.x = tip.x + b.off_x * b.swing_k;
    b.y = tip.y + cfg.hit_h + b.off_y * b.swing_k;
    if tv.0.abs() > 12.0 {
        b.face = if tv.0 > 0.0 { 1 } else { -1 };
    }
    b.vx = tv.0;
    b.vy = tv.1;
    if input.jump_pressed {
        b.mode = Mode::Air;
        b.rope = None;
        b.grab_cd = cfg.grab_cooldown;
        b.landed = false;
        emit(ev, "release", Extra::None);
        return;
    }
    if b.y >= world.ground_y - 2.0 && pit_at(world, b.x).is_none() {
        b.mode = Mode::Ground;
        b.rope = None;
        b.y = world.ground_y;
        b.vx = 0.0;
        b.vy = 0.0;
        b.grab_cd = cfg.grab_cooldown;
        emit(ev, "land", Extra::None);
    }
}

fn step_climb(b: &mut Body, input: Input, dt: f64, world: &World, cfg: &Config, ev: &mut Vec<Event>) {
    let Some(li) = b.ladder else {
        b.mode = Mode::Air;
        return;
    };
    let l = &world.ladders[li];
    if input.dy != 0 {
        b.y += f64::from(input.dy) * cfg.climb_speed * dt;
    }
    if b.y <= l.top {
        b.y = l.top;
        b.mode = Mode::Ground;
        b.ladder = None;
        emit(ev, "climbEnd", Extra::Text("top"));
    } else if b.y >= l.bottom {
        b.y = l.bottom;
        b.mode = Mode::Ground;
        b.ladder = None;
        emit(ev, "climbEnd", Extra::Text("bottom"));
    }
}

/// Advance one body one fixed tick. `world.t` (seconds) drives ropes and falls back to `body.t`.
pub fn step_body(b: &mut Body, input: Input, dt: f64, world: &World, cfg: &Config, ev: &mut Vec<Event>) {
    b.t += dt;
    if b.grab_cd > 0.0 {
        b.grab_cd -= dt;
    }
    match b.mode {
        Mode::Ground => step_ground(b, input, dt, world, cfg, ev),
        Mode::Air => step_air(b, input, dt, world, cfg, ev),
        Mode::Swing => step_swing(b, input, dt, world, cfg, ev),
        Mode::Climb => step_climb(b, input, dt, world, cfg, ev),
        Mode::Dead => {}
    }
}

// ---- screen-edge transitions -------------------------------------------------------------------

/// Floor-mod wrap of an integer index into `0..n`.
pub fn wrap_index(i: i64, n: i64) -> i64 {
    ((i % n) + n) % n
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EdgeTransition {
    pub dir: i32,
    pub idx: i64,
    pub x: f64,
}

/// If the body left a screen edge, the transition in a circular world of `count` screens. Does not mutate the body.
pub fn edge_transition(b: &Body, idx: i64, count: i64, cfg: &Config) -> Option<EdgeTransition> {
    if b.mode != Mode::Ground && b.mode != Mode::Air {
        return None;
    }
    let dir = if b.x < cfg.edge_l {
        -1
    } else if b.x > cfg.edge_r {
        1
    } else {
        0
    };
    if dir == 0 {
        return None;
    }
    let x = if dir > 0 { cfg.edge_l + 1.0 } else { cfg.edge_r - 1.0 };
    Some(EdgeTransition { dir, idx: wrap_index(idx + i64::from(dir) * cfg.stride, count), x })
}

/// Apply an [`edge_transition`] result to the body.
pub fn apply_transition(b: &mut Body, tr: Option<EdgeTransition>) {
    if let Some(t) = tr {
        b.x = t.x;
    }
}

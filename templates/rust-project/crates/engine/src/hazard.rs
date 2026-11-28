//! Behaviour registry, contact resolution and ready-made hazard patterns (port of `hazard-kit.js`,
//! see `spec/hazard-kit.md`).
//!
//! An [`Entity`] is a feet-anchored box. A [`Behaviour`] has `init`/`update`/`on_touch`; the game facade `g` of the JS
//! version is [`Ctx`]: spawn requests are queued in `ctx.spawns` and applied by [`Registry::update`] right after the
//! requesting entity's update, so entities spawned during a pass are visited in the same pass (same as JS).
//! Randomness is only the optional `ctx.rng` (a spec [`Pcg32`]) used by [`TauntingBoss`].

use crate::rng::Pcg32;
use std::collections::HashMap;
use std::f64::consts::PI;
use std::rc::Rc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lethal {
    /// Kills the player.
    Life,
    /// Score penalty, no death.
    Points,
}

/// Per-entity scratch state (`e.st` in JS). Known keys are typed; anything else goes to `extra`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct St {
    pub min_x: Option<f64>,
    pub max_x: Option<f64>,
    pub phase: Option<f64>,
    pub period: Option<f64>,
    pub open_frac: Option<f64>,
    pub timer: Option<f64>,
    pub said: Option<i64>,
    pub last: Option<String>,
    pub dist: Option<f64>,
    pub base_y: Option<f64>,
    pub hit_t: Option<f64>,
    pub extra: Vec<(String, f64)>,
}

impl St {
    /// Overlay `o` on `self` (set fields win).
    pub fn merge(&mut self, o: &St) {
        macro_rules! m {
            ($($f:ident),*) => { $( if o.$f.is_some() { self.$f = o.$f.clone(); } )* };
        }
        m!(min_x, max_x, phase, period, open_frac, timer, said, last, dist, base_y, hit_t);
        for (k, v) in &o.extra {
            match self.extra.iter_mut().find(|(ek, _)| ek == k) {
                Some(slot) => slot.1 = *v,
                None => self.extra.push((k.clone(), *v)),
            }
        }
    }
}

/// Initial values for a spawned entity: kind defaults, then spawn props (later wins). `None` means "leave as is".
#[derive(Clone, Debug, Default)]
pub struct Props {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub vx: Option<f64>,
    pub t: Option<f64>,
    /// `Some(None)` sets `lethal = null`.
    pub lethal: Option<Option<Lethal>>,
    pub solid_top: Option<bool>,
    pub dead: Option<bool>,
    pub layer: Option<String>,
    pub dir: Option<f64>,
    pub speed: Option<f64>,
    pub points: Option<f64>,
    pub collect: Option<bool>,
    pub top_y: Option<f64>,
    pub st: St,
}

impl Props {
    pub fn at(x: f64, y: f64) -> Self {
        Props { x: Some(x), y: Some(y), ..Props::default() }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Entity {
    pub id: u32,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub vx: f64,
    pub t: f64,
    pub frame: i64,
    pub lethal: Option<Lethal>,
    pub solid_top: bool,
    pub dead: bool,
    /// Layer name; an empty string means "any layer".
    pub layer: String,
    pub dir: Option<f64>,
    pub speed: Option<f64>,
    pub open: Option<bool>,
    pub points: Option<f64>,
    pub collect: Option<bool>,
    pub top_y: Option<f64>,
    pub st: St,
}

impl Entity {
    /// A bare entity with the JS base defaults (8x8, layer "surface"). Normally made via [`Registry::spawn`].
    pub fn new(id: u32, kind: &str) -> Self {
        Entity {
            id,
            kind: kind.to_string(),
            x: 0.0,
            y: 0.0,
            w: 8.0,
            h: 8.0,
            vx: 0.0,
            t: 0.0,
            frame: 0,
            lethal: None,
            solid_top: false,
            dead: false,
            layer: "surface".to_string(),
            dir: None,
            speed: None,
            open: None,
            points: None,
            collect: None,
            top_y: None,
            st: St::default(),
        }
    }

    fn apply(&mut self, p: &Props) {
        macro_rules! set {
            ($($f:ident),*) => { $( if let Some(v) = p.$f { self.$f = v; } )* };
        }
        set!(x, y, w, h, vx, t, lethal, solid_top, dead);
        if let Some(l) = &p.layer {
            self.layer = l.clone();
        }
        if p.dir.is_some() {
            self.dir = p.dir;
        }
        if p.speed.is_some() {
            self.speed = p.speed;
        }
        if p.points.is_some() {
            self.points = p.points;
        }
        if p.collect.is_some() {
            self.collect = p.collect;
        }
        if p.top_y.is_some() {
            self.top_y = p.top_y;
        }
        self.st.merge(&p.st);
    }
}

/// Events a behaviour can emit (`g.emit` in JS).
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    Taunt { text: String, dur: f64, ent: u32 },
    Sfx { name: String },
}

/// The game facade passed to behaviours.
#[derive(Default)]
pub struct Ctx {
    /// Queued `g.spawn(kind, props)` requests; [`Registry::update`] drains them.
    pub spawns: Vec<(String, Props)>,
    pub events: Vec<Event>,
    /// Optional spec RNG (taunting boss uses `pick`; without it lines cycle in order).
    pub rng: Option<Pcg32>,
    /// `g.time` for contact cooldowns.
    pub time: Option<f64>,
}

/// Player box for contact checks: feet-anchored `(x, y)`; `layer` of `None` matches every layer.
#[derive(Clone, Debug, Default)]
pub struct Player {
    pub x: f64,
    pub y: f64,
    pub layer: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ContactType {
    Kill,
    Points(f64),
    Collect,
}

/// A contact result: which entity (by id and slice index) and what happened.
#[derive(Clone, Debug, PartialEq)]
pub struct Contact {
    pub ent: u32,
    pub index: usize,
    pub kind: ContactType,
    /// Entity kind name (set for [`ContactType::Kill`]).
    pub ent_kind: Option<String>,
}

pub trait Behaviour {
    fn init(&self, _e: &mut Entity, _g: &mut Ctx) {}
    fn update(&self, _e: &mut Entity, _dt: f64, _g: &mut Ctx) {}
    /// Custom contact override (JS `onTouch`). Return `Some(kind)` to replace the default result.
    fn on_touch(&self, _e: &Entity, _player: &Player, _g: &Ctx) -> Option<ContactType> {
        None
    }
}

impl Behaviour for Box<dyn Behaviour> {
    fn init(&self, e: &mut Entity, g: &mut Ctx) {
        (**self).init(e, g)
    }
    fn update(&self, e: &mut Entity, dt: f64, g: &mut Ctx) {
        (**self).update(e, dt, g)
    }
    fn on_touch(&self, e: &Entity, player: &Player, g: &Ctx) -> Option<ContactType> {
        (**self).on_touch(e, player, g)
    }
}

struct Def {
    behaviour: Rc<dyn Behaviour>,
    defaults: Props,
}

#[derive(Default)]
pub struct Registry {
    defs: HashMap<String, Def>,
    next_id: u32,
}

impl Registry {
    pub fn new() -> Self {
        Registry { defs: HashMap::new(), next_id: 1 }
    }

    pub fn register(&mut self, kind: &str, behaviour: impl Behaviour + 'static, defaults: Props) -> &mut Self {
        self.defs.insert(kind.to_string(), Def { behaviour: Rc::new(behaviour), defaults });
        self
    }

    pub fn has(&self, kind: &str) -> bool {
        self.defs.contains_key(kind)
    }

    /// Make an entity (calls `init`). The caller stores it. Ids count up from 1.
    pub fn spawn(&mut self, kind: &str, props: &Props, g: &mut Ctx) -> Result<Entity, String> {
        let Some(d) = self.defs.get(kind) else {
            return Err(format!("hazard-kit: unknown kind {kind}"));
        };
        let behaviour = d.behaviour.clone();
        let mut e = Entity::new(self.next_id, kind);
        self.next_id += 1;
        e.apply(&d.defaults);
        e.apply(props);
        behaviour.init(&mut e, g);
        Ok(e)
    }

    /// Update one entity (no spawn handling; queued spawns stay in `g.spawns`).
    pub fn update_entity(&self, e: &mut Entity, dt: f64, g: &mut Ctx) {
        if let Some(d) = self.defs.get(&e.kind) {
            d.behaviour.update(e, dt, g);
        }
    }

    /// Tick every live entity in order. Spawn requests are applied immediately after the requesting entity,
    /// so entities appended during the pass are also updated in this pass.
    pub fn update(&mut self, ents: &mut Vec<Entity>, dt: f64, g: &mut Ctx) -> Result<(), String> {
        let mut i = 0;
        while i < ents.len() {
            if !ents[i].dead {
                let b = self.defs.get(&ents[i].kind).map(|d| d.behaviour.clone());
                if let Some(b) = b {
                    b.update(&mut ents[i], dt, g);
                }
                for (kind, props) in std::mem::take(&mut g.spawns) {
                    let e = self.spawn(&kind, &props, g)?;
                    ents.push(e);
                }
            }
            i += 1;
        }
        Ok(())
    }

    fn touch(&self, e: &Entity, player: &Player, g: &Ctx) -> Option<ContactType> {
        self.defs.get(&e.kind).and_then(|d| d.behaviour.on_touch(e, player, g))
    }
}

/// Feet-anchored player box `{x, y}` with half-width `hw` and height `hh` against an entity box (strict comparisons).
pub fn overlaps(px: f64, py: f64, hw: f64, hh: f64, e: &Entity) -> bool {
    px + hw > e.x - e.w / 2.0 && px - hw < e.x + e.w / 2.0 && py > e.y - e.h && py - hh < e.y
}

#[derive(Clone, Debug)]
pub struct ContactOpts {
    pub hit_w: f64,
    pub hit_h: f64,
    pub hit_cooldown: f64,
    pub points_penalty: Option<f64>,
}

impl Default for ContactOpts {
    fn default() -> Self {
        ContactOpts { hit_w: 8.0, hit_h: 16.0, hit_cooldown: 0.6, points_penalty: None }
    }
}

/// Resolve contacts in entity order. `g.time` drives the points cooldown (falls back to the entity's `t`).
pub fn resolve_contacts(
    registry: &Registry,
    player: &Player,
    ents: &mut [Entity],
    opts: &ContactOpts,
    g: &Ctx,
) -> Vec<Contact> {
    let hw = opts.hit_w / 2.0;
    let mut out = Vec::new();
    for (index, e) in ents.iter_mut().enumerate() {
        if e.dead {
            continue;
        }
        if !e.layer.is_empty() {
            if let Some(pl) = &player.layer {
                if *pl != e.layer {
                    continue;
                }
            }
        }
        if !overlaps(player.x, player.y, hw, opts.hit_h, e) {
            continue;
        }
        if let Some(kind) = registry.touch(e, player, g) {
            out.push(Contact { ent: e.id, index, kind, ent_kind: None });
            continue;
        }
        if e.collect == Some(true) {
            out.push(Contact { ent: e.id, index, kind: ContactType::Collect, ent_kind: None });
            continue;
        }
        match e.lethal {
            Some(Lethal::Life) => {
                out.push(Contact { ent: e.id, index, kind: ContactType::Kill, ent_kind: Some(e.kind.clone()) })
            }
            Some(Lethal::Points) => {
                let last = e.st.hit_t.unwrap_or(f64::NEG_INFINITY);
                let now = g.time.unwrap_or(e.t);
                if now - last >= opts.hit_cooldown {
                    e.st.hit_t = Some(now);
                    let amount = e.points.or(opts.points_penalty).unwrap_or(-100.0);
                    out.push(Contact { ent: e.id, index, kind: ContactType::Points(amount), ent_kind: None });
                }
            }
            None => {}
        }
    }
    out
}

fn top_of(e: &Entity) -> f64 {
    e.top_y.unwrap_or(e.y - e.h)
}

/// Index of the entity whose solid top a body falling from `prev_y` to `y` lands on.
pub fn solid_top_under(ents: &[Entity], x: f64, y: f64, prev_y: f64, slack: f64) -> Option<usize> {
    ents.iter().position(|e| {
        !e.dead && e.solid_top && (x - e.x).abs() <= e.w / 2.0 + slack && prev_y <= top_of(e) + 1.0 && y >= top_of(e)
    })
}

/// Index of the entity currently carrying a body standing at `(x, y)`.
pub fn solid_top_carrying(ents: &[Entity], x: f64, y: f64, slack: f64) -> Option<usize> {
    ents.iter()
        .position(|e| !e.dead && e.solid_top && (x - e.x).abs() <= e.w / 2.0 + slack && (y - top_of(e)).abs() <= 3.0)
}

fn advance(e: &mut Entity, dx: f64, frame_px: f64, frames: i64) {
    let dist = e.st.dist.unwrap_or(0.0) + dx.abs();
    e.st.dist = Some(dist);
    e.frame = ((dist / frame_px).floor() as i64) % frames;
}

// ---- patterns ----------------------------------------------------------------------------------

/// Walks between `min_x` and `max_x`, turning at the ends (scorpion, guard).
#[derive(Clone, Debug)]
pub struct Patroller {
    pub w: f64,
    pub h: f64,
    pub speed: f64,
    pub min_x: f64,
    pub max_x: f64,
    pub lethal: Option<Lethal>,
    pub frame_px: f64,
    pub frames: i64,
}

impl Default for Patroller {
    fn default() -> Self {
        Patroller {
            w: 12.0,
            h: 8.0,
            speed: 20.0,
            min_x: 0.0,
            max_x: 320.0,
            lethal: Some(Lethal::Life),
            frame_px: 4.0,
            frames: 2,
        }
    }
}

impl Behaviour for Patroller {
    fn init(&self, e: &mut Entity, _g: &mut Ctx) {
        e.w = self.w;
        e.h = self.h;
        e.lethal = self.lethal;
        e.solid_top = false;
        let min_x = *e.st.min_x.get_or_insert(self.min_x);
        let max_x = *e.st.max_x.get_or_insert(self.max_x);
        let dir = if e.dir == Some(1.0) { 1.0 } else { -1.0 };
        e.dir = Some(dir);
        e.x = max_x.min(min_x.max(e.x));
        e.vx = dir * e.speed.unwrap_or(self.speed);
    }

    fn update(&self, e: &mut Entity, dt: f64, _g: &mut Ctx) {
        e.t += dt;
        let dx = e.vx * dt;
        e.x += dx;
        let (min_x, max_x) = (e.st.min_x.unwrap_or(self.min_x), e.st.max_x.unwrap_or(self.max_x));
        let mut dir = e.dir.unwrap_or(-1.0);
        if e.x <= min_x {
            e.x = min_x;
            dir = 1.0;
        }
        if e.x >= max_x {
            e.x = max_x;
            dir = -1.0;
        }
        e.dir = Some(dir);
        e.vx = dir * e.speed.unwrap_or(self.speed);
        advance(e, dx, self.frame_px, self.frames);
    }
}

/// Optional hop for [`Roller`]: `y = baseY - height * sin(pi * ph / len)` for `ph < len` within each `period`.
#[derive(Clone, Copy, Debug)]
pub struct Hop {
    pub period: f64,
    pub len: f64,
    pub height: f64,
}

/// Rolls in one direction and wraps around `width` (rolling log).
#[derive(Clone, Debug)]
pub struct Roller {
    pub w: f64,
    pub h: f64,
    pub speed: f64,
    pub lethal: Option<Lethal>,
    pub frame_px: f64,
    pub frames: i64,
    pub hop: Option<Hop>,
    pub width: f64,
}

impl Default for Roller {
    fn default() -> Self {
        Roller {
            w: 14.0,
            h: 8.0,
            speed: 46.0,
            lethal: Some(Lethal::Points),
            frame_px: 6.0,
            frames: 4,
            hop: None,
            width: 320.0,
        }
    }
}

impl Behaviour for Roller {
    fn init(&self, e: &mut Entity, _g: &mut Ctx) {
        e.w = self.w;
        e.h = self.h;
        e.lethal = self.lethal;
        e.solid_top = false;
        e.vx = e.dir.unwrap_or(-1.0) * e.speed.unwrap_or(self.speed);
        e.st.base_y = Some(e.y);
    }

    fn update(&self, e: &mut Entity, dt: f64, _g: &mut Ctx) {
        e.t += dt;
        let dx = e.vx * dt;
        e.x += dx;
        if e.x + e.w / 2.0 < 0.0 {
            e.x += self.width + e.w;
        }
        if e.x - e.w / 2.0 > self.width {
            e.x -= self.width + e.w;
        }
        if let Some(hop) = self.hop {
            let ph = e.t % hop.period;
            let k = if ph < hop.len { (PI * ph / hop.len).sin() } else { 0.0 };
            e.y = e.st.base_y.unwrap_or(e.y) - hop.height * k;
        }
        advance(e, dx, self.frame_px, self.frames);
    }
}

/// Stationary hazard with a flicker/sway animation (fire, snake).
#[derive(Clone, Debug)]
pub struct Stationary {
    pub w: f64,
    pub h: f64,
    pub lethal: Option<Lethal>,
    pub frames: i64,
    pub fps: f64,
}

impl Default for Stationary {
    fn default() -> Self {
        Stationary { w: 8.0, h: 12.0, lethal: Some(Lethal::Life), frames: 3, fps: 8.0 }
    }
}

impl Behaviour for Stationary {
    fn init(&self, e: &mut Entity, _g: &mut Ctx) {
        e.w = self.w;
        e.h = self.h;
        e.lethal = self.lethal;
        e.solid_top = false;
        e.vx = 0.0;
        e.st.phase.get_or_insert(0.0);
    }

    fn update(&self, e: &mut Entity, dt: f64, _g: &mut Ctx) {
        e.t += dt;
        let phase = e.st.phase.unwrap_or(0.0);
        e.frame = (((e.t + phase) * self.fps).floor() as i64).rem_euclid(self.frames);
    }
}

/// Open/closed cycle (crocodile, spike trap). Closed: solid top and harmless; open: lethal.
#[derive(Clone, Debug)]
pub struct Cycler {
    pub w: f64,
    pub h: f64,
    pub period: f64,
    pub open_frac: f64,
    pub open_lethal: Option<Lethal>,
    pub closed_solid: bool,
}

impl Default for Cycler {
    fn default() -> Self {
        Cycler { w: 22.0, h: 10.0, period: 2.8, open_frac: 0.45, open_lethal: Some(Lethal::Life), closed_solid: true }
    }
}

impl Cycler {
    fn apply(&self, e: &mut Entity) {
        let p = e.st.period.unwrap_or(self.period);
        let phase = e.st.phase.unwrap_or(0.0);
        let frac = e.st.open_frac.unwrap_or(self.open_frac);
        let cyc = ((e.t + phase) % p + p) % p;
        let open = cyc >= p * (1.0 - frac);
        e.frame = i64::from(open);
        e.open = Some(open);
        e.solid_top = self.closed_solid && !open;
        e.lethal = if open { self.open_lethal } else { None };
    }
}

impl Behaviour for Cycler {
    fn init(&self, e: &mut Entity, _g: &mut Ctx) {
        e.w = self.w;
        e.h = self.h;
        e.vx = 0.0;
        e.st.phase.get_or_insert(0.0);
        e.st.period.get_or_insert(self.period);
        e.st.open_frac.get_or_insert(self.open_frac);
        self.apply(e);
    }

    fn update(&self, e: &mut Entity, dt: f64, _g: &mut Ctx) {
        e.t += dt;
        self.apply(e);
    }
}

/// Spawns `kind` every `every` seconds. `make_props` plays the role of the JS `makeProps(e, g)`.
pub struct Spawner {
    pub every: f64,
    pub kind: String,
    pub first: Option<f64>,
    pub make_props: Box<dyn Fn(&Entity) -> Props>,
}

impl Spawner {
    /// Spawner with a static props template.
    pub fn with_props(every: f64, kind: &str, first: Option<f64>, props: Props) -> Self {
        Spawner { every, kind: kind.to_string(), first, make_props: Box::new(move |_| props.clone()) }
    }
}

impl Behaviour for Spawner {
    fn init(&self, e: &mut Entity, _g: &mut Ctx) {
        e.st.timer = Some(self.first.unwrap_or(self.every));
    }

    fn update(&self, e: &mut Entity, dt: f64, g: &mut Ctx) {
        e.t += dt;
        let mut timer = e.st.timer.unwrap_or(self.every) - dt;
        // `every <= 0` would loop forever (JS hangs too); spawn at most once per update in that case.
        while timer <= 0.0 {
            timer += self.every;
            g.spawns.push((self.kind.clone(), (self.make_props)(e)));
            if self.every <= 0.0 {
                break;
            }
        }
        e.st.timer = Some(timer);
    }
}

/// Taunting boss: every `every` seconds picks a line (`ctx.rng.pick`, or cycling without an rng), emits
/// [`Event::Taunt`], and optionally throws a hazard. Fires at most once per update.
pub struct TauntingBoss {
    pub every: f64,
    pub taunts: Vec<String>,
    pub dur: f64,
    pub throw_kind: Option<String>,
    pub throw_props: Box<dyn Fn(&Entity) -> Props>,
    pub sfx: Option<String>,
}

impl Default for TauntingBoss {
    fn default() -> Self {
        TauntingBoss {
            every: 4.0,
            taunts: vec!["HA HA!".to_string()],
            dur: 2.5,
            throw_kind: None,
            throw_props: Box::new(|_| Props::default()),
            sfx: None,
        }
    }
}

impl Behaviour for TauntingBoss {
    fn init(&self, e: &mut Entity, _g: &mut Ctx) {
        e.st.timer.get_or_insert(self.every);
        e.st.said = Some(0);
    }

    fn update(&self, e: &mut Entity, dt: f64, g: &mut Ctx) {
        e.t += dt;
        let timer = e.st.timer.unwrap_or(self.every) - dt;
        e.st.timer = Some(timer);
        if timer > 0.0 || self.taunts.is_empty() {
            return;
        }
        e.st.timer = Some(timer + self.every);
        let said = e.st.said.unwrap_or(0);
        let text = match g.rng.as_mut() {
            Some(r) => r.pick(&self.taunts).clone(),
            None => self.taunts[(said as usize) % self.taunts.len()].clone(),
        };
        e.st.said = Some(said + 1);
        e.st.last = Some(text.clone());
        g.events.push(Event::Taunt { text, dur: self.dur, ent: e.id });
        if let Some(name) = &self.sfx {
            g.events.push(Event::Sfx { name: name.clone() });
        }
        if let Some(k) = &self.throw_kind {
            g.spawns.push((k.clone(), (self.throw_props)(e)));
        }
    }
}

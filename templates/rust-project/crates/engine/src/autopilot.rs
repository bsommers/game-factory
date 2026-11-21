//! Building blocks for a deterministic look-ahead bot (port of `autopilot-kit.js`, see `spec/autopilot.md`):
//! [`trajectory`], [`search_macros`], [`Watchdog`], [`humanize`](Humanizer) and [`Autopilot`].

use crate::rng::BotRng;
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Bot input `{dx, dy, jump, jumpPressed}` (`jump == jump_pressed` for built inputs).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Input {
    pub dx: i32,
    pub dy: i32,
    pub jump: bool,
    pub jump_pressed: bool,
}

pub fn input(dx: i32, dy: i32, jp: bool) -> Input {
    Input { dx, dy, jump: jp, jump_pressed: jp }
}

/// Snapshots of `ents` for ticks 0..=n (index j = after j updates). `update` is the game's real step; entities are cloned
/// so the live game is untouched. A panic inside `update` is swallowed (the entity keeps its state); note this does
/// nothing under `panic = "abort"`, so make `update` panic-free in release builds.
pub fn trajectory<E: Clone, S>(
    ents: &[E],
    is_dead: impl Fn(&E) -> bool,
    n: usize,
    dt: f64,
    mut update: impl FnMut(&mut E, f64),
    snap: impl Fn(&E) -> S,
) -> Vec<Vec<S>> {
    let mut cur: Vec<E> = ents.iter().filter(|e| !is_dead(e)).cloned().collect();
    let mut out = vec![cur.iter().map(&snap).collect::<Vec<_>>()];
    for _ in 0..n {
        for e in cur.iter_mut() {
            let _ = catch_unwind(AssertUnwindSafe(|| update(e, dt)));
        }
        out.push(cur.iter().map(&snap).collect());
    }
    out
}

/// A family of macro plans: `make(n)` builds the plan for a delay of `n` ticks.
pub struct Family<M> {
    pub bias: f64,
    pub make: Box<dyn Fn(i64) -> M>,
}

#[derive(Clone, Copy, Debug)]
pub struct SearchOpts {
    pub count: usize,
    pub stride: i64,
    pub robust_below: f64,
    pub n_tax: f64,
}

impl Default for SearchOpts {
    fn default() -> Self {
        SearchOpts { count: 30, stride: 3, robust_below: 24.0, n_tax: 0.004 }
    }
}

#[derive(Clone, Debug)]
pub struct Best<M> {
    pub cost: f64,
    pub family: usize,
    pub n: i64,
    pub macro_: M,
}

/// Macro-plan search: smoothed (neighbour-max) costs first, raw costs as fallback. `cost` is called for every
/// delay of every family, family-major.
pub fn search_macros<M>(families: &[Family<M>], mut cost: impl FnMut(&M) -> f64, opts: &SearchOpts) -> Option<Best<M>> {
    let nn = opts.count;
    let grid: Vec<Vec<f64>> =
        families.iter().map(|f| (0..nn).map(|i| cost(&(f.make)(i as i64 * opts.stride))).collect()).collect();
    for smooth in [true, false] {
        let mut best: Option<(f64, usize, usize)> = None;
        for (fi, f) in families.iter().enumerate() {
            let costs = &grid[fi];
            for i in 0..nn {
                let raw = if smooth {
                    let prev = if i > 0 { costs[i - 1] } else { costs[i] };
                    let next = if i + 1 < nn { costs[i + 1] } else { costs[i] };
                    costs[i].max(prev).max(next)
                } else {
                    costs[i]
                };
                let c = raw + f.bias + i as f64 * opts.n_tax;
                if best.is_none_or(|b| c < b.0) {
                    best = Some((c, fi, i));
                }
            }
        }
        if let Some((c, fi, i)) = best {
            if !smooth || c < opts.robust_below {
                let n = i as i64 * opts.stride;
                return Some(Best { cost: c, family: fi, n, macro_: (families[fi].make)(n) });
            }
        }
    }
    None
}

/// Progress watchdog: `tick` returns true while the bot should flail.
#[derive(Clone, Debug)]
pub struct Watchdog {
    limit: f64,
    panic_ticks: i64,
    key: String,
    since: f64,
    panic: i64,
    pub stuck: i64,
}

impl Watchdog {
    pub fn new(limit: f64, panic_ticks: i64) -> Self {
        Watchdog { limit, panic_ticks, key: String::new(), since: 0.0, panic: 0, stuck: 0 }
    }

    pub fn tick(&mut self, k: &str, time: f64) -> bool {
        if k != self.key {
            self.key = k.to_string();
            self.since = time;
            self.panic = 0;
        }
        if self.panic == 0 && time - self.since > self.limit {
            self.stuck += 1;
            self.panic = self.panic_ticks;
            self.since = time;
        }
        if self.panic > 0 {
            self.panic -= 1;
            return true;
        }
        false
    }

    /// Flail input for the current panic tick: alternate direction, hop now and then.
    pub fn flail(tick_no: i64) -> Input {
        input(if tick_no % 120 < 60 { 1 } else { -1 }, 0, tick_no % 40 == 0)
    }
}

impl Default for Watchdog {
    fn default() -> Self {
        Watchdog::new(40.0, 90)
    }
}

/// Deterministic human lag: delays each jump by up to ~`(1 - skill) * 14` ticks. `skill >= 1` is a perfect bot.
pub struct Humanizer {
    skill: f64,
    pending: i64,
    rng: Box<dyn FnMut() -> f64>,
}

impl Humanizer {
    pub fn new(skill: f64, rng: Box<dyn FnMut() -> f64>) -> Self {
        Humanizer { skill, pending: 0, rng }
    }

    /// Humanizer using the legacy `botRng` stream (JS default is seed 1).
    pub fn with_bot_seed(skill: f64, seed: i32) -> Self {
        let mut r = BotRng::new(seed);
        Humanizer::new(skill, Box::new(move || r.next_float()))
    }

    pub fn apply(&mut self, r: Input, can_act: bool) -> Input {
        if self.skill >= 1.0 || !can_act {
            return r;
        }
        if self.pending > 0 {
            self.pending -= 1;
            return if self.pending == 0 {
                Input { jump: true, jump_pressed: true, ..r }
            } else {
                input(r.dx, 0, false)
            };
        }
        if r.jump_pressed {
            let late = ((1.0 - self.skill) * 14.0 + 0.5).floor() as i64;
            self.pending = late + ((self.rng)() * (late + 1) as f64).floor() as i64;
            if self.pending > 0 {
                return input(r.dx, 0, false);
            }
        }
        r
    }
}

#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub errors: i64,
    pub stuck: i64,
    pub last_error: Option<String>,
}

/// Glue: `decide` wrapped with watchdog, humanizer, error containment and stats. `G` is your game facade.
pub struct Autopilot<G> {
    pub stats: Stats,
    wd: Watchdog,
    lag: Humanizer,
    tick_no: i64,
    pub decide: Box<dyn FnMut(&G, f64) -> Result<Input, String>>,
    pub progress_key: Box<dyn Fn(&G) -> String>,
    pub time: Box<dyn Fn(&G) -> f64>,
    pub playing: Option<Box<dyn Fn(&G) -> bool>>,
    pub can_humanize: Option<Box<dyn Fn(&G) -> bool>>,
}

impl<G> Autopilot<G> {
    pub fn new(
        decide: Box<dyn FnMut(&G, f64) -> Result<Input, String>>,
        progress_key: Box<dyn Fn(&G) -> String>,
        time: Box<dyn Fn(&G) -> f64>,
        skill: f64,
        seed: i32,
        watchdog: Watchdog,
    ) -> Self {
        Autopilot {
            stats: Stats::default(),
            wd: watchdog,
            lag: Humanizer::with_bot_seed(skill, seed),
            tick_no: 0,
            decide,
            progress_key,
            time,
            playing: None,
            can_humanize: None,
        }
    }

    pub fn input(&mut self, g: &G, dt: f64) -> Input {
        self.tick_no += 1;
        let playing = self.playing.as_ref().is_none_or(|f| f(g));
        if playing && self.wd.tick(&(self.progress_key)(g), (self.time)(g)) {
            self.stats.stuck = self.wd.stuck;
            return Watchdog::flail(self.tick_no);
        }
        let r = match (self.decide)(g, dt) {
            Ok(r) => r,
            Err(e) => {
                self.stats.errors += 1;
                self.stats.last_error = Some(e);
                input(1, 0, false)
            }
        };
        let can = self.can_humanize.as_ref().is_none_or(|f| f(g));
        self.lag.apply(r, can)
    }
}

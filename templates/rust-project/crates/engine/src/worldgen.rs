//! Seeded, deterministic, circular screen generator driven by a rule table, plus a fairness validator
//! (port of `world-gen.js`, see `spec/world-gen.md`). Uses the legacy [`Mulberry32`] stream, NOT PCG32.
//!
//! JS escape-hatch closures are replaced by data: [`PitBuild`] for `slot.build`, `exclude` / `prefer` on
//! [`Collectibles`], and closures on [`ValidateOpts`] (`crossable`, `is_hard`, `checks`).

use crate::rng::Mulberry32;

/// A loosely typed scalar for slot `set` keys and item props.
#[derive(Clone, Debug, PartialEq)]
pub enum Val {
    Bool(bool),
    Num(f64),
    Str(String),
}

impl Val {
    fn truthy(&self) -> bool {
        match self {
            Val::Bool(b) => *b,
            Val::Num(n) => *n != 0.0 && !n.is_nan(),
            Val::Str(s) => !s.is_empty(),
        }
    }
}

/// `number | {from, base, to, perT} | null` driven by difficulty `t`.
#[derive(Clone, Debug, PartialEq)]
pub enum Lerp {
    Null,
    Num(f64),
    Obj { from: Option<f64>, base: Option<f64>, to: Option<f64>, per_t: Option<f64> },
}

pub fn lerp_val(v: &Lerp, t: f64) -> f64 {
    match v {
        Lerp::Null => 0.0,
        Lerp::Num(n) => *n,
        Lerp::Obj { from, base, to, per_t } => {
            let a = from.or(*base).unwrap_or(0.0);
            a + (to.unwrap_or(a) - a) * t + per_t.unwrap_or(0.0) * t
        }
    }
}

/// Floor-mod wrap of an integer index.
pub fn wrap(i: i64, n: i64) -> i64 {
    ((i % n) + n) % n
}

/// Circular distance between screens `a` and `b` in a world of `n`.
pub fn circ_dist(a: i64, b: i64, n: i64) -> i64 {
    let d = wrap(a - b, n);
    d.min(n - d)
}

/// Difficulty 0 at `start` up to 1 on the opposite side of the circle.
pub fn ramp_of(i: i64, start: i64, n: i64) -> f64 {
    circ_dist(i, start, n) as f64 / (n as f64 / 2.0)
}

fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Fisher-Yates with the legacy stream.
pub fn shuffle<T>(arr: &mut [T], rng: &mut Mulberry32) {
    rng.shuffle(arr);
}

/// Weighted pick; falls back to the last item. `items` must be non-empty.
pub fn pick_weighted<'a, T>(rng: &mut Mulberry32, items: &'a [(T, f64)]) -> &'a T {
    let tot: f64 = items.iter().map(|(_, w)| *w).sum();
    let mut r = rng.next_float() * tot;
    for (v, w) in items {
        r -= w;
        if r < 0.0 {
            return v;
        }
    }
    &items[items.len() - 1].0
}

// ---- rule table --------------------------------------------------------------------------------

#[derive(Clone, Debug, Default)]
pub struct PlaceKind {
    pub kind: String,
    pub weight: Option<f64>,
    pub per_t: Option<f64>,
    pub min_t: Option<f64>,
    pub max_t: Option<f64>,
    pub props: Vec<(String, Val)>,
}

#[derive(Clone, Debug)]
pub struct PlaceRule {
    pub kinds: Vec<PlaceKind>,
    pub chance: Lerp,
    pub count: i64,
    pub min_t: Option<f64>,
    pub max_t: Option<f64>,
    pub clamp_t: Option<f64>,
    /// `mode: 'rolling'`: items get no x and cost no extra draw.
    pub rolling: bool,
    pub lo: f64,
    pub hi: f64,
    pub fixed_x: Option<f64>,
}

impl Default for PlaceRule {
    fn default() -> Self {
        PlaceRule {
            kinds: vec![],
            chance: Lerp::Num(1.0),
            count: 1,
            min_t: None,
            max_t: None,
            clamp_t: None,
            rolling: false,
            lo: 0.0,
            hi: 320.0,
            fixed_x: None,
        }
    }
}

/// The `{type:'pit', ...}` build fixture.
#[derive(Clone, Debug)]
pub struct PitBuild {
    pub chance: Lerp,
    pub w: Lerp,
    pub kind: String,
    pub lo: f64,
    pub hi: f64,
}

#[derive(Clone, Debug, Default)]
pub struct Slot {
    pub set: Vec<(String, Val)>,
    pub place: Vec<PlaceRule>,
    pub build: Option<PitBuild>,
}

#[derive(Clone, Debug)]
pub struct Blocks {
    pub size: usize,
    pub deck: Vec<String>,
    pub fixed: Vec<(usize, String)>,
    pub first_slot: Option<String>,
}

impl Default for Blocks {
    fn default() -> Self {
        Blocks { size: 12, deck: vec!["plain".to_string()], fixed: vec![], first_slot: None }
    }
}

#[derive(Clone, Debug)]
pub struct Spacing {
    pub edge_clear: f64,
    pub gap: f64,
    pub step: f64,
}

impl Default for Spacing {
    fn default() -> Self {
        Spacing { edge_clear: 36.0, gap: 48.0, step: 4.0 }
    }
}

#[derive(Clone, Debug)]
pub struct Collectibles {
    pub count: i64,
    /// `(type, upTo)` tiers by distance rank from `start`.
    pub tiers: Vec<(String, i64)>,
    /// Exclude screens whose `set` key of this name is truthy.
    pub exclude: Option<String>,
    /// `(every, pitKind)`: prefer screens where `k % every == 0` and the pit kind matches.
    pub prefer: Option<(i64, String)>,
    pub offsets: Vec<i64>,
    pub x_range: (f64, f64),
    pub x_step: f64,
    pub clear: f64,
    pub zone_clear: f64,
}

impl Default for Collectibles {
    fn default() -> Self {
        Collectibles {
            count: 0,
            tiers: vec![],
            exclude: None,
            prefer: None,
            offsets: vec![0, 1, -1, 2, -2],
            x_range: (30.0, 290.0),
            x_step: 10.0,
            clear: 44.0,
            zone_clear: 28.0,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Rules {
    pub seed: u64,
    pub count: i64,
    pub start: i64,
    pub blocks: Blocks,
    pub spacing: Spacing,
    pub slots: Vec<(String, Slot)>,
    pub collectibles: Option<Collectibles>,
}

// ---- generated data ----------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub kind: String,
    /// `None` = rolling item.
    pub x: Option<f64>,
    pub props: Vec<(String, Val)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Zone {
    pub x0: f64,
    pub x1: f64,
    pub pit: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PitDef {
    pub kind: String,
    pub x0: f64,
    pub w: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CollectibleRef {
    pub id: i64,
    pub kind: String,
    pub x: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Screen {
    pub idx: i64,
    pub tag: String,
    pub t: f64,
    pub items: Vec<Item>,
    pub zones: Vec<Zone>,
    pub pit: Option<PitDef>,
    pub collectible: Option<CollectibleRef>,
    /// Keys copied from the slot `set`.
    pub extras: Vec<(String, Val)>,
}

impl Screen {
    pub fn flag(&self, key: &str) -> bool {
        self.extras.iter().any(|(k, v)| k == key && v.truthy())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Collectible {
    pub id: i64,
    pub kind: String,
    pub screen: i64,
    pub x: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct World {
    pub screens: Vec<Screen>,
    pub collectibles: Vec<Collectible>,
}

// ---- generation --------------------------------------------------------------------------------

fn block_slots(rules: &Rules, b: i64) -> Vec<Option<String>> {
    let bl = &rules.blocks;
    let size = bl.size;
    let mut rng = Mulberry32::new((rules.seed.wrapping_mul(7).wrapping_add(7001).wrapping_add(b as u64 * 31)) as i64);
    let free: Vec<usize> = (0..size).filter(|p| !bl.fixed.iter().any(|(fp, _)| fp == p)).collect();
    let mut cards: Vec<String> = (0..free.len()).map(|k| bl.deck[k % bl.deck.len()].clone()).collect();
    rng.shuffle(&mut cards);
    let mut m: Vec<Option<String>> = vec![None; size];
    for (p, tag) in &bl.fixed {
        if *p < size {
            m[*p] = Some(tag.clone());
        }
    }
    for (k, p) in free.iter().enumerate() {
        m[*p] = Some(cards[k].clone());
    }
    if b == 0 {
        if let Some(first) = &bl.first_slot {
            if size > 0 && m[0].as_ref() != Some(first) {
                if let Some(k) = free.iter().copied().find(|p| m[*p].as_ref() == Some(first)) {
                    m.swap(0, k);
                }
            }
        }
    }
    m
}

/// Free x positions honouring zones (padded), existing static items (gap) and edges.
pub fn free_xs(
    def: &Screen,
    rules: &Rules,
    edge_clear: Option<f64>,
    gap: Option<f64>,
    extra: &[f64],
    lo: f64,
    hi: f64,
) -> Vec<f64> {
    let ec = edge_clear.unwrap_or(rules.spacing.edge_clear);
    let g = gap.unwrap_or(rules.spacing.gap);
    let step = rules.spacing.step;
    let mut out = Vec::new();
    let mut x = lo + ec;
    while x <= hi - ec {
        let blocked = def.zones.iter().any(|z| x > z.x0 - ec && x < z.x1 + ec)
            || def.items.iter().any(|h| h.x.is_some_and(|hx| (hx - x).abs() < g))
            || extra.iter().any(|e| (e - x).abs() < g);
        if !blocked {
            out.push(x);
        }
        x += step;
    }
    out
}

fn apply_place(def: &mut Screen, rule: &PlaceRule, rng: &mut Mulberry32, t: f64, rules: &Rules) {
    let ch = lerp_val(&rule.chance, t);
    if rule.min_t.is_some_and(|m| t < m) || rule.max_t.is_some_and(|m| t > m) {
        return;
    }
    if !rng.chance(ch) {
        return;
    }
    let tt = rule.clamp_t.map_or(t, |c| t.min(c));
    let kinds: Vec<(&PlaceKind, f64)> = rule
        .kinds
        .iter()
        .filter(|k| k.min_t.is_none_or(|m| tt > m) && k.max_t.is_none_or(|m| tt <= m))
        .map(|k| (k, k.weight.unwrap_or(1.0) + k.per_t.unwrap_or(0.0) * tt))
        .collect();
    if kinds.is_empty() {
        return;
    }
    for _ in 0..rule.count {
        let k = *pick_weighted(rng, &kinds);
        if rule.rolling {
            def.items.push(Item { kind: k.kind.clone(), x: None, props: k.props.clone() });
            continue;
        }
        let xs = free_xs(def, rules, None, None, &[], rule.lo, rule.hi);
        if xs.is_empty() {
            return;
        }
        let x = rule.fixed_x.unwrap_or_else(|| *rng.pick(&xs));
        def.items.push(Item { kind: k.kind.clone(), x: Some(x), props: k.props.clone() });
    }
}

fn apply_build(def: &mut Screen, b: &PitBuild, rng: &mut Mulberry32, t: f64, rules: &Rules) {
    if !rng.chance(lerp_val(&b.chance, t)) {
        return;
    }
    let w = js_round(lerp_val(&b.w, t));
    let xs = free_xs(def, rules, None, None, &[], b.lo, b.hi);
    if xs.is_empty() {
        return;
    }
    let x0 = *rng.pick(&xs);
    def.pit = Some(PitDef { kind: b.kind.clone(), x0, w });
    def.zones.push(Zone { x0, x1: x0 + w, pit: true });
}

/// Generate the world. Pure function of the rule table.
pub fn generate_world(rules: &Rules) -> Result<World, String> {
    let n = rules.count;
    let size = rules.blocks.size.max(1) as i64;
    let nblocks = (n + size - 1) / size;
    let maps: Vec<Vec<Option<String>>> = (0..nblocks).map(|b| block_slots(rules, b)).collect();
    let mut screens = Vec::with_capacity(n.max(0) as usize);
    for i in 0..n {
        let mut rng =
            Mulberry32::new((rules.seed.wrapping_mul(101).wrapping_add(90001).wrapping_add(i as u64 * 7919)) as i64);
        let t = ramp_of(i, rules.start, n);
        let tag = maps[(i / size) as usize]
            .get((i % size) as usize)
            .cloned()
            .flatten()
            .unwrap_or_else(|| "plain".to_string());
        let slot = rules.slots.iter().find(|(k, _)| *k == tag).map(|(_, s)| s.clone()).unwrap_or_default();
        let mut def = Screen {
            idx: i,
            tag,
            t,
            items: vec![],
            zones: vec![],
            pit: None,
            collectible: None,
            extras: slot.set.clone(),
        };
        for rule in &slot.place {
            apply_place(&mut def, rule, &mut rng, t, rules);
        }
        if let Some(b) = &slot.build {
            apply_build(&mut def, b, &mut rng, t, rules);
        }
        if let Some(p) = &def.pit {
            if !def.zones.iter().any(|z| z.pit) {
                let z = Zone { x0: p.x0, x1: p.x0 + p.w, pit: true };
                def.zones.push(z);
            }
        }
        screens.push(def);
    }
    let collectibles = match &rules.collectibles {
        Some(c) => place_collectibles(&mut screens, rules, c)?,
        None => vec![],
    };
    Ok(World { screens, collectibles })
}

fn place_collectibles(screens: &mut [Screen], rules: &Rules, c: &Collectibles) -> Result<Vec<Collectible>, String> {
    let n = screens.len() as i64;
    let start = rules.start;
    let mut used = vec![start];
    let mut picks: Vec<(i64, f64)> = Vec::new();
    let mut rng = Mulberry32::new(rules.seed.wrapping_mul(13).wrapping_add(555) as i64);
    let (xlo, xhi) = c.x_range;
    for k in 0..c.count {
        let target = js_round((k as f64 + 0.5) * n as f64 / c.count as f64) as i64;
        let mut cands: Vec<i64> = c
            .offsets
            .iter()
            .map(|o| wrap(target + o, n))
            .filter(|i| !used.contains(i) && !c.exclude.as_ref().is_some_and(|key| screens[*i as usize].flag(key)))
            .collect();
        if let Some((every, pit_kind)) = &c.prefer {
            let pr: Vec<i64> = cands
                .iter()
                .copied()
                .filter(|i| k % every == 0 && screens[*i as usize].pit.as_ref().is_some_and(|p| p.kind == *pit_kind))
                .collect();
            if !pr.is_empty() {
                cands = pr;
            }
        }
        let Some(&si) = cands.first() else {
            return Err(format!("world-gen: collectible placement failed for {k}"));
        };
        used.push(si);
        let s = &mut screens[si as usize];
        s.items.retain(|h| h.x.is_some());
        let ok_x = |x: f64, s: &Screen, with_items: bool| {
            let in_zone = s.zones.iter().any(|z| x > z.x0 - c.zone_clear && x < z.x1 + c.zone_clear);
            let near_item = with_items && s.items.iter().any(|h| h.x.is_some_and(|hx| (hx - x).abs() < c.clear));
            !in_zone && !near_item
        };
        let scan = |s: &Screen, with_items: bool| {
            let mut xs = Vec::new();
            let mut x = xlo;
            while x <= xhi {
                if ok_x(x, s, with_items) {
                    xs.push(x);
                }
                x += c.x_step;
            }
            xs
        };
        let mut xs = scan(s, true);
        if xs.is_empty() {
            s.items.clear();
            xs = scan(s, false);
        }
        if xs.is_empty() {
            return Err(format!("world-gen: no free x for collectible on screen {si}"));
        }
        picks.push((si, *rng.pick(&xs)));
    }
    picks.sort_by_key(|p| p.0);
    let mut order: Vec<(usize, i64, f64, i64)> =
        picks.iter().enumerate().map(|(id, p)| (id, p.0, p.1, circ_dist(p.0, start, n))).collect();
    order.sort_by(|a, b| a.3.cmp(&b.3).then(a.1.cmp(&b.1)));
    let tier_of = |rank: i64| -> String {
        c.tiers.iter().find(|t| rank < t.1).or(c.tiers.last()).map(|t| t.0.clone()).unwrap_or_default()
    };
    let mut out: Vec<Collectible> = order
        .iter()
        .enumerate()
        .map(|(rank, o)| Collectible { id: o.0 as i64, kind: tier_of(rank as i64), screen: o.1, x: o.2 })
        .collect();
    out.sort_by_key(|c| c.id);
    for tr in &out {
        screens[tr.screen as usize].collectible = Some(CollectibleRef { id: tr.id, kind: tr.kind.clone(), x: tr.x });
    }
    Ok(out)
}

/// Generate twice and compare (guards against hidden nondeterminism).
pub fn is_deterministic(rules: &Rules) -> bool {
    generate_world(rules) == generate_world(rules)
}

// ---- fairness validator ------------------------------------------------------------------------

pub type ScreenCheck = Box<dyn Fn(&Screen) -> Result<(), String>>;

#[derive(Default)]
pub struct ValidateOpts {
    /// Can a player cross this screen? `Err(reason)` fails the `crossable` rule.
    pub crossable: Option<ScreenCheck>,
    /// Can the collectible be picked up? `Err(reason)` fails `collectibleReachable`.
    pub collectible_reachable: Option<ScreenCheck>,
    pub edge_clear: Option<f64>,
    pub gap: Option<f64>,
    pub collect_clear: Option<f64>,
    pub allow_edge_items: bool,
    pub allow_items_near_zones: bool,
    pub rolling_sweeps_collectible: bool,
    /// Extra game rules: `Err(msg)` fails with rule `custom`.
    pub checks: Vec<ScreenCheck>,
    pub max_hard_run: Option<usize>,
    pub is_hard: Option<Box<dyn Fn(&Screen) -> bool>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Failure {
    /// Screen index, or -1 for world-level rules.
    pub screen: i64,
    pub rule: String,
    pub msg: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Validation {
    pub ok: bool,
    pub failures: Vec<Failure>,
    pub screens: usize,
    pub collectibles: usize,
}

pub fn validate_world(world: &World, opts: &ValidateOpts) -> Validation {
    let n = world.screens.len();
    let ec = opts.edge_clear.unwrap_or(36.0);
    let gap = opts.gap.unwrap_or(48.0);
    let cc = opts.collect_clear.unwrap_or(44.0);
    let mut failures: Vec<Failure> = Vec::new();
    let mut fail =
        |idx: i64, rule: &str, msg: String| failures.push(Failure { screen: idx, rule: rule.to_string(), msg });
    for def in &world.screens {
        if let Some(f) = &opts.crossable {
            if let Err(m) = f(def) {
                fail(def.idx, "crossable", m);
            }
        }
        let mut st: Vec<&Item> = def.items.iter().filter(|h| h.x.is_some()).collect();
        st.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
        for k in 0..st.len() {
            let x = st[k].x.unwrap_or(0.0);
            if (x < ec || x > 320.0 - ec) && !opts.allow_edge_items {
                fail(def.idx, "edgeClear", format!("{}@{} within {} of edge", st[k].kind, x, ec));
            }
            if k > 0 {
                let px = st[k - 1].x.unwrap_or(0.0);
                if x - px < gap {
                    fail(def.idx, "gap", format!("{}/{} only {}px apart", st[k - 1].kind, st[k].kind, x - px));
                }
            }
            for z in &def.zones {
                if x > z.x0 - ec && x < z.x1 + ec && !opts.allow_items_near_zones {
                    fail(def.idx, "zoneClear", format!("{}@{} too near a zone", st[k].kind, x));
                }
            }
        }
        if let Some(col) = &def.collectible {
            for h in &st {
                let d = (h.x.unwrap_or(0.0) - col.x).abs();
                if d < cc {
                    fail(def.idx, "collectClear", format!("{} {}px from collectible", h.kind, d));
                }
            }
            if def.items.iter().any(|h| h.x.is_none()) && opts.rolling_sweeps_collectible {
                fail(def.idx, "rolling", "rolling hazard on collectible screen".to_string());
            }
            if let Some(f) = &opts.collectible_reachable {
                if let Err(m) = f(def) {
                    fail(def.idx, "collectibleReachable", m);
                }
            }
        }
        for chk in &opts.checks {
            if let Err(m) = chk(def) {
                fail(def.idx, "custom", m);
            }
        }
    }
    if let (Some(max), Some(is_hard)) = (opts.max_hard_run, &opts.is_hard) {
        if max > 0 {
            let (mut run, mut worst) = (0usize, 0usize);
            for i in 0..2 * n {
                run = if is_hard(&world.screens[i % n]) { run + 1 } else { 0 };
                worst = worst.max(run);
            }
            if worst > max && worst < 2 * n {
                fail(-1, "hardRun", format!("{worst} consecutive hard screens (max {max})"));
            }
        }
    }
    let mut ids: Vec<i64> = world.collectibles.iter().map(|c| c.screen).collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.len() != world.collectibles.len() {
        fail(-1, "collectibleUnique", "two collectibles share a screen".to_string());
    }
    Validation { ok: failures.is_empty(), failures, screens: n, collectibles: world.collectibles.len() }
}

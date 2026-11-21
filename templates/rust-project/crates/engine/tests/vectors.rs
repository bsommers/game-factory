//! Conformance: run every case in `spec/vectors/*.json` (generated from the JS reference) through the Rust engines.
//! Ints/strings/bools/null compare exactly, floats within 1e-9 (relative 1e-12 above 1e6). See `spec/README.md`.
//! The spec dir is found via env `FACTORY_SPEC_DIR` (either the `spec` or the `spec/vectors` directory), else by
//! searching upward from this crate for `spec/vectors/rng.json`.

use engine::autopilot::{self, Autopilot, Family, Humanizer, SearchOpts, Watchdog};
use engine::hazard::*;
use engine::physics as ph;
use engine::rng::{fnv1a32, BotRng, Mulberry32, Pcg32};
use engine::worldgen as wg;
use serde_json::{json, Map, Value};
use std::path::PathBuf;

// ---- harness -----------------------------------------------------------------------------------

fn vectors_dir() -> PathBuf {
    if let Ok(d) = std::env::var("FACTORY_SPEC_DIR") {
        let p = PathBuf::from(d);
        for c in [p.clone(), p.join("vectors"), p.join("spec/vectors")] {
            if c.join("rng.json").exists() {
                return c;
            }
        }
        panic!("FACTORY_SPEC_DIR={} has no rng.json", p.display());
    }
    let mut dir = Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    while let Some(d) = dir {
        let c = d.join("spec/vectors");
        if c.join("rng.json").exists() {
            return c;
        }
        dir = d.parent().map(PathBuf::from);
    }
    panic!("spec/vectors/rng.json not found above the crate; set FACTORY_SPEC_DIR");
}

fn num_eq(a: &Value, b: &Value) -> bool {
    let (an, bn) = (a.as_f64().unwrap_or(f64::NAN), b.as_f64().unwrap_or(f64::NAN));
    let both_int = (a.is_i64() || a.is_u64()) && (b.is_i64() || b.is_u64());
    if both_int {
        return a == b;
    }
    let d = (an - bn).abs();
    d <= 1e-9 || (an.abs().max(bn.abs()) > 1e6 && d <= 1e-12 * an.abs().max(bn.abs()))
}

/// `expect` vs `actual` recursively; returns a path-qualified message on the first difference.
fn cmp(path: &str, expect: &Value, actual: &Value) -> Result<(), String> {
    match (expect, actual) {
        (Value::Number(_), Value::Number(_)) => {
            if num_eq(expect, actual) {
                Ok(())
            } else {
                Err(format!("{path}: expected {expect}, got {actual}"))
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                return Err(format!("{path}: array length {} vs {}", a.len(), b.len()));
            }
            for (i, (x, y)) in a.iter().zip(b).enumerate() {
                cmp(&format!("{path}[{i}]"), x, y)?;
            }
            Ok(())
        }
        (Value::Object(a), Value::Object(b)) => {
            for k in a.keys() {
                if !b.contains_key(k) {
                    return Err(format!("{path}: missing key {k}"));
                }
            }
            for k in b.keys() {
                if !a.contains_key(k) {
                    return Err(format!("{path}: unexpected key {k}"));
                }
            }
            for (k, v) in a {
                cmp(&format!("{path}.{k}"), v, &b[k])?;
            }
            Ok(())
        }
        _ => {
            if expect == actual {
                Ok(())
            } else {
                Err(format!("{path}: expected {expect}, got {actual}"))
            }
        }
    }
}

fn run_file(name: &str, run: impl Fn(&Value) -> Value) {
    let path = vectors_dir().join(format!("{name}.json"));
    let doc: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("read vectors")).expect("parse vectors");
    let cases = doc["cases"].as_array().expect("cases");
    let mut failed = Vec::new();
    for c in cases {
        let cname = c["name"].as_str().unwrap_or("?");
        let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&c["input"])));
        match out {
            Ok(actual) => {
                if let Err(e) = cmp("", &c["expect"], &actual) {
                    failed.push(format!("[{cname}] {e}"));
                }
            }
            Err(_) => failed.push(format!("[{cname}] runner panicked")),
        }
    }
    println!("{name}: {}/{} vector cases passed", cases.len() - failed.len(), cases.len());
    assert!(
        failed.is_empty(),
        "{} of {} cases failed:\n{}",
        failed.len(),
        cases.len(),
        failed.iter().take(8).cloned().collect::<Vec<_>>().join("\n")
    );
}

// ---- JSON helpers ------------------------------------------------------------------------------

fn f(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(Value::as_f64)
}
fn fd(v: &Value, k: &str, d: f64) -> f64 {
    f(v, k).unwrap_or(d)
}
fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(String::from)
}
fn b(v: &Value, k: &str) -> Option<bool> {
    v.get(k).and_then(Value::as_bool)
}
fn arr<'a>(v: &'a Value, k: &str) -> &'a [Value] {
    v.get(k).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}
fn pcg_from(seed: &Value) -> Pcg32 {
    match seed {
        Value::String(t) => Pcg32::from_str_seed(t),
        v => Pcg32::new(v.as_i64().unwrap_or(1) as u32),
    }
}

// ---- rng ---------------------------------------------------------------------------------------

fn run_rng(i: &Value) -> Value {
    let op = i["op"].as_str().unwrap();
    if op == "fnv1a" {
        return json!({ "u32": fnv1a32(i["str"].as_str().unwrap()) });
    }
    let n = i.get("n").and_then(Value::as_u64).unwrap_or(0) as usize;
    let (lo, hi) = (i.get("lo").and_then(Value::as_i64).unwrap_or(0), i.get("hi").and_then(Value::as_i64).unwrap_or(0));
    let alg = i["alg"].as_str().unwrap();
    let mut vals: Vec<Value> = Vec::new();
    match alg {
        "pcg32" => {
            let mut r = pcg_from(&i["seed"]);
            match op {
                "u32" => (0..n).for_each(|_| vals.push(json!(r.next_u32()))),
                "float" => (0..n).for_each(|_| vals.push(json!(r.next_float()))),
                "int" => (0..n).for_each(|_| vals.push(json!(r.int(lo, hi)))),
                "range" => (0..n).for_each(|_| vals.push(json!(r.range(fd(i, "lo", 0.0), fd(i, "hi", 0.0))))),
                "chance" => (0..n).for_each(|_| vals.push(json!(r.chance(fd(i, "p", 0.0))))),
                "pick" => {
                    let items = arr(i, "items");
                    (0..n).for_each(|_| vals.push(r.pick(items).clone()))
                }
                "shuffle" => {
                    let mut items = arr(i, "items").to_vec();
                    r.shuffle(&mut items);
                    vals = items;
                }
                _ => panic!("op {op}"),
            }
        }
        "mulberry32" => {
            let mut r = Mulberry32::new(i["seed"].as_i64().unwrap());
            match op {
                "float" => (0..n).for_each(|_| vals.push(json!(r.next_float()))),
                "int" => (0..n).for_each(|_| vals.push(json!(r.int(lo, hi)))),
                _ => panic!("op {op}"),
            }
        }
        "bot" => {
            let mut r = BotRng::new(i["seed"].as_i64().unwrap() as i32);
            (0..n).for_each(|_| vals.push(json!(r.next_float())));
        }
        _ => panic!("alg {alg}"),
    }
    json!({ "values": vals })
}

#[test]
fn rng_vectors() {
    run_file("rng", run_rng);
}

// ---- platformer-physics ------------------------------------------------------------------------

fn make_cfg(v: Option<&Value>) -> ph::Config {
    let mut c = ph::Config::default();
    if let Some(v) = v {
        macro_rules! o {
            ($($key:literal => $f:ident),*) => { $( if let Some(x) = f(v, $key) { c.$f = x; } )* };
        }
        o!("gravity" => gravity, "jumpV" => jump_v, "runSpeed" => run_speed, "airSpeed" => air_speed, "airAccel" => air_accel,
           "climbSpeed" => climb_speed, "hitW" => hit_w, "hitH" => hit_h, "grabR" => grab_r, "grabCooldown" => grab_cooldown,
           "swingBlend" => swing_blend, "edgeL" => edge_l, "edgeR" => edge_r);
        if let Some(x) = f(v, "stride") {
            c.stride = x as i64;
        }
    }
    c
}

fn moving_from(p: &Value) -> ph::MovingPlatform {
    let (x0, y0) = (fd(p, "x0", 0.0), fd(p, "y0", 0.0));
    ph::MovingPlatform::new(
        x0,
        y0,
        fd(p, "x1", x0),
        fd(p, "y1", y0),
        fd(p, "w", 24.0),
        fd(p, "speed", 20.0),
        fd(p, "phase", 0.0),
    )
}

struct PWorld {
    world: ph::World,
    ids: Vec<Option<String>>,
    movers: Vec<(usize, ph::MovingPlatform)>,
}

fn build_world(w: &Value) -> PWorld {
    let mut world = ph::World { ground_y: fd(w, "groundY", 0.0), ..ph::World::default() };
    for q in arr(w, "pits") {
        let mut pit = ph::Pit::new(fd(q, "x0", 0.0), fd(q, "x1", 0.0));
        pit.kind = s(q, "kind");
        pit.drop = b(q, "drop").unwrap_or(false);
        world.pits.push(pit);
    }
    let (mut ids, mut movers) = (Vec::new(), Vec::new());
    for (idx, p) in arr(w, "platforms").iter().enumerate() {
        ids.push(s(p, "id"));
        let mut pl = ph::Platform::default();
        if let Some(m) = p.get("moving") {
            let mp = moving_from(m);
            mp.write_to(&mut pl);
            movers.push((idx, mp));
        } else {
            pl = ph::Platform::new(fd(p, "x", 0.0), fd(p, "y", 0.0), fd(p, "w", 0.0));
            pl.dx = fd(p, "dx", 0.0);
            pl.dy = fd(p, "dy", 0.0);
        }
        world.platforms.push(pl);
    }
    for l in arr(w, "ladders") {
        let mut lad = ph::Ladder::new(fd(l, "x", 0.0), fd(l, "top", 0.0), fd(l, "bottom", 0.0));
        lad.w = fd(l, "w", 8.0);
        world.ladders.push(lad);
    }
    for r in arr(w, "ropes") {
        world.ropes.push(ph::Pendulum {
            px: fd(r, "px", 0.0),
            py: fd(r, "py", 0.0),
            len: fd(r, "len", 0.0),
            amp: fd(r, "amp", 0.0),
            period: fd(r, "period", 1.0),
        });
    }
    world.min_y = w.get("bounds").and_then(|b| f(b, "minY"));
    PWorld { world, ids, movers }
}

fn mode_name(m: ph::Mode) -> &'static str {
    match m {
        ph::Mode::Ground => "ground",
        ph::Mode::Air => "air",
        ph::Mode::Climb => "climb",
        ph::Mode::Swing => "swing",
        ph::Mode::Dead => "dead",
    }
}

fn opt_idx(o: Option<usize>) -> Value {
    o.map_or(Value::Null, |i| json!(i))
}

fn snap_body(bd: &ph::Body, ids: &[Option<String>]) -> Value {
    json!({
        "x": bd.x, "y": bd.y, "vx": bd.vx, "vy": bd.vy, "face": bd.face, "mode": mode_name(bd.mode), "layer": bd.layer,
        "landed": bd.landed, "onPlatform": bd.on_platform.and_then(|i| ids[i].clone()), "grabCd": bd.grab_cd,
        "swingK": bd.swing_k, "offX": bd.off_x, "offY": bd.off_y, "t": bd.t, "deathKind": bd.death_kind,
        "rope": opt_idx(bd.rope), "ladder": opt_idx(bd.ladder),
    })
}

fn extra_json(e: &ph::Extra, ids: &[Option<String>]) -> Value {
    match e {
        ph::Extra::None => Value::Null,
        ph::Extra::Platform(i) => json!({ "platform": ids[*i] }),
        ph::Extra::Pit(i) => json!({ "pit": i }),
        ph::Extra::Ladder(i) => json!({ "ladder": i }),
        ph::Extra::Tip { x, y, a } => json!({ "x": x, "y": y, "a": a }),
        ph::Extra::Text(t) => json!(t),
    }
}

fn run_physics(i: &Value) -> Value {
    let cfg = make_cfg(i.get("cfg"));
    match i["op"].as_str().unwrap() {
        "ranges" => json!({ "jumpRange": ph::jump_range(&cfg), "jumpHeight": ph::jump_height(&cfg) }),
        "pendulum" => {
            let r = i["rope"].clone();
            let p = ph::Pendulum {
                px: fd(&r, "px", 0.0),
                py: fd(&r, "py", 0.0),
                len: fd(&r, "len", 0.0),
                amp: fd(&r, "amp", 0.0),
                period: fd(&r, "period", 1.0),
            };
            let samples: Vec<Value> = arr(i, "ts")
                .iter()
                .map(|t| {
                    let t = t.as_f64().unwrap();
                    let (tip, tv) = (p.tip(t), p.tip_vel(t));
                    json!({ "angle": p.angle(t), "tip": { "x": tip.x, "y": tip.y, "a": tip.a }, "tipVel": { "x": tv.0, "y": tv.1 } })
                })
                .collect();
            json!({ "samples": samples })
        }
        "moving" => {
            let mut m = moving_from(&i["platform"]);
            let fr = |m: &ph::MovingPlatform| json!({ "x": m.x, "y": m.y, "dx": m.dx, "dy": m.dy, "t": m.t });
            let mut frames = vec![fr(&m)];
            for _ in 0..i["ticks"].as_u64().unwrap() {
                m.update(i["dt"].as_f64().unwrap());
                frames.push(fr(&m));
            }
            json!({ "frames": frames })
        }
        "support" => {
            let pw = build_world(&i["world"]);
            let pits: Vec<Value> =
                arr(i, "pitAt").iter().map(|x| opt_idx(ph::pit_at(&pw.world, x.as_f64().unwrap()))).collect();
            let lads: Vec<Value> = arr(i, "ladderAt")
                .iter()
                .map(|p| opt_idx(ph::ladder_at(&pw.world, p[0].as_f64().unwrap(), p[1].as_f64().unwrap())))
                .collect();
            let sup: Vec<Value> = arr(i, "supportAt")
                .iter()
                .map(|p| match ph::support_at(&pw.world, p[0].as_f64().unwrap(), p[1].as_f64().unwrap()) {
                    Some(su) => json!({ "y": su.y, "platform": su.platform.and_then(|k| pw.ids[k].clone()) }),
                    None => Value::Null,
                })
                .collect();
            json!({ "pitAt": pits, "ladderAt": lads, "supportAt": sup })
        }
        "edge" => {
            let results: Vec<Value> = arr(i, "cases")
                .iter()
                .map(|c| {
                    let mut bd = ph::Body::new(fd(&c["body"], "x", 0.0), 0.0);
                    bd.mode = match s(&c["body"], "mode").as_deref() {
                        Some("air") => ph::Mode::Air,
                        Some("climb") => ph::Mode::Climb,
                        Some("swing") => ph::Mode::Swing,
                        Some("dead") => ph::Mode::Dead,
                        _ => ph::Mode::Ground,
                    };
                    let cf = make_cfg(c.get("cfg"));
                    let (idx, count) = (c["idx"].as_i64().unwrap(), c["count"].as_i64().unwrap());
                    let tr = ph::edge_transition(&bd, idx, count, &cf)
                        .map_or(Value::Null, |t| json!({ "dir": t.dir, "idx": t.idx, "x": t.x }));
                    json!({ "wrapIndex": ph::wrap_index(idx, count), "tr": tr })
                })
                .collect();
            json!({ "results": results })
        }
        "sim" => {
            let mut pw = build_world(&i["world"]);
            let mut bd = ph::Body::new(fd(&i["body"], "x", 0.0), fd(&i["body"], "y", 0.0));
            if let Some(set) = i["body"].get("set") {
                if let Some(m) = s(set, "mode") {
                    bd.mode = match m.as_str() {
                        "air" => ph::Mode::Air,
                        "dead" => ph::Mode::Dead,
                        "climb" => ph::Mode::Climb,
                        "swing" => ph::Mode::Swing,
                        _ => ph::Mode::Ground,
                    };
                }
                bd.vy = fd(set, "vy", bd.vy);
                bd.grab_cd = fd(set, "grabCd", bd.grab_cd);
            }
            let dt = i["dt"].as_f64().unwrap();
            let use_t = b(i, "useWorldT").unwrap_or(false);
            let mut seq = Vec::new();
            for st in arr(i, "script") {
                for _ in 0..st["n"].as_u64().unwrap() {
                    seq.push(ph::Input {
                        dx: fd(st, "dx", 0.0) as i32,
                        dy: fd(st, "dy", 0.0) as i32,
                        jump_pressed: b(st, "jp").unwrap_or(false),
                    });
                }
            }
            let (mut frames, mut events, mut t) = (Vec::new(), Vec::new(), 0.0);
            for (tick, inp) in seq.iter().enumerate() {
                for (idx, m) in pw.movers.iter_mut() {
                    m.update(dt);
                    m.write_to(&mut pw.world.platforms[*idx]);
                }
                if use_t {
                    t += dt;
                    pw.world.t = Some(t);
                }
                let mut ev = Vec::new();
                ph::step_body(&mut bd, *inp, dt, &pw.world, &cfg, &mut ev);
                for e in ev {
                    events.push(json!({ "tick": tick, "name": e.name, "extra": extra_json(&e.extra, &pw.ids) }));
                }
                frames.push(snap_body(&bd, &pw.ids));
            }
            json!({ "frames": frames, "events": events })
        }
        op => panic!("unknown op {op}"),
    }
}

#[test]
fn platformer_physics_vectors() {
    run_file("platformer-physics", run_physics);
}

// ---- hazard-kit --------------------------------------------------------------------------------

fn lethal_from(v: &Value) -> Option<Lethal> {
    match v.as_str() {
        Some("life") => Some(Lethal::Life),
        Some("points") => Some(Lethal::Points),
        _ => None,
    }
}

fn st_from(v: Option<&Value>) -> St {
    let mut st = St::default();
    let Some(Value::Object(m)) = v else { return st };
    for (k, val) in m {
        match k.as_str() {
            "minX" => st.min_x = val.as_f64(),
            "maxX" => st.max_x = val.as_f64(),
            "phase" => st.phase = val.as_f64(),
            "period" => st.period = val.as_f64(),
            "openFrac" => st.open_frac = val.as_f64(),
            "timer" => st.timer = val.as_f64(),
            "said" => st.said = val.as_i64(),
            "last" => st.last = val.as_str().map(String::from),
            "dist" => st.dist = val.as_f64(),
            "baseY" => st.base_y = val.as_f64(),
            "hitT" => st.hit_t = val.as_f64(),
            other => st.extra.push((other.to_string(), val.as_f64().unwrap_or(0.0))),
        }
    }
    st
}

fn props_from(v: &Value) -> Props {
    let mut p = Props {
        x: f(v, "x"),
        y: f(v, "y"),
        w: f(v, "w"),
        h: f(v, "h"),
        vx: f(v, "vx"),
        t: f(v, "t"),
        ..Props::default()
    };
    if let Some(l) = v.get("lethal") {
        p.lethal = Some(lethal_from(l));
    }
    p.solid_top = b(v, "solidTop");
    p.dead = b(v, "dead");
    p.layer = s(v, "layer");
    p.dir = f(v, "dir");
    p.speed = f(v, "speed");
    p.points = f(v, "points");
    p.collect = b(v, "collect");
    p.top_y = f(v, "topY");
    p.st = st_from(v.get("st"));
    p
}

fn behaviour_from(pattern: &str, p: &Value) -> Box<dyn Behaviour> {
    let lethal = |key: &str, d: Option<Lethal>| p.get(key).map_or(d, lethal_from);
    match pattern {
        "patroller" => {
            let d = Patroller::default();
            Box::new(Patroller {
                w: fd(p, "w", d.w),
                h: fd(p, "h", d.h),
                speed: fd(p, "speed", d.speed),
                min_x: fd(p, "minX", d.min_x),
                max_x: fd(p, "maxX", d.max_x),
                lethal: lethal("lethal", d.lethal),
                frame_px: fd(p, "framePx", d.frame_px),
                frames: fd(p, "frames", d.frames as f64) as i64,
            })
        }
        "roller" => {
            let d = Roller::default();
            Box::new(Roller {
                w: fd(p, "w", d.w),
                h: fd(p, "h", d.h),
                speed: fd(p, "speed", d.speed),
                lethal: lethal("lethal", d.lethal),
                frame_px: fd(p, "framePx", d.frame_px),
                frames: fd(p, "frames", d.frames as f64) as i64,
                hop: p.get("hop").filter(|h| h.is_object()).map(|h| Hop {
                    period: fd(h, "period", 1.0),
                    len: fd(h, "len", 0.0),
                    height: fd(h, "height", 0.0),
                }),
                width: fd(p, "width", d.width),
            })
        }
        "stationary" => {
            let d = Stationary::default();
            Box::new(Stationary {
                w: fd(p, "w", d.w),
                h: fd(p, "h", d.h),
                lethal: lethal("lethal", d.lethal),
                frames: fd(p, "frames", d.frames as f64) as i64,
                fps: fd(p, "fps", d.fps),
            })
        }
        "cycler" => {
            let d = Cycler::default();
            Box::new(Cycler {
                w: fd(p, "w", d.w),
                h: fd(p, "h", d.h),
                period: fd(p, "period", d.period),
                open_frac: fd(p, "openFrac", d.open_frac),
                open_lethal: lethal("openLethal", d.open_lethal),
                closed_solid: b(p, "closedSolid").unwrap_or(d.closed_solid),
            })
        }
        "spawner" => Box::new(Spawner::with_props(
            fd(p, "every", 4.0),
            p["kind"].as_str().unwrap(),
            f(p, "first"),
            p.get("props").map(props_from).unwrap_or_default(),
        )),
        "tauntingBoss" => {
            let d = TauntingBoss::default();
            let tp = p.get("throwProps").map(props_from).unwrap_or_default();
            Box::new(TauntingBoss {
                every: fd(p, "every", d.every),
                taunts: p
                    .get("taunts")
                    .and_then(Value::as_array)
                    .map_or(d.taunts, |a| a.iter().map(|t| t.as_str().unwrap().to_string()).collect()),
                dur: fd(p, "dur", d.dur),
                throw_kind: s(p, "throwKind"),
                throw_props: Box::new(move |_| tp.clone()),
                sfx: s(p, "sfx"),
            })
        }
        "faulty" => Box::new(Faulty),
        other => panic!("pattern {other}"),
    }
}

/// Fixture for autopilot `trajectory`: a behaviour whose update always fails.
struct Faulty;
impl Behaviour for Faulty {
    fn update(&self, _e: &mut Entity, _dt: f64, _g: &mut Ctx) {
        panic!("boom");
    }
}

fn make_reg(kinds: &Value) -> Registry {
    let mut reg = Registry::new();
    for (name, k) in kinds.as_object().unwrap() {
        let params = k.get("params").cloned().unwrap_or(json!({}));
        let defaults = k.get("defaults").map(props_from).unwrap_or_default();
        reg.register(name, behaviour_from(k["pattern"].as_str().unwrap(), &params), defaults);
    }
    reg
}

fn st_json(st: &St) -> Value {
    let mut m = Map::new();
    macro_rules! put {
        ($($f:ident => $k:literal),*) => { $( if let Some(v) = &st.$f { m.insert($k.to_string(), json!(v)); } )* };
    }
    put!(min_x => "minX", max_x => "maxX", phase => "phase", period => "period", open_frac => "openFrac", timer => "timer",
         said => "said", last => "last", dist => "dist", base_y => "baseY", hit_t => "hitT");
    for (k, v) in &st.extra {
        m.insert(k.clone(), json!(v));
    }
    Value::Object(m)
}

fn ent_json(e: &Entity) -> Value {
    let mut m = Map::new();
    m.insert("id".into(), json!(e.id));
    m.insert("kind".into(), json!(e.kind));
    for (k, v) in [("x", e.x), ("y", e.y), ("w", e.w), ("h", e.h), ("vx", e.vx), ("t", e.t)] {
        m.insert(k.into(), json!(v));
    }
    m.insert("frame".into(), json!(e.frame));
    m.insert(
        "lethal".into(),
        match e.lethal {
            Some(Lethal::Life) => json!("life"),
            Some(Lethal::Points) => json!("points"),
            None => Value::Null,
        },
    );
    m.insert("solidTop".into(), json!(e.solid_top));
    m.insert("dead".into(), json!(e.dead));
    m.insert("layer".into(), json!(e.layer));
    for (k, v) in [("dir", e.dir), ("speed", e.speed), ("points", e.points), ("topY", e.top_y)] {
        if let Some(v) = v {
            m.insert(k.into(), json!(v));
        }
    }
    if let Some(o) = e.open {
        m.insert("open".into(), json!(o));
    }
    if let Some(c) = e.collect {
        m.insert("collect".into(), json!(c));
    }
    m.insert("st".into(), st_json(&e.st));
    Value::Object(m)
}

fn run_hazard(i: &Value) -> Value {
    match i["op"].as_str().unwrap() {
        "overlaps" => {
            let results: Vec<Value> = arr(i, "cases")
                .iter()
                .map(|c| {
                    let mut e = Entity::new(0, "box");
                    (e.x, e.y, e.w, e.h) =
                        (fd(&c["e"], "x", 0.0), fd(&c["e"], "y", 0.0), fd(&c["e"], "w", 8.0), fd(&c["e"], "h", 8.0));
                    json!(overlaps(
                        fd(&c["p"], "x", 0.0),
                        fd(&c["p"], "y", 0.0),
                        fd(c, "hw", 0.0),
                        fd(c, "hh", 0.0),
                        &e
                    ))
                })
                .collect();
            json!({ "results": results })
        }
        "sim" => {
            let mut reg = make_reg(&i["kinds"]);
            let mut g = Ctx::default();
            if !b(i, "noRng").unwrap_or(false) {
                if let Some(seed) = i.get("rngSeed").filter(|v| !v.is_null()) {
                    g.rng = Some(pcg_from(seed));
                }
            }
            let mut ents: Vec<Entity> = Vec::new();
            for sp in arr(i, "entities") {
                let e = reg
                    .spawn(sp["kind"].as_str().unwrap(), &sp.get("props").map(props_from).unwrap_or_default(), &mut g)
                    .unwrap();
                ents.push(e);
            }
            let dt = i["dt"].as_f64().unwrap();
            let mut frames = vec![json!(ents.iter().map(ent_json).collect::<Vec<_>>())];
            let mut events = Vec::new();
            for tick in 1..=i["ticks"].as_u64().unwrap() {
                reg.update(&mut ents, dt, &mut g).unwrap();
                for ev in std::mem::take(&mut g.events) {
                    events.push(match ev {
                        Event::Taunt { text, dur, ent } => {
                            json!({ "tick": tick, "name": "taunt", "data": { "text": text, "dur": dur, "ent": ent } })
                        }
                        Event::Sfx { name } => json!({ "tick": tick, "name": "sfx", "data": { "name": name } }),
                    });
                }
                frames.push(json!(ents.iter().map(ent_json).collect::<Vec<_>>()));
            }
            json!({ "frames": frames, "events": events, "count": ents.len() })
        }
        "contacts" => {
            let mut reg = make_reg(&i["kinds"]);
            let mut g0 = Ctx::default();
            let mut ents: Vec<Entity> = arr(i, "entities")
                .iter()
                .map(|sp| {
                    reg.spawn(
                        sp["kind"].as_str().unwrap(),
                        &sp.get("props").map(props_from).unwrap_or_default(),
                        &mut g0,
                    )
                    .unwrap()
                })
                .collect();
            let o = i.get("opts").cloned().unwrap_or(json!({}));
            let opts = ContactOpts {
                hit_w: fd(&o, "hitW", 8.0),
                hit_h: fd(&o, "hitH", 16.0),
                hit_cooldown: fd(&o, "hitCooldown", 0.6),
                points_penalty: f(&o, "pointsPenalty"),
            };
            let steps: Vec<Value> = arr(i, "steps")
                .iter()
                .map(|st| {
                    let g = Ctx { time: f(st, "time"), ..Ctx::default() };
                    let pl = Player { x: fd(&st["player"], "x", 0.0), y: fd(&st["player"], "y", 0.0), layer: s(&st["player"], "layer") };
                    let res = resolve_contacts(&reg, &pl, &mut ents, &opts, &g);
                    json!(res
                        .iter()
                        .map(|c| json!({
                            "type": match c.kind { ContactType::Kill => "kill", ContactType::Points(_) => "points", ContactType::Collect => "collect" },
                            "ent": c.ent, "kind": c.ent_kind,
                            "amount": match c.kind { ContactType::Points(a) => json!(a), _ => Value::Null },
                        }))
                        .collect::<Vec<_>>())
                })
                .collect();
            json!({ "steps": steps, "ents": ents.iter().map(ent_json).collect::<Vec<_>>() })
        }
        "solid" => {
            let mut reg = make_reg(&i["kinds"]);
            let mut g = Ctx::default();
            let ents: Vec<Entity> = arr(i, "entities")
                .iter()
                .map(|sp| {
                    reg.spawn(
                        sp["kind"].as_str().unwrap(),
                        &sp.get("props").map(props_from).unwrap_or_default(),
                        &mut g,
                    )
                    .unwrap()
                })
                .collect();
            let id = |o: Option<usize>| o.map_or(Value::Null, |k| json!(ents[k].id));
            let under: Vec<Value> = arr(i, "under")
                .iter()
                .map(|a| {
                    id(solid_top_under(
                        &ents,
                        a[0].as_f64().unwrap(),
                        a[1].as_f64().unwrap(),
                        a[2].as_f64().unwrap(),
                        a.get(3).and_then(Value::as_f64).unwrap_or(2.0),
                    ))
                })
                .collect();
            let carrying: Vec<Value> = arr(i, "carrying")
                .iter()
                .map(|a| {
                    id(solid_top_carrying(
                        &ents,
                        a[0].as_f64().unwrap(),
                        a[1].as_f64().unwrap(),
                        a.get(2).and_then(Value::as_f64).unwrap_or(2.0),
                    ))
                })
                .collect();
            json!({ "under": under, "carrying": carrying })
        }
        op => panic!("unknown op {op}"),
    }
}

#[test]
fn hazard_kit_vectors() {
    run_file("hazard-kit", run_hazard);
}

// ---- world-gen ---------------------------------------------------------------------------------

fn lerp_from(v: Option<&Value>) -> wg::Lerp {
    match v {
        None | Some(Value::Null) => wg::Lerp::Null,
        Some(Value::Number(n)) => wg::Lerp::Num(n.as_f64().unwrap()),
        Some(o) => wg::Lerp::Obj { from: f(o, "from"), base: f(o, "base"), to: f(o, "to"), per_t: f(o, "perT") },
    }
}

fn val_from(v: &Value) -> wg::Val {
    match v {
        Value::Bool(x) => wg::Val::Bool(*x),
        Value::Number(n) => wg::Val::Num(n.as_f64().unwrap()),
        Value::String(t) => wg::Val::Str(t.clone()),
        _ => wg::Val::Bool(false),
    }
}

fn vals_from(v: Option<&Value>) -> Vec<(String, wg::Val)> {
    v.and_then(Value::as_object).map(|m| m.iter().map(|(k, x)| (k.clone(), val_from(x))).collect()).unwrap_or_default()
}

fn val_json(v: &wg::Val) -> Value {
    match v {
        wg::Val::Bool(x) => json!(x),
        wg::Val::Num(x) => json!(x),
        wg::Val::Str(x) => json!(x),
    }
}

fn rules_from(r: &Value) -> wg::Rules {
    let mut rules = wg::Rules {
        seed: r.get("seed").and_then(Value::as_u64).unwrap_or(1),
        count: r["count"].as_i64().unwrap(),
        start: r.get("start").and_then(Value::as_i64).unwrap_or(0),
        ..wg::Rules::default()
    };
    if let Some(bl) = r.get("blocks") {
        rules.blocks.size = bl.get("size").and_then(Value::as_u64).unwrap_or(12) as usize;
        if let Some(d) = bl.get("deck").and_then(Value::as_array) {
            rules.blocks.deck = d.iter().map(|x| x.as_str().unwrap().to_string()).collect();
        }
        if let Some(fx) = bl.get("fixed").and_then(Value::as_object) {
            rules.blocks.fixed =
                fx.iter().map(|(k, v)| (k.parse().unwrap(), v.as_str().unwrap().to_string())).collect();
        }
        rules.blocks.first_slot = s(bl, "firstSlot");
    }
    if let Some(sp) = r.get("spacing") {
        rules.spacing =
            wg::Spacing { edge_clear: fd(sp, "edgeClear", 36.0), gap: fd(sp, "gap", 48.0), step: fd(sp, "step", 4.0) };
    }
    for (tag, sl) in r["slots"].as_object().unwrap() {
        let mut slot = wg::Slot { set: vals_from(sl.get("set")), ..wg::Slot::default() };
        for pr in arr(sl, "place") {
            let mut rule = wg::PlaceRule {
                chance: pr.get("chance").map_or(wg::Lerp::Num(1.0), |c| lerp_from(Some(c))),
                count: pr.get("count").and_then(Value::as_i64).unwrap_or(1),
                min_t: f(pr, "minT"),
                max_t: f(pr, "maxT"),
                clamp_t: f(pr, "clampT"),
                rolling: s(pr, "mode").as_deref() == Some("rolling"),
                lo: fd(pr, "lo", 0.0),
                hi: fd(pr, "hi", 320.0),
                fixed_x: f(pr, "fixedX"),
                ..wg::PlaceRule::default()
            };
            for k in arr(pr, "kinds") {
                rule.kinds.push(wg::PlaceKind {
                    kind: s(k, "kind").unwrap(),
                    weight: f(k, "weight"),
                    per_t: f(k, "perT"),
                    min_t: f(k, "minT"),
                    max_t: f(k, "maxT"),
                    props: vals_from(k.get("props")),
                });
            }
            slot.place.push(rule);
        }
        if let Some(bd) = sl.get("build").filter(|v| v.is_object()) {
            slot.build = Some(wg::PitBuild {
                chance: bd.get("chance").map_or(wg::Lerp::Num(1.0), |c| lerp_from(Some(c))),
                w: lerp_from(bd.get("w")),
                kind: s(bd, "kind").unwrap_or_else(|| "hole".into()),
                lo: fd(bd, "lo", 60.0),
                hi: fd(bd, "hi", 260.0),
            });
        }
        rules.slots.push((tag.clone(), slot));
    }
    if let Some(c) = r.get("collectibles") {
        let mut col = wg::Collectibles { count: c["count"].as_i64().unwrap(), ..wg::Collectibles::default() };
        col.tiers = arr(c, "tiers").iter().map(|t| (s(t, "type").unwrap(), t["upTo"].as_i64().unwrap())).collect();
        col.exclude = s(c, "exclude");
        col.prefer =
            c.get("prefer").filter(|p| p.is_object()).map(|p| (p["every"].as_i64().unwrap(), s(p, "pitKind").unwrap()));
        if let Some(o) = c.get("offsets").and_then(Value::as_array) {
            col.offsets = o.iter().map(|x| x.as_i64().unwrap()).collect();
        }
        if let Some(xr) = c.get("xRange").and_then(Value::as_array) {
            col.x_range = (xr[0].as_f64().unwrap(), xr[1].as_f64().unwrap());
        }
        col.x_step = fd(c, "xStep", 10.0);
        col.clear = fd(c, "clear", 44.0);
        col.zone_clear = fd(c, "zoneClear", 28.0);
        rules.collectibles = Some(col);
    }
    rules
}

fn screen_json(sc: &wg::Screen) -> Value {
    let mut m = Map::new();
    m.insert("idx".into(), json!(sc.idx));
    m.insert("tag".into(), json!(sc.tag));
    m.insert("t".into(), json!(sc.t));
    m.insert(
        "items".into(),
        json!(sc
            .items
            .iter()
            .map(|it| {
                let mut o = Map::new();
                o.insert("kind".into(), json!(it.kind));
                if let Some(x) = it.x {
                    o.insert("x".into(), json!(x));
                }
                for (k, v) in &it.props {
                    o.insert(k.clone(), val_json(v));
                }
                Value::Object(o)
            })
            .collect::<Vec<_>>()),
    );
    m.insert(
        "zones".into(),
        json!(sc
            .zones
            .iter()
            .map(|z| if z.pit {
                json!({ "x0": z.x0, "x1": z.x1, "pit": true })
            } else {
                json!({ "x0": z.x0, "x1": z.x1 })
            })
            .collect::<Vec<_>>()),
    );
    if let Some(p) = &sc.pit {
        m.insert("pit".into(), json!({ "kind": p.kind, "x0": p.x0, "w": p.w }));
    }
    m.insert(
        "collectible".into(),
        sc.collectible.as_ref().map_or(Value::Null, |c| json!({ "id": c.id, "type": c.kind, "x": c.x })),
    );
    for (k, v) in &sc.extras {
        m.insert(k.clone(), val_json(v));
    }
    Value::Object(m)
}

fn screen_from(v: &Value) -> wg::Screen {
    wg::Screen {
        idx: v["idx"].as_i64().unwrap(),
        tag: s(v, "tag").unwrap_or_default(),
        t: fd(v, "t", 0.0),
        items: arr(v, "items")
            .iter()
            .map(|it| wg::Item { kind: s(it, "kind").unwrap_or_default(), x: f(it, "x"), props: vec![] })
            .collect(),
        zones: arr(v, "zones")
            .iter()
            .map(|z| wg::Zone { x0: fd(z, "x0", 0.0), x1: fd(z, "x1", 0.0), pit: b(z, "pit").unwrap_or(false) })
            .collect(),
        pit: v.get("pit").filter(|p| p.is_object()).map(|p| wg::PitDef {
            kind: s(p, "kind").unwrap_or_default(),
            x0: fd(p, "x0", 0.0),
            w: fd(p, "w", 0.0),
        }),
        collectible: v.get("collectible").filter(|c| c.is_object()).map(|c| wg::CollectibleRef {
            id: c["id"].as_i64().unwrap_or(0),
            kind: s(c, "type").unwrap_or_default(),
            x: fd(c, "x", 0.0),
        }),
        extras: vec![],
    }
}

fn vopts_from(v: Option<&Value>) -> wg::ValidateOpts {
    let mut o = wg::ValidateOpts::default();
    let Some(v) = v else { return o };
    o.edge_clear = f(v, "edgeClear");
    o.gap = f(v, "gap");
    o.collect_clear = f(v, "collectClear");
    o.allow_edge_items = b(v, "allowEdgeItems").unwrap_or(false);
    o.allow_items_near_zones = b(v, "allowItemsNearZones").unwrap_or(false);
    o.rolling_sweeps_collectible = b(v, "rollingSweepsCollectible").unwrap_or(false);
    o.max_hard_run = v.get("maxHardRun").and_then(Value::as_u64).map(|x| x as usize);
    if let Some(max) = v.get("crossable").and_then(|c| f(c, "maxPit")) {
        o.crossable = Some(Box::new(move |d: &wg::Screen| match &d.pit {
            Some(p) if p.w > max => Err(format!("pit {} too wide", p.w)),
            _ => Ok(()),
        }));
    }
    if let Some(tags) = v.get("hard").and_then(|h| h.get("tags")).and_then(Value::as_array) {
        let tags: Vec<String> = tags.iter().map(|t| t.as_str().unwrap().to_string()).collect();
        o.is_hard = Some(Box::new(move |d: &wg::Screen| tags.contains(&d.tag)));
    }
    o
}

fn validation_json(v: &wg::Validation) -> Value {
    json!({
        "ok": v.ok,
        "failures": v.failures.iter().map(|f| json!({ "screen": f.screen, "rule": f.rule, "msg": f.msg })).collect::<Vec<_>>(),
        "stats": { "screens": v.screens, "collectibles": v.collectibles },
    })
}

fn run_worldgen(i: &Value) -> Value {
    let list = |k: &str| arr(i, k).to_vec();
    match i["op"].as_str().unwrap() {
        "helpers" => {
            let n = |v: &Value| v.as_i64().unwrap();
            json!({
                "wrap": list("wrap").iter().map(|a| json!(wg::wrap(n(&a[0]), n(&a[1])))).collect::<Vec<_>>(),
                "circDist": list("circDist").iter().map(|a| json!(wg::circ_dist(n(&a[0]), n(&a[1]), n(&a[2])))).collect::<Vec<_>>(),
                "rampOf": list("rampOf").iter().map(|a| json!(wg::ramp_of(n(&a[0]), n(&a[1]), n(&a[2])))).collect::<Vec<_>>(),
                "lerpVal": list("lerpVal").iter().map(|a| json!(wg::lerp_val(&lerp_from(Some(&a[0])), a[1].as_f64().unwrap()))).collect::<Vec<_>>(),
            })
        }
        "rng" => {
            let mut r = Mulberry32::new(i["seed"].as_i64().unwrap());
            json!({ "values": (0..i["n"].as_u64().unwrap()).map(|_| r.next_float()).collect::<Vec<_>>() })
        }
        "shuffle" => {
            let mut r = Mulberry32::new(i["seed"].as_i64().unwrap());
            let mut items = list("items");
            wg::shuffle(&mut items, &mut r);
            json!({ "values": items })
        }
        "weighted" => {
            let mut r = Mulberry32::new(i["seed"].as_i64().unwrap());
            let items: Vec<(Value, f64)> =
                list("items").iter().map(|p| (p[0].clone(), p[1].as_f64().unwrap())).collect();
            json!({ "values": (0..i["n"].as_u64().unwrap()).map(|_| wg::pick_weighted(&mut r, &items).clone()).collect::<Vec<_>>() })
        }
        "generate" => {
            let rules = rules_from(&i["rules"]);
            let w = wg::generate_world(&rules).unwrap();
            let mut out = json!({
                "world": { "screens": w.screens.iter().map(screen_json).collect::<Vec<_>>(),
                           "collectibles": w.collectibles.iter().map(|c| json!({ "id": c.id, "type": c.kind, "screen": c.screen, "x": c.x })).collect::<Vec<_>>() },
                "deterministic": wg::is_deterministic(&rules),
            });
            if let Some(v) = i.get("validate") {
                out["validation"] = validation_json(&wg::validate_world(&w, &vopts_from(Some(v))));
            }
            out
        }
        "validate" => {
            let w = wg::World {
                screens: arr(&i["world"], "screens").iter().map(screen_from).collect(),
                collectibles: arr(&i["world"], "collectibles")
                    .iter()
                    .map(|c| wg::Collectible {
                        id: c["id"].as_i64().unwrap_or(0),
                        kind: s(c, "type").unwrap_or_default(),
                        screen: c["screen"].as_i64().unwrap(),
                        x: fd(c, "x", 0.0),
                    })
                    .collect(),
            };
            json!({ "validation": validation_json(&wg::validate_world(&w, &vopts_from(i.get("opts")))) })
        }
        op => panic!("unknown op {op}"),
    }
}

#[test]
fn world_gen_vectors() {
    run_file("world-gen", run_worldgen);
}

// ---- autopilot ---------------------------------------------------------------------------------

fn input_json(r: &autopilot::Input) -> Value {
    json!({ "dx": r.dx, "dy": r.dy, "jump": r.jump, "jumpPressed": r.jump_pressed })
}

fn wd_from(o: Option<&Value>) -> Watchdog {
    match o {
        Some(o) => Watchdog::new(fd(o, "limit", 40.0), fd(o, "panicTicks", 90.0) as i64),
        None => Watchdog::default(),
    }
}

/// Per-tick facade for the autopilot vector fixture.
struct Tick {
    key: String,
    time: f64,
    playing: bool,
    can_humanize: bool,
    decide: Option<(i32, i32, bool)>,
}

fn run_autopilot(i: &Value) -> Value {
    match i["op"].as_str().unwrap() {
        "input" => {
            let a = arr(i, "args");
            let g = |k: usize| a.get(k).and_then(Value::as_i64).unwrap_or(0) as i32;
            json!({ "value": input_json(&autopilot::input(g(0), g(1), a.get(2).and_then(Value::as_bool).unwrap_or(false))) })
        }
        "botRng" => {
            let mut r = BotRng::new(i["seed"].as_i64().unwrap() as i32);
            json!({ "values": (0..i["n"].as_u64().unwrap()).map(|_| r.next_float()).collect::<Vec<_>>() })
        }
        "trajectory" => {
            let mut reg = make_reg(&i["kinds"]);
            let mut g = Ctx::default();
            let ents: Vec<Entity> = arr(i, "entities")
                .iter()
                .map(|sp| {
                    reg.spawn(
                        sp["kind"].as_str().unwrap(),
                        &sp.get("props").map(props_from).unwrap_or_default(),
                        &mut g,
                    )
                    .unwrap()
                })
                .collect();
            let frames = autopilot::trajectory(
                &ents,
                |e| e.dead,
                i["n"].as_u64().unwrap() as usize,
                i["dt"].as_f64().unwrap(),
                |e, dt| reg.update_entity(e, dt, &mut Ctx::default()),
                ent_json,
            );
            json!({ "frames": frames })
        }
        "search" => {
            let o = i.get("opts").cloned().unwrap_or(json!({}));
            let opts = SearchOpts {
                count: fd(&o, "count", 30.0) as usize,
                stride: fd(&o, "stride", 3.0) as i64,
                robust_below: fd(&o, "robustBelow", 24.0),
                n_tax: fd(&o, "nTax", 0.004),
            };
            let fams: Vec<Family<(usize, i64)>> = arr(i, "families")
                .iter()
                .enumerate()
                .map(|(fi, fm)| Family { bias: fd(fm, "bias", 0.0), make: Box::new(move |n| (fi, n)) })
                .collect();
            let table = &i["costTable"];
            let r =
                autopilot::search_macros(&fams, |m| table[m.0][(m.1 / opts.stride) as usize].as_f64().unwrap(), &opts);
            json!({ "result": r.map_or(Value::Null, |b| json!({ "cost": b.cost, "family": b.family, "n": b.n, "macro": { "family": b.macro_.0, "n": b.macro_.1 } })) })
        }
        "watchdog" => {
            let mut wd = wd_from(i.get("opts"));
            let steps: Vec<Value> = arr(i, "ticks")
                .iter()
                .enumerate()
                .map(|(k, t)| {
                    let flail = wd.tick(t[0].as_str().unwrap(), t[1].as_f64().unwrap());
                    json!({ "flail": flail, "input": if flail { input_json(&Watchdog::flail(k as i64 + 1)) } else { Value::Null }, "stuck": wd.stuck })
                })
                .collect();
            json!({ "steps": steps })
        }
        "humanize" => {
            let rs = &i["rng"];
            let skill = fd(i, "skill", 1.0);
            let mut h = if s(rs, "kind").as_deref() == Some("pcg32") {
                let mut r = pcg_from(&rs["seed"]);
                Humanizer::new(skill, Box::new(move || r.next_float()))
            } else {
                Humanizer::with_bot_seed(skill, rs["seed"].as_i64().unwrap() as i32)
            };
            let outputs: Vec<Value> = arr(i, "seq")
                .iter()
                .map(|q| {
                    input_json(&h.apply(
                        autopilot::input(fd(q, "dx", 0.0) as i32, fd(q, "dy", 0.0) as i32, b(q, "jp").unwrap_or(false)),
                        b(q, "canAct").unwrap_or(true),
                    ))
                })
                .collect();
            json!({ "outputs": outputs })
        }
        "autopilot" => {
            let cfg = &i["cfg"];
            let mut ap: Autopilot<Tick> = Autopilot::new(
                Box::new(|g: &Tick, _dt| match g.decide {
                    Some((dx, dy, jump)) => Ok(autopilot::input(dx, dy, jump)),
                    None => Err("decide failed".to_string()),
                }),
                Box::new(|g: &Tick| g.key.clone()),
                Box::new(|g: &Tick| g.time),
                fd(cfg, "skill", 1.0),
                cfg.get("seed").and_then(Value::as_i64).unwrap_or(1) as i32,
                wd_from(cfg.get("watchdog")),
            );
            ap.playing = Some(Box::new(|g: &Tick| g.playing));
            ap.can_humanize = Some(Box::new(|g: &Tick| g.can_humanize));
            let outputs: Vec<Value> = arr(i, "ticks")
                .iter()
                .map(|t| {
                    let tick = Tick {
                        key: s(t, "key").unwrap(),
                        time: fd(t, "time", 0.0),
                        playing: b(t, "playing").unwrap_or(true),
                        can_humanize: b(t, "canHumanize").unwrap_or(true),
                        decide: t
                            .get("decide")
                            .filter(|d| d.is_object())
                            .map(|d| (fd(d, "dx", 0.0) as i32, fd(d, "dy", 0.0) as i32, b(d, "jump").unwrap_or(false))),
                    };
                    input_json(&ap.input(&tick, 1.0 / 60.0))
                })
                .collect();
            json!({ "outputs": outputs, "stats": { "errors": ap.stats.errors, "stuck": ap.stats.stuck, "hasError": ap.stats.last_error.is_some() } })
        }
        op => panic!("unknown op {op}"),
    }
}

#[test]
fn autopilot_vectors() {
    run_file("autopilot", run_autopilot);
}

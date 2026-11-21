//! Conformance: every case in `spec/v2/vectors/physics2d.json` (rigid-body `sim` runs and the `character` controller)
//! through `engine::physics2d` (see `spec/v2/physics2d.md`).

mod common;

use common::*;
use engine::collision2d::*;
use engine::physics2d::*;
use serde_json::{json, Value};

fn v2(v: &Value) -> Vec2 {
    Vec2::new(fd(v, "x", 0.0), fd(v, "y", 0.0))
}

fn world_config(c: Option<&Value>) -> WorldConfig {
    let mut cfg = WorldConfig::default();
    let Some(c) = c else { return cfg };
    if let Some(g) = c.get("gravity") {
        cfg.gravity = Vec2::new(fd(g, "x", cfg.gravity.x), fd(g, "y", cfg.gravity.y));
    }
    if let Some(n) = c.get("velocityIterations").and_then(Value::as_u64) {
        cfg.velocity_iterations = n as usize;
    }
    cfg.slop = fd(c, "slop", cfg.slop);
    cfg.baumgarte = fd(c, "baumgarte", cfg.baumgarte);
    cfg.max_bias = fd(c, "maxBias", cfg.max_bias);
    cfg.restitution_threshold = fd(c, "restitutionThreshold", cfg.restitution_threshold);
    cfg.warm_radius = fd(c, "warmRadius", cfg.warm_radius);
    cfg.cell_size = fd(c, "cellSize", cfg.cell_size);
    cfg.sleep = c.get("sleep").and_then(Value::as_bool).unwrap_or(cfg.sleep);
    cfg.ccd = c.get("ccd").and_then(Value::as_bool).unwrap_or(cfg.ccd);
    cfg.time_to_sleep = fd(c, "timeToSleep", cfg.time_to_sleep);
    cfg.linear_sleep = fd(c, "linearSleep", cfg.linear_sleep);
    cfg.angular_sleep = fd(c, "angularSleep", cfg.angular_sleep);
    cfg
}

fn body_def(d: &Value) -> BodyDef {
    let sh = &d["shape"];
    let shape = match sh["type"].as_str().expect("shape type") {
        "circle" => BodyShape::Circle { r: fd(sh, "r", 0.0) },
        "box" => BodyShape::Box { hw: fd(sh, "hw", 0.0), hh: fd(sh, "hh", 0.0) },
        "capsule" => BodyShape::Capsule { hl: fd(sh, "hl", 0.0), r: fd(sh, "r", 0.0) },
        "polygon" => BodyShape::Polygon { points: arr(sh, "points").iter().map(v2).collect() },
        t => panic!("shape {t}"),
    };
    BodyDef {
        kind: d.get("type").and_then(Value::as_str).map(|t| match t {
            "static" => BodyType::Static,
            "kinematic" => BodyType::Kinematic,
            _ => BodyType::Dynamic,
        }),
        x: f(d, "x"),
        y: f(d, "y"),
        angle: f(d, "angle"),
        vx: f(d, "vx"),
        vy: f(d, "vy"),
        w: f(d, "w"),
        shape: Some(shape),
        density: f(d, "density"),
        friction: f(d, "friction"),
        restitution: f(d, "restitution"),
        layer: i32_of(d, "layer"),
        mask: i32_of(d, "mask"),
        sensor: d.get("sensor").and_then(Value::as_bool).unwrap_or(false),
        linear_damping: f(d, "linearDamping"),
        angular_damping: f(d, "angularDamping"),
        gravity_scale: f(d, "gravityScale"),
        fixed_rotation: d.get("fixedRotation").and_then(Value::as_bool).unwrap_or(false),
        allow_sleep: d.get("allowSleep").and_then(Value::as_bool),
    }
}

fn joint_def(j: &Value) -> JointDef {
    JointDef {
        kind: j.get("type").and_then(Value::as_str).map(|t| match t {
            "spring" => JointType::Spring,
            "revolute" => JointType::Revolute,
            _ => JointType::Distance,
        }),
        a: j["a"].as_u64().unwrap() as u32,
        b: j["b"].as_u64().unwrap() as u32,
        anchor_a: j.get("anchorA").map(v2),
        anchor_b: j.get("anchorB").map(v2),
        length: f(j, "length"),
        stiffness: f(j, "stiffness"),
        damping: f(j, "damping"),
        collide_connected: j.get("collideConnected").and_then(Value::as_bool).unwrap_or(false),
    }
}

fn event_json(step: usize, e: &Event) -> Value {
    match e {
        Event::Begin { a, b } => json!({ "step": step, "type": "begin", "a": a, "b": b }),
        Event::End { a, b } => json!({ "step": step, "type": "end", "a": a, "b": b }),
        Event::Enter { sensor, other } => json!({ "step": step, "type": "enter", "sensor": sensor, "other": other }),
        Event::Stay { sensor, other } => json!({ "step": step, "type": "stay", "sensor": sensor, "other": other }),
        Event::Exit { sensor, other } => json!({ "step": step, "type": "exit", "sensor": sensor, "other": other }),
    }
}

fn run_sim(i: &Value) -> Value {
    let mut w = World::new(world_config(i.get("config")));
    for d in arr(i, "bodies") {
        w.add_body(&body_def(d)).unwrap();
    }
    for j in arr(i, "joints") {
        w.add_joint(&joint_def(j)).unwrap();
    }
    let steps = i["steps"].as_u64().unwrap() as usize;
    let dt = fd(i, "dt", 1.0 / 60.0);
    let checkpoints: Vec<u64> = match i.get("checkpoints").and_then(Value::as_array) {
        Some(a) => a.iter().map(|x| x.as_u64().unwrap()).collect(),
        None => vec![steps as u64],
    };
    let (mut states, mut events) = (Vec::new(), Vec::new());
    for s in 1..=steps {
        for im in arr(i, "impulses").iter().filter(|m| m["step"].as_u64() == Some(s as u64)) {
            w.apply_impulse(im["id"].as_u64().unwrap() as u32, fd(im, "ix", 0.0), fd(im, "iy", 0.0), None).unwrap();
        }
        for k in arr(i, "kinematic").iter().filter(|m| m["step"].as_u64() == Some(s as u64)) {
            w.kinematic_step(k["id"].as_u64().unwrap() as u32, fd(k, "vx", 0.0), fd(k, "vy", 0.0), fd(k, "w", 0.0))
                .unwrap();
        }
        w.step(dt);
        for e in &w.events {
            events.push(event_json(s, e));
        }
        if checkpoints.contains(&(s as u64)) {
            let bodies: Vec<Value> =
                w.bodies.iter().map(|b| json!({ "id": b.id, "x": b.x, "y": b.y, "angle": b.angle, "vx": b.vx, "vy": b.vy, "w": b.w, "asleep": b.asleep })).collect();
            states.push(json!({ "step": s, "bodies": bodies }));
        }
    }
    let contacts: Vec<Value> =
        w.contacts.iter().map(|c| json!({ "key": c.key, "points": c.points.len(), "jn": c.points.iter().map(|p| p.jn).collect::<Vec<_>>() })).collect();
    json!({ "states": states, "events": events, "contacts": contacts })
}

fn collider_of(c: &Value) -> Collider {
    let mut col = Collider::new(
        Kind::parse(c["kind"].as_str().expect("kind")).expect("known kind"),
        fd(c, "minX", 0.0),
        fd(c, "minY", 0.0),
        fd(c, "maxX", 0.0),
        fd(c, "maxY", 0.0),
    );
    if let Some(s) = c.get("slope") {
        col.slope =
            Some(Slope { x0: fd(s, "x0", 0.0), y0: fd(s, "y0", 0.0), x1: fd(s, "x1", 0.0), y1: fd(s, "y1", 0.0) });
    }
    col.layer = i32_of(c, "layer");
    col.mask = i32_of(c, "mask");
    col.id = f(c, "id");
    col
}

fn tilemap_of(m: &Value) -> Tilemap {
    let tiles =
        m.get("tiles").and_then(Value::as_array).map(|a| a.iter().map(|x| x.as_i64().unwrap() as i32).collect());
    let mut tm = Tilemap::new(
        m["cols"].as_i64().unwrap() as i32,
        m["rows"].as_i64().unwrap() as i32,
        fd(m, "tileSize", 0.0),
        tiles,
    );
    tm.x = fd(m, "x", 0.0);
    tm.y = fd(m, "y", 0.0);
    tm.outside = i32_of(m, "outside").unwrap_or(0);
    tm.one_way_thickness = fd(m, "oneWayThickness", 4.0);
    tm
}

fn char_config(c: Option<&Value>) -> CharConfig {
    let mut cfg = CharConfig::default();
    let Some(c) = c else { return cfg };
    cfg.gravity = fd(c, "gravity", cfg.gravity);
    cfg.jump_v = fd(c, "jumpV", cfg.jump_v);
    cfg.run_speed = fd(c, "runSpeed", cfg.run_speed);
    cfg.air_speed = fd(c, "airSpeed", cfg.air_speed);
    cfg.air_accel = fd(c, "airAccel", cfg.air_accel);
    cfg.hit_w = fd(c, "hitW", cfg.hit_w);
    cfg.hit_h = fd(c, "hitH", cfg.hit_h);
    cfg.step_height = fd(c, "stepHeight", cfg.step_height);
    cfg.snap_dist = fd(c, "snapDist", cfg.snap_dist);
    cfg.max_fall = fd(c, "maxFall", cfg.max_fall);
    cfg.drop_time = fd(c, "dropTime", cfg.drop_time);
    cfg
}

fn run_character(i: &Value) -> Value {
    let scene: Box<dyn Source> = if let Some(m) = i.get("map").filter(|m| !m.is_null()) {
        Box::new(tilemap_of(m))
    } else {
        Box::new(Scene::new(arr(i, "colliders").iter().map(collider_of).collect(), 32.0))
    };
    let cfg = char_config(i.get("cfg"));
    let bd = &i["body"];
    let mut b = Character::new(fd(bd, "x", 0.0), fd(bd, "y", 0.0));
    match bd.get("mode").and_then(Value::as_str) {
        Some("air") => b.mode = CharMode::Air,
        Some("ground") => b.mode = CharMode::Ground,
        _ => {}
    }
    let (mut step, mut states, mut events) = (0usize, Vec::new(), Vec::new());
    for seg in arr(i, "script") {
        let n = seg["n"].as_u64().unwrap();
        let jp = seg.get("jp").and_then(Value::as_bool).unwrap_or(false);
        for k in 0..n {
            let input =
                CharInput { dx: fd(seg, "dx", 0.0) as i32, dy: fd(seg, "dy", 0.0) as i32, jump_pressed: jp && k == 0 };
            step_character(&mut b, input, 1.0 / 60.0, scene.as_ref(), &cfg, &mut |name, _| {
                events.push(json!({ "n": name, "step": step }))
            });
            step += 1;
        }
        states.push(json!({ "step": step, "x": b.x, "y": b.y, "vx": b.vx, "vy": b.vy, "mode": b.mode.name() }));
    }
    json!({ "states": states, "events": events })
}

fn run(i: &Value) -> Value {
    match i.get("op").and_then(Value::as_str).unwrap_or("sim") {
        "character" => run_character(i),
        _ => run_sim(i),
    }
}

#[test]
fn physics2d_vectors() {
    run_cases("v2", "physics2d", |c| (c["expect"].clone(), run(&c["input"])));
}

#[test]
fn snapshot_restore_replays_bit_identically() {
    let mut w = World::new(WorldConfig::default());
    w.add_body(&BodyDef {
        kind: Some(BodyType::Static),
        y: Some(200.0),
        shape: Some(BodyShape::Box { hw: 400.0, hh: 20.0 }),
        ..Default::default()
    })
    .unwrap();
    w.add_body(&BodyDef {
        y: Some(100.0),
        restitution: Some(0.5),
        shape: Some(BodyShape::Circle { r: 10.0 }),
        ..Default::default()
    })
    .unwrap();
    for _ in 0..30 {
        w.step(1.0 / 60.0);
    }
    let snap = w.snapshot();
    for _ in 0..60 {
        w.step(1.0 / 60.0);
    }
    let end = w.bodies.iter().map(|b| (b.x, b.y, b.vx, b.vy)).collect::<Vec<_>>();
    w.restore(&snap);
    for _ in 0..60 {
        w.step(1.0 / 60.0);
    }
    assert_eq!(end, w.bodies.iter().map(|b| (b.x, b.y, b.vx, b.vy)).collect::<Vec<_>>());
}

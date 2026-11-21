//! Conformance: every case in `spec/v2/vectors/collision2d.json` through `engine::collision2d` (see `spec/v2/collision2d.md`).

mod common;

use common::*;
use engine::collision2d::*;
use serde_json::{json, Map, Value};

pub fn vec2_json(v: Vec2) -> Value {
    json!({ "x": v.x, "y": v.y })
}

pub fn shape_of(v: &Value) -> Shape {
    let (x, y) = (fd(v, "x", 0.0), fd(v, "y", 0.0));
    let angle = fd(v, "angle", 0.0);
    match v["type"].as_str().expect("shape type") {
        "aabb" => Shape::aabb(x, y, fd(v, "hw", 0.0), fd(v, "hh", 0.0)),
        "circle" => Shape::circle(x, y, fd(v, "r", 0.0)),
        "obb" => Shape::obb(x, y, fd(v, "hw", 0.0), fd(v, "hh", 0.0), angle),
        "polygon" => Shape::polygon(
            x,
            y,
            arr(v, "points").iter().map(|p| Vec2::new(fd(p, "x", 0.0), fd(p, "y", 0.0))).collect(),
            angle,
        ),
        "capsule" => Shape::capsule(x, y, fd(v, "hl", 0.0), fd(v, "r", 0.0), angle),
        t => panic!("unknown shape type {t}"),
    }
}

fn aabb_of(v: &Value) -> Aabb {
    Aabb { x: fd(v, "x", 0.0), y: fd(v, "y", 0.0), hw: fd(v, "hw", 0.0), hh: fd(v, "hh", 0.0) }
}

pub fn bounds_of(v: &Value) -> Bounds {
    Bounds {
        min_x: fd(v, "minX", 0.0),
        min_y: fd(v, "minY", 0.0),
        max_x: fd(v, "maxX", 0.0),
        max_y: fd(v, "maxY", 0.0),
    }
}

fn manifold_json(m: Option<Manifold>) -> Value {
    match m {
        None => Value::Null,
        Some(m) => json!({
            "normal": vec2_json(m.normal),
            "depth": m.depth,
            "points": m.points.iter().map(|p| json!({ "x": p.x, "y": p.y, "depth": p.depth })).collect::<Vec<_>>(),
        }),
    }
}

fn hit_json(h: Option<RayHit>) -> Value {
    match h {
        None => Value::Null,
        Some(h) => json!({ "t": h.t, "x": h.x, "y": h.y, "normal": vec2_json(h.normal), "inside": h.inside }),
    }
}

fn cast_json(h: Option<CastHit>) -> Value {
    match h {
        None => Value::Null,
        Some(h) => json!({ "t": h.t, "normal": vec2_json(h.normal), "x": h.x, "y": h.y, "overlap": h.overlap }),
    }
}

fn id_of(v: &Value) -> Id {
    match v {
        Value::String(s) => Id::Str(s.clone()),
        n => Id::Num(n.as_f64().expect("numeric id")),
    }
}

fn id_json(id: &Id) -> Value {
    match id {
        Id::Num(n) => id_num(*n),
        Id::Str(s) => json!(s),
    }
}

pub fn collider_json(c: &Collider) -> Value {
    let mut m = Map::new();
    m.insert("kind".into(), json!(c.kind.name()));
    m.insert("minX".into(), json!(c.min_x));
    m.insert("minY".into(), json!(c.min_y));
    m.insert("maxX".into(), json!(c.max_x));
    m.insert("maxY".into(), json!(c.max_y));
    if let Some(s) = c.slope {
        m.insert("slope".into(), json!({ "x0": s.x0, "y0": s.y0, "x1": s.x1, "y1": s.y1 }));
    }
    if let Some(v) = c.col {
        m.insert("col".into(), json!(v));
    }
    if let Some(v) = c.row {
        m.insert("row".into(), json!(v));
    }
    if let Some(v) = c.tile {
        m.insert("tile".into(), json!(v));
    }
    Value::Object(m)
}

pub fn tilemap_of(m: &Value) -> Tilemap {
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

fn run(i: &Value) -> Value {
    match i["op"].as_str().expect("op") {
        "collide" => manifold_json(collide(&shape_of(&i["a"]), &shape_of(&i["b"]))),
        "distance" => {
            let d = distance(&shape_of(&i["a"]), &shape_of(&i["b"]));
            json!({
                "distance": d.distance, "overlap": d.overlap, "normal": vec2_json(d.normal),
                "pointA": d.point_a.map_or(Value::Null, vec2_json), "pointB": d.point_b.map_or(Value::Null, vec2_json),
            })
        }
        "contains" => json!(contains_point(&shape_of(&i["shape"]), fd(i, "x", 0.0), fd(i, "y", 0.0))),
        "bounds" => {
            let b = bounds(&shape_of(&i["shape"]));
            json!({ "minX": b.min_x, "minY": b.min_y, "maxX": b.max_x, "maxY": b.max_y })
        }
        "raycast" => hit_json(raycast(
            &shape_of(&i["shape"]),
            fd(i, "ox", 0.0),
            fd(i, "oy", 0.0),
            fd(i, "dx", 0.0),
            fd(i, "dy", 0.0),
            fd(i, "maxT", 1.0),
        )),
        "shapeCast" => {
            cast_json(shape_cast(&shape_of(&i["a"]), fd(i, "dx", 0.0), fd(i, "dy", 0.0), &shape_of(&i["b"])))
        }
        "sweptAABB" => cast_json(swept_aabb(&aabb_of(&i["a"]), fd(i, "dx", 0.0), fd(i, "dy", 0.0), &aabb_of(&i["b"]))),
        "moveAABB" => {
            let boxes: Vec<Aabb> = arr(i, "boxes").iter().map(aabb_of).collect();
            let iters = i.get("iterations").and_then(Value::as_u64).unwrap_or(4) as usize;
            let r = move_aabb(&aabb_of(&i["a"]), fd(i, "dx", 0.0), fd(i, "dy", 0.0), &boxes, iters);
            json!({
                "x": r.x, "y": r.y,
                "hits": r.hits.iter().map(|h| json!({ "index": h.index, "t": h.t, "normal": vec2_json(h.normal) })).collect::<Vec<_>>(),
            })
        }
        "hash" => {
            let mut h = SpatialHash::new(fd(i, "cellSize", 32.0));
            for it in arr(i, "items") {
                h.insert(id_of(&it["id"]), bounds_of(&it["bounds"]), i32_of(it, "layer"), i32_of(it, "mask"));
            }
            for m in arr(i, "moves") {
                h.update(&id_of(&m["id"]), bounds_of(&m["bounds"])).unwrap();
            }
            for r in arr(i, "removes") {
                h.remove(&id_of(r));
            }
            json!({
                "pairs": h.pairs(None).iter().map(|(a, b)| json!([id_json(a), id_json(b)])).collect::<Vec<_>>(),
                "queries": arr(i, "queries").iter().map(|b| Value::Array(h.query(&bounds_of(b)).iter().map(id_json).collect())).collect::<Vec<_>>(),
            })
        }
        "tilemap" => {
            let tm = tilemap_of(&i["map"]);
            json!({
                "queries": arr(i, "queries").iter().map(|b| Value::Array(tm.query(&bounds_of(b)).iter().map(collider_json).collect())).collect::<Vec<_>>(),
                "shapes": arr(i, "shapes").iter().map(|s| {
                    let o = s.get("opts").cloned().unwrap_or(json!({}));
                    let opts = SourceOpts { layer: i32_of(&o, "layer"), mask: i32_of(&o, "mask"), prev_max_y: f(&o, "prevMaxY") };
                    Value::Array(collide_source(&tm, &shape_of(&s["shape"]), &opts).into_iter()
                        .map(|(c, m)| json!({ "col": c.col, "row": c.row, "manifold": manifold_json(Some(m)) })).collect())
                }).collect::<Vec<_>>(),
            })
        }
        op => panic!("unknown collision op {op}"),
    }
}

#[test]
fn collision2d_vectors() {
    run_cases("v2", "collision2d", |c| (c["expect"].clone(), run(&c["input"])));
}

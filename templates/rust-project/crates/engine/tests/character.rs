//! Conformance: every case in `spec/v3/vectors/character.json` through `engine::collision3d` character controller
//! (runner contract: "Character vectors" in `spec/v3/collision3d.md`).

mod common;

use common::*;
use engine::collision3d::*;
use serde_json::{json, Value};

fn v3(v: &Value) -> V3 {
    let a = v.as_array().expect("vec3");
    [a[0].as_f64().unwrap(), a[1].as_f64().unwrap(), a[2].as_f64().unwrap()]
}

fn run(c: &Value) -> (Value, Value) {
    let cfg = &c["cfg"];
    let o = CharacterOpts {
        pos: cfg.get("pos").map(v3),
        radius: cfg["radius"].as_f64(),
        height: cfg["height"].as_f64(),
        step_height: cfg["stepHeight"].as_f64(),
        min_ground_y: cfg["minGroundY"].as_f64(),
        skin: cfg["skin"].as_f64(),
        snap_distance: cfg["snapDistance"].as_f64(),
        max_iterations: cfg["maxIterations"].as_u64().map(|x| x as usize),
    };
    let mut ch = create_character(&o);
    // world = flat soup or {tris, materials}; platform segments translate triangles of a private copy.
    let (wtris, wmats) = match c["world"].as_array() {
        Some(a) => (a.clone(), None),
        None => (
            c["world"]["tris"].as_array().unwrap().clone(),
            c["world"].get("materials").and_then(|m| m.as_array()).map(|m| m.iter().map(|x| x.as_i64()).collect::<Vec<Option<i64>>>()),
        ),
    };
    let mut tris: Vec<f64> = wtris.iter().map(|x| x.as_f64().unwrap()).collect();
    let dt = 1.0 / 60.0;
    let mut vy = 0.0f64;
    let mut trace = Vec::new();
    for seg in c["script"].as_array().unwrap() {
        if let Some(j) = seg["jump"].as_f64() {
            vy = j;
        }
        let n = seg["n"].as_u64().unwrap();
        let fixed = seg.get("vel").map(v3);
        for _ in 0..n {
            let vel = match fixed {
                Some(v) => v,
                None => {
                    vy = if ch.grounded && vy <= 0.0 { 0.0 } else { vy - 20.0 * dt };
                    [seg["dx"].as_f64().unwrap_or(0.0), vy, seg["dz"].as_f64().unwrap_or(0.0)]
                }
            };
            if let Some(pf) = seg.get("platform") {
                let (from, count, pv) = (pf["from"].as_u64().unwrap() as usize, pf["count"].as_u64().unwrap() as usize, v3(&pf["velocity"]));
                for t in from..from + count {
                    for k in 0..9 {
                        tris[t * 9 + k] += pv[k % 3] * dt;
                    }
                }
                ch.ground_velocity = pv;
            } else {
                ch.ground_velocity = [0.0, 0.0, 0.0];
            }
            let mut world = World::new(&tris);
            world.materials = wmats.as_deref();
            move_and_slide(&mut ch, vel, dt, &world);
            if fixed.is_none() && ch.grounded && vy <= 0.0 {
                vy = 0.0;
            }
            trace.push(json!([ch.pos[0], ch.pos[1], ch.pos[2], if ch.grounded { 1 } else { 0 }]));
        }
    }
    let mut fin = json!({ "pos": ch.pos, "vel": ch.vel, "grounded": ch.grounded, "groundNormal": ch.ground_normal });
    if c["reportGround"].as_bool().unwrap_or(false) {
        fin["groundIndex"] = json!(ch.ground_index);
        fin["groundMaterial"] = json!(ch.ground_material);
    }
    let actual = json!({ "trace": trace, "final": fin });
    (c["expected"].clone(), actual)
}

#[test]
fn character_vectors() {
    run_cases("v3", "character", run);
}

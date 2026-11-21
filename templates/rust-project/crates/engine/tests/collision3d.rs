//! Conformance: every case in `spec/v3/vectors/collision3d.json` through `engine::collision3d` (see `spec/v3/collision3d.md`).
//! The v3 vector files use `{name, op, args, expected}` and an absolute tolerance of 1e-9.

mod common;

use common::*;
use engine::collision3d::*;
use serde_json::{json, Value};

fn v3(v: &Value) -> V3 {
    let a = v.as_array().expect("vec3");
    [a[0].as_f64().unwrap(), a[1].as_f64().unwrap(), a[2].as_f64().unwrap()]
}
fn tri(v: &Value) -> Tri {
    let a = v.as_array().expect("tri");
    [v3(&a[0]), v3(&a[1]), v3(&a[2])]
}
fn flat(v: &Value) -> Vec<f64> {
    v.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()
}
fn con(c: Option<Contact>) -> Value {
    c.map_or(Value::Null, |c| json!({ "normal": c.normal, "depth": c.depth }))
}
fn hit(h: Option<Hit>) -> Value {
    h.map_or(Value::Null, |h| json!({ "t": h.t, "normal": h.normal, "point": h.point }))
}

fn run(op: &str, a: &Value) -> Value {
    match op {
        "sphereSphere" => con(sphere_sphere(
            &Sphere { c: v3(&a["a"]), r: fd(a, "ra", 0.0) },
            &Sphere { c: v3(&a["b"]), r: fd(a, "rb", 0.0) },
        )),
        "sphereAABB" => con(sphere_aabb(
            &Sphere { c: v3(&a["c"]), r: fd(a, "r", 0.0) },
            &Aabb { min: v3(&a["min"]), max: v3(&a["max"]) },
        )),
        "aabbAABB" => con(aabb_aabb(
            &Aabb { min: v3(&a["amin"]), max: v3(&a["amax"]) },
            &Aabb { min: v3(&a["bmin"]), max: v3(&a["bmax"]) },
        )),
        "sphereTriangle" => con(sphere_triangle(&Sphere { c: v3(&a["c"]), r: fd(a, "r", 0.0) }, &tri(&a["tri"]))),
        "capsuleCapsule" => con(capsule_capsule(
            &Capsule { a: v3(&a["a0"]), b: v3(&a["a1"]), r: fd(a, "ra", 0.0) },
            &Capsule { a: v3(&a["b0"]), b: v3(&a["b1"]), r: fd(a, "rb", 0.0) },
        )),
        "capsuleTriangle" => {
            con(capsule_triangle(&Capsule { a: v3(&a["p"]), b: v3(&a["q"]), r: fd(a, "r", 0.0) }, &tri(&a["tri"])))
        }
        "obbOBB" => {
            let quat = |k: &str| {
                let q = flat(&a[k]);
                [q[0], q[1], q[2], q[3]]
            };
            let o1 = obb_from_quat(v3(&a["ac"]), v3(&a["ah"]), quat("aq"));
            let o2 = obb_from_quat(v3(&a["bc"]), v3(&a["bh"]), quat("bq"));
            obb_obb(&o1, &o2).map_or(
                Value::Null,
                |x| json!({ "depth": x.depth, "normalAbs": x.normal.iter().map(|c| c.abs()).collect::<Vec<_>>() }),
            )
        }
        "raySphere" => {
            hit(ray_sphere(v3(&a["o"]), v3(&a["d"]), &Sphere { c: v3(&a["c"]), r: fd(a, "r", 0.0) }, f64::INFINITY))
        }
        "rayAABB" => {
            hit(ray_aabb(v3(&a["o"]), v3(&a["d"]), &Aabb { min: v3(&a["min"]), max: v3(&a["max"]) }, f64::INFINITY))
        }
        "rayTriangle" => ray_triangle(v3(&a["o"]), v3(&a["d"]), &tri(&a["tri"]), 0.0, f64::INFINITY, false)
            .map_or(Value::Null, |h| json!({ "t": h.t, "u": h.u, "v": h.v, "front": h.front })),
        "rayCapsule" => ray_capsule(
            v3(&a["o"]),
            v3(&a["d"]),
            &Capsule { a: v3(&a["p"]), b: v3(&a["q"]), r: fd(a, "r", 0.0) },
            f64::INFINITY,
        )
        .map_or(Value::Null, |h| json!({ "t": h.t, "normal": h.normal })),
        "closestPointTriangle" => {
            let t = tri(&a["tri"]);
            json!({ "p": closest_point_triangle(v3(&a["p"]), t[0], t[1], t[2]) })
        }
        "closestSegSeg" => {
            let x = closest_seg_seg(v3(&a["p1"]), v3(&a["q1"]), v3(&a["p2"]), v3(&a["q2"]));
            json!({ "s": x.s, "t": x.t, "d2": x.d2 })
        }
        "sweepSphere" => {
            let tris = flat(&a["tris"]);
            sweep_sphere(v3(&a["c"]), fd(a, "r", 0.0), v3(&a["d"]), &World::new(&tris))
                .map_or(Value::Null, |h| json!({ "t": h.t, "normal": h.normal, "index": h.index }))
        }
        _ => panic!("unknown collision3d op {op}"),
    }
}

#[test]
fn collision3d_vectors() {
    run_cases("v3", "collision3d", |c| (c["expected"].clone(), run(c["op"].as_str().unwrap(), &c["args"])));
}

#[test]
fn sweep_capsule_hits_floor() {
    let floor = [-10.0, 0.0, -10.0, 10.0, 0.0, -10.0, 0.0, 0.0, 10.0];
    let h = sweep_capsule([0.0, 2.0, 0.0], [0.0, 3.0, 0.0], 0.5, [0.0, -4.0, 0.0], &World::new(&floor)).expect("hit");
    assert!((h.t - 0.375).abs() < 1e-6 && h.normal[1] > 0.99, "{h:?}");
}

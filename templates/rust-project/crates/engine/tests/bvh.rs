//! Conformance: every case in `spec/v3/vectors/bvh.json` through `engine::bvh` (see `spec/v3/bvh.md`): node count, serialized
//! byte length and FNV-1a checksum exact; ray hits, AABB and sphere queries per the case.

mod common;

use common::*;
use engine::bvh::*;
use engine::collision3d::Aabb;
use serde_json::{json, Value};

fn v3(v: &Value) -> [f64; 3] {
    let a = v.as_array().expect("vec3");
    [a[0].as_f64().unwrap(), a[1].as_f64().unwrap(), a[2].as_f64().unwrap()]
}

fn run(c: &Value) -> (Value, Value) {
    let prims: Vec<f64> = c["prims"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
    let opts = BuildOpts { max_leaf_size: c["options"].get("maxLeafSize").and_then(Value::as_u64).map(|n| n as usize) };
    let bvh =
        if c["kind"] == "aabb" { build_aabbs(&prims, opts) } else { build_triangles(&prims, opts) }.expect("build");
    let buf = bvh.serialize();
    let e = &c["expected"];
    // The generator rounds every number to 1e-12, which turns the u32 checksum into a float; compare it exactly as an integer.
    let mut expect = e.clone();
    expect["fnv1a32"] = json!(e["fnv1a32"].as_f64().unwrap().round() as u64);
    let hits: Vec<Value> = e["rays"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            bvh.raycast(v3(&r["o"]), v3(&r["d"]), RayOpts::default())
                .map_or(Value::Null, |h| json!({ "t": h.t, "index": h.index }))
        })
        .collect();
    let bx = &e["queryAABB"]["box"];
    let sp = &e["querySphere"]["sphere"];
    let actual = json!({
        "nodeCount": bvh.node_count(),
        "bytes": buf.len(),
        "fnv1a32": fnv1a32_bytes(&buf),
        "rays": e["rays"],
        "hits": hits,
        "queryAABB": { "box": bx, "indices": bvh.query_aabb(&Aabb { min: v3(&bx["min"]), max: v3(&bx["max"]) }) },
        "querySphere": { "sphere": sp, "indices": bvh.query_sphere(v3(&sp["c"]), sp["r"].as_f64().unwrap()) },
    });
    (expect, actual)
}

#[test]
fn bvh_vectors() {
    run_cases("v3", "bvh", run);
}

#[test]
fn refit_keeps_queries_conservative() {
    let tris: Vec<f64> = (0..20)
        .flat_map(|i| {
            let x = i as f64;
            [x, 0.0, 0.0, x + 1.0, 0.0, 0.0, x, 1.0, 0.0]
        })
        .collect();
    let mut bvh = build_triangles(&tris, BuildOpts::default()).unwrap();
    let moved: Vec<f64> = tris.iter().enumerate().map(|(i, v)| if i % 3 == 2 { v + 5.0 } else { *v }).collect();
    bvh.refit(&moved).unwrap();
    let all = bvh.query_aabb(&Aabb { min: [-1.0, -1.0, 4.0], max: [30.0, 2.0, 6.0] });
    assert_eq!(all.len(), 20);
}

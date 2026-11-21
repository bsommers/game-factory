//! Shared conformance harness for the v2/v3 vector tests (see `spec/README.md`): ints/strings/bools/null compare exactly,
//! floats within 1e-9 (relative 1e-12 above 1e6). The spec dir is found via env `FACTORY_SPEC_DIR` (the `spec` directory),
//! else by searching upward from this crate for `spec/<sub>`.
#![allow(dead_code)]

use serde_json::{json, Value};
use std::path::PathBuf;

/// Directory holding the vector files of a spec subdir (`"v2"` or `"v3"`), e.g. `<spec>/v2/vectors`.
pub fn vectors_dir(sub: &str) -> PathBuf {
    let probe = |spec: PathBuf| -> Option<PathBuf> {
        let d = spec.join(sub).join("vectors");
        d.is_dir().then_some(d)
    };
    if let Ok(d) = std::env::var("FACTORY_SPEC_DIR") {
        let p = PathBuf::from(d);
        for c in [p.clone(), p.join("spec")] {
            if let Some(v) = probe(c) {
                return v;
            }
        }
        panic!("FACTORY_SPEC_DIR={} has no {sub}/vectors", p.display());
    }
    let mut dir = Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    while let Some(d) = dir {
        if let Some(v) = probe(d.join("spec")) {
            return v;
        }
        dir = d.parent().map(PathBuf::from);
    }
    panic!("spec/{sub}/vectors not found above the crate; set FACTORY_SPEC_DIR");
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
pub fn cmp(path: &str, expect: &Value, actual: &Value) -> Result<(), String> {
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

/// Run every case of `<sub>/vectors/<name>.json`. `case_run` maps a case object to `(expect, actual)` so engines whose vector
/// schema differs (v3 uses `args`/`expected`) can adapt. Panics with the first failures; prints the pass count.
pub fn run_cases(sub: &str, name: &str, case_run: impl Fn(&Value) -> (Value, Value)) {
    let path = vectors_dir(sub).join(format!("{name}.json"));
    let doc: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("read vectors")).expect("parse vectors");
    let cases = doc["cases"].as_array().expect("cases");
    let mut failed = Vec::new();
    for c in cases {
        let cname = c["name"].as_str().unwrap_or("?");
        let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| case_run(c)));
        match out {
            Ok((expect, actual)) => {
                if let Err(e) = cmp("", &expect, &actual) {
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

// ---- JSON helpers ----------------------------------------------------------------------------------
pub fn f(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(Value::as_f64)
}
pub fn fd(v: &Value, k: &str, d: f64) -> f64 {
    f(v, k).unwrap_or(d)
}
pub fn i32_of(v: &Value, k: &str) -> Option<i32> {
    v.get(k).and_then(Value::as_i64).map(|x| x as i32)
}
pub fn arr<'a>(v: &'a Value, k: &str) -> &'a [Value] {
    v.get(k).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}
pub fn num(x: f64) -> Value {
    json!(x)
}
/// Integral f64 as a JSON integer (ids), else a float.
pub fn id_num(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() < 9e15 {
        json!(x as i64)
    } else {
        json!(x)
    }
}

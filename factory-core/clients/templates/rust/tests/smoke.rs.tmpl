//! Smoke test against a real `bin/factory serve`; the node test sets FACTORY_URL. Skips (passes with a note) otherwise.
use factory_client::*;

#[test]
fn live_server() {
    let Ok(base) = std::env::var("FACTORY_URL") else {
        eprintln!("SKIP: FACTORY_URL not set (start `bin/factory serve --port 0` and export it)");
        return;
    };
    let c = Client::new(Some(&base)).unwrap();
    assert!(c.capabilities().unwrap().ok);
    let kits = c.kits_list(&KitsListInput::default()).unwrap();
    assert!(kits.ok && kits.data["kits"].is_array());
    let e = c.call("nope.nothing", &serde_json::json!({})).unwrap_err();
    assert_eq!((e.code.as_str(), e.status), (codes::UNKNOWN_CAPABILITY, 404));

    let dir = std::env::temp_dir().join(format!("factory-rs-smoke-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let project = dir.to_string_lossy().to_string();
    let tracked = c.swarm_track(&SwarmTrackInput { project: Some(project.clone()), agent: "rust-smoke".into(), state: "start".into(), message: Some("hello".into()), ..Default::default() });
    assert!(tracked.is_ok(), "{tracked:?}");
    let ev = c.events(&project, None).unwrap().next().expect("an event").expect("ok event");
    assert_eq!(ev.name, "progress");
    let _ = std::fs::remove_dir_all(&dir);
}

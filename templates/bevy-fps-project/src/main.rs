//! Flags: --rt (Solari ray tracing) | --no-rt | --level <n> (skip menu) | --shot <png> (screenshot then exit).
mod core; mod flow; mod level; mod player; mod render; mod ui;
use bevy::prelude::*;
use bevy::render::{settings::{RenderCreation, WgpuSettings}, RenderPlugin as BevyRenderPlugin};
use bevy::solari::SolariPlugins;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let rt = args.iter().any(|a| a == "--rt") && !args.iter().any(|a| a == "--no-rt");
    let mut wgpu = WgpuSettings::default();
    // Solari needs ray-query + acceleration-structure features requested at device creation.
    if rt { wgpu.features |= SolariPlugins::required_wgpu_features(); }
    let mut app = App::new();
    app.add_plugins(DefaultPlugins
        .set(BevyRenderPlugin { render_creation: RenderCreation::Automatic(Box::new(wgpu)), ..default() })
        .set(AssetPlugin { file_path: asset_root(), ..default() })
        .set(WindowPlugin { primary_window: Some(Window { title: "__NAME__".into(), ..default() }), ..default() }));
    app.add_plugins((flow::FlowPlugin, render::RenderPlugin, level::LevelPlugin, player::PlayerPlugin, ui::UiPlugin));
    app.run();
}

/// AssetPlugin resolves relative to the *executable's* dir, not the cwd, so `cargo run` with a
/// shared CARGO_TARGET_DIR cannot find ./assets. Prefer cwd, else the manifest dir baked in at compile time.
fn asset_root() -> String {
    if let Ok(p) = std::env::var("BEVY_ASSET_ROOT") { return format!("{p}/assets"); }
    if std::path::Path::new("assets").is_dir() { "assets".into() } else { concat!(env!("CARGO_MANIFEST_DIR"), "/assets").into() }
}

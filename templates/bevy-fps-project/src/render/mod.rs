//! Render preset: HDR + AgX + bloom + fog, then EITHER Solari ray-traced GI (`--rt`, GPU must support it) OR raster fallback (SSAO + TAA).
//! Every `Camera3d` gets the stack via an observer, so gameplay modules just spawn a plain camera. Cameras with `NoPostFx` are skipped.
//! Solari forces the deferred renderer for the whole app, so SolariPlugins are added ONLY when `--rt` is passed.
use bevy::{
    anti_alias::taa::TemporalAntiAliasing,
    camera::{CameraMainTextureUsages, Exposure, Hdr},
    core_pipeline::tonemapping::Tonemapping,
    pbr::{DistanceFog, FogFalloff, ScreenSpaceAmbientOcclusion, ScreenSpaceAmbientOcclusionQualityLevel},
    post_process::bloom::Bloom,
    prelude::*,
    render::{render_resource::TextureUsages, renderer::RenderDevice, view::screenshot::{save_to_disk, Screenshot}},
    solari::prelude::{SolariLighting, SolariPlugins},
};
use crate::core::*;

#[derive(Component)] pub struct NoPostFx;

/// Per-level atmosphere. Levels may overwrite it after OnEnter(Playing); a default per `LevelId` is installed before `SpawnSet::Level`.
#[derive(Resource, Clone, Debug)]
pub struct LookPreset { pub sun_dir: Vec3, pub sun_color: Color, pub illuminance: f32, pub ambient: Color, pub fog_color: Color, pub fog_density: f32, pub exposure: f32 }
impl Default for LookPreset { fn default() -> Self { Self::for_level(LevelId::One) } }
impl LookPreset {
    pub fn for_level(l: LevelId) -> Self {
        match l {
            LevelId::One => Self { sun_dir: Vec3::new(-0.5, -0.6, -0.4).normalize(), sun_color: Color::srgb(1.0, 0.85, 0.65), illuminance: 28_000.0,
                ambient: Color::srgb(0.7, 0.65, 0.55), fog_color: Color::srgb(0.7, 0.62, 0.5), fog_density: 0.01, exposure: 12.5 },
            LevelId::Two => Self { sun_dir: Vec3::new(0.2, -1.0, 0.1).normalize(), sun_color: Color::srgb(0.6, 0.7, 0.9), illuminance: 800.0,
                ambient: Color::srgb(0.3, 0.35, 0.45), fog_color: Color::srgb(0.08, 0.1, 0.14), fog_density: 0.03, exposure: 8.0 },
        }
    }
}

/// `enabled` = Solari in use. Plugins exist only if `--rt`, so enabled==false after detect means "fell back to raster".
#[derive(Resource, Default)] pub struct RtState { pub enabled: bool }
#[derive(Component)] struct RenderSun;
#[derive(Resource)] struct ShotRequest { path: String, timer: Timer, wall: Timer, taken: bool, exit_timer: Timer }

pub struct RenderPlugin;
impl Plugin for RenderPlugin { fn build(&self, app: &mut App) {
    let args: Vec<String> = std::env::args().collect();
    let want_rt = args.iter().any(|a| a == "--rt") && !args.iter().any(|a| a == "--no-rt");
    if want_rt { app.add_plugins(SolariPlugins); }
    app.insert_resource(RtState { enabled: want_rt }).init_resource::<LookPreset>()
       .insert_resource(GlobalAmbientLight::default())
       .add_observer(attach_camera_stack)
       .add_systems(Startup, detect_rt)
       .add_systems(OnEnter(AppState::Playing), select_preset.before(SpawnSet::Level))
       .add_systems(Update, (ensure_sun, apply_look, sync_rt_cameras).chain());
    if let Some(i) = args.iter().position(|a| a == "--shot") {
        let path = args.get(i + 1).cloned().unwrap_or_else(|| "out/render.png".into());
        app.insert_resource(ShotRequest { path, timer: Timer::from_seconds(3.0, TimerMode::Once), wall: Timer::from_seconds(8.0, TimerMode::Once), taken: false, exit_timer: Timer::from_seconds(1.5, TimerMode::Once) })
           .add_systems(Update, shot_system);
    }
} }

/// Never panic when the GPU lacks ray tracing: warn and stay raster.
fn detect_rt(device: Option<Res<RenderDevice>>, mut rt: ResMut<RtState>) {
    let ok = device.map(|d| d.features().contains(SolariPlugins::required_wgpu_features())).unwrap_or(false);
    if rt.enabled && !ok { warn!("--rt requested but GPU lacks ray-query/acceleration-structure features; using raster"); rt.enabled = false; }
    info!("render: ray tracing {}", if rt.enabled { "ON" } else { "OFF" });
}

fn attach_camera_stack(add: On<Add<Camera3d>>, skip: Query<Has<NoPostFx>>, rt: Res<RtState>, preset: Res<LookPreset>, mut commands: Commands) {
    if skip.get(add.entity).unwrap_or(true) { return; }
    let mut e = commands.entity(add.entity);
    e.insert((Hdr, Msaa::Off, Tonemapping::AgX, Bloom::NATURAL, Exposure { ev100: preset.exposure }, fog_for(&preset)));
    if rt.enabled {
        e.insert((CameraMainTextureUsages::default().with(TextureUsages::STORAGE_BINDING), SolariLighting::default()));
    } else {
        e.insert((ScreenSpaceAmbientOcclusion { quality_level: ScreenSpaceAmbientOcclusionQualityLevel::High, ..default() }, TemporalAntiAliasing::default()));
    }
}

fn fog_for(p: &LookPreset) -> DistanceFog {
    DistanceFog { color: p.fog_color, directional_light_color: p.sun_color.with_alpha(0.4), directional_light_exponent: 30.0, falloff: FogFalloff::ExponentialSquared { density: p.fog_density } }
}
fn select_preset(level: Res<LevelId>, mut preset: ResMut<LookPreset>) { *preset = LookPreset::for_level(*level); }

/// Fallback sun if a level did not spawn a DirectionalLight.
fn ensure_sun(mut commands: Commands, suns: Query<Entity, With<DirectionalLight>>, own: Query<Entity, With<RenderSun>>) {
    if suns.iter().any(|e| !own.contains(e)) { for e in &own { commands.entity(e).despawn(); } }
    else if suns.is_empty() { commands.spawn((RenderSun, DirectionalLight { shadow_maps_enabled: true, ..default() }, Transform::default())); }
}

/// Re-apply the preset when it changes or when suns/cameras appear. The `Local` counts replace `Added<>` filters, which
/// caused B0001 query conflicts when combined with the `&mut` queries below.
fn apply_look(preset: Res<LookPreset>, rt: Res<RtState>, mut suns: Query<(&mut DirectionalLight, &mut Transform)>, mut ambient: ResMut<GlobalAmbientLight>,
    mut cams: Query<(&mut DistanceFog, &mut Exposure), With<Camera3d>>, mut clear: ResMut<ClearColor>, mut seen: Local<(usize, usize)>) {
    let now = (suns.iter().count(), cams.iter().count());
    let fresh = now != *seen; *seen = now;
    if !preset.is_changed() && !fresh && !rt.is_changed() { return; }
    for (mut l, mut t) in &mut suns {
        l.color = preset.sun_color; l.illuminance = preset.illuminance;
        l.shadow_maps_enabled = !rt.enabled; // Solari replaces shadow maps
        *t = Transform::from_translation(t.translation).looking_to(preset.sun_dir, Vec3::Y);
    }
    ambient.color = preset.ambient;
    ambient.brightness = if rt.enabled { 0.0 } else { (preset.illuminance * 0.03).clamp(120.0, 300.0) };
    clear.0 = preset.fog_color;
    for (mut fog, mut exp) in &mut cams { *fog = fog_for(&preset); exp.ev100 = preset.exposure; }
}

fn sync_rt_cameras(rt: Res<RtState>, mut commands: Commands, cams: Query<(Entity, Has<SolariLighting>), (With<Camera3d>, Without<NoPostFx>)>) {
    if !rt.is_changed() { return; }
    for (e, has) in &cams {
        let mut c = commands.entity(e);
        if rt.enabled && !has {
            c.insert((CameraMainTextureUsages::default().with(TextureUsages::STORAGE_BINDING), SolariLighting::default())).remove::<(ScreenSpaceAmbientOcclusion, TemporalAntiAliasing)>();
        } else if !rt.enabled && has {
            c.remove::<SolariLighting>().insert((ScreenSpaceAmbientOcclusion::default(), TemporalAntiAliasing::default()));
        }
    }
}

/// `--shot out.png`: after 3 s of Playing (or 8 s wall clock) save the primary window, wait for the file, exit 0 (or error after 10 s).
fn shot_system(time: Res<Time>, state: Res<State<AppState>>, mut req: ResMut<ShotRequest>, mut commands: Commands, mut exit: MessageWriter<AppExit>) {
    if req.taken {
        req.exit_timer.tick(time.delta());
        if req.exit_timer.is_finished() && std::path::Path::new(&req.path).exists() { exit.write(AppExit::Success); }
        else if req.exit_timer.elapsed_secs() > 10.0 { exit.write(AppExit::error()); }
        return;
    }
    req.wall.tick(time.delta());
    if *state.get() == AppState::Playing { req.timer.tick(time.delta()); }
    if req.timer.is_finished() || req.wall.is_finished() {
        if let Some(p) = std::path::Path::new(&req.path).parent() { let _ = std::fs::create_dir_all(p); }
        commands.spawn(Screenshot::primary_window()).observe(save_to_disk(req.path.clone()));
        req.taken = true;
    }
}

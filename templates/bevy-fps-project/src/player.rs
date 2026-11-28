//! First-person controller: mouse look, WASD + sprint, jump, AABB collision vs `Solid`. The camera is a child of the body;
//! the render module attaches the post stack to any `Camera3d` via an observer, so this module never names render types.
use bevy::input::mouse::AccumulatedMouseMotion;
use bevy::prelude::*;
use bevy::window::{CursorGrabMode, CursorOptions};
use crate::core::*;

const EYE: f32 = 1.6;
const HALF: Vec3 = Vec3::new(0.35, 0.9, 0.35);
const WALK: f32 = 5.0; const SPRINT: f32 = 8.5; const JUMP_V: f32 = 7.5; const GRAVITY: f32 = 22.0; const SENS: f32 = 0.0022;

#[derive(Component, Default)] struct Body { vel: Vec3, yaw: f32, pitch: f32, grounded: bool }
#[derive(Component)] struct PlayerCamera;

pub struct PlayerPlugin;
impl Plugin for PlayerPlugin { fn build(&self, app: &mut App) {
    app.add_systems(OnEnter(AppState::Playing), spawn_player.in_set(SpawnSet::Entities))
       .add_systems(Update, cursor_grab)
       .add_systems(Update, (look, movement, publish_hud).chain().run_if(in_state(AppState::Playing)));
} }

fn spawn_player(mut commands: Commands, spec: Res<LevelSpec>, existing: Query<(), With<Player>>) {
    if !existing.is_empty() { return; }
    commands.spawn((Player, Body::default(), Health { hp: 100.0, max: 100.0 }, Transform::from_translation(spec.player_spawn), Visibility::default()))
        .with_child((PlayerCamera, Camera3d::default(), Projection::Perspective(PerspectiveProjection { fov: 80f32.to_radians(), ..default() }), Transform::from_xyz(0.0, EYE, 0.0)));
}

fn cursor_grab(state: Res<State<AppState>>, mut cursor: Single<&mut CursorOptions>) {
    let grab = *state.get() == AppState::Playing;
    let mode = if grab { CursorGrabMode::Locked } else { CursorGrabMode::None };
    if cursor.grab_mode != mode { cursor.grab_mode = mode; cursor.visible = !grab; }
}

fn look(motion: Res<AccumulatedMouseMotion>, mut p: Query<(&mut Body, &mut Transform), With<Player>>, mut cam: Query<&mut Transform, (With<PlayerCamera>, Without<Player>)>) {
    let Ok((mut b, mut tf)) = p.single_mut() else { return };
    b.yaw -= motion.delta.x * SENS;
    b.pitch = (b.pitch - motion.delta.y * SENS).clamp(-1.5, 1.5);
    tf.rotation = Quat::from_rotation_y(b.yaw);
    if let Ok(mut c) = cam.single_mut() { c.rotation = Quat::from_rotation_x(b.pitch); }
}

fn movement(time: Res<Time>, keys: Res<ButtonInput<KeyCode>>, mut p: Query<(&mut Body, &mut Transform), With<Player>>, solids: Query<(&GlobalTransform, &Solid)>) {
    let Ok((mut b, mut tf)) = p.single_mut() else { return };
    let dt = time.delta_secs().min(0.05);
    let axis = |a: KeyCode, n: KeyCode| keys.pressed(a) as i32 as f32 - keys.pressed(n) as i32 as f32;
    let wish = (tf.rotation * Vec3::new(axis(KeyCode::KeyD, KeyCode::KeyA), 0.0, axis(KeyCode::KeyS, KeyCode::KeyW))).normalize_or_zero();
    let speed = if keys.pressed(KeyCode::ShiftLeft) { SPRINT } else { WALK };
    b.vel.x = wish.x * speed; b.vel.z = wish.z * speed;
    if b.grounded && keys.just_pressed(KeyCode::Space) { b.vel.y = JUMP_V; b.grounded = false; }
    b.vel.y -= GRAVITY * dt;
    b.grounded = false;
    // Axis-separated sweep so the player slides along walls.
    for ax in 0..3 {
        let mut pos = tf.translation; pos[ax] += b.vel[ax] * dt;
        let centre = pos + Vec3::Y * HALF.y;
        let hit = solids.iter().any(|(g, s)| { let d = (centre - g.translation()).abs(); d.x < s.half.x + HALF.x && d.y < s.half.y + HALF.y && d.z < s.half.z + HALF.z });
        if hit { if ax == 1 && b.vel.y < 0.0 { b.grounded = true; } b.vel[ax] = 0.0; } else { tf.translation = pos; }
    }
    if tf.translation.y <= 0.0 { tf.translation.y = 0.0; b.vel.y = b.vel.y.max(0.0); b.grounded = true; }
}

fn publish_hud(q: Query<&Health, With<Player>>, mut hud: ResMut<HealthHud>) {
    if let Ok(h) = q.single() { hud.hp = h.hp; hud.max = h.max; }
}

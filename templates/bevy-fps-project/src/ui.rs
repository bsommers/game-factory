//! Menu / pause / HUD. Reads only snapshot resources from core.rs.
use bevy::prelude::*;
use crate::core::*;

#[derive(Component)] struct ScreenUi;
#[derive(Component)] struct HudText;

pub struct UiPlugin;
impl Plugin for UiPlugin { fn build(&self, app: &mut App) {
    app.add_systems(Update, (boot.run_if(in_state(AppState::Boot)), menu_keys.run_if(in_state(AppState::Menu)), pause_toggle,
            end_keys.run_if(|s: Res<State<AppState>>| matches!(**s, AppState::Won | AppState::Lost)), hud.run_if(in_state(AppState::Playing))))
       .add_systems(OnEnter(AppState::Menu), |c: Commands| screen(c, "__NAME__\n\nPress Enter to start"))
       .add_systems(OnEnter(AppState::Paused), |c: Commands| screen(c, "Paused\n\nEsc to resume"))
       .add_systems(OnEnter(AppState::Won), |c: Commands| screen(c, "You win\n\nEnter for menu"))
       .add_systems(OnEnter(AppState::Lost), |c: Commands| screen(c, "You died\n\nEnter for menu"))
       .add_systems(OnEnter(AppState::Playing), spawn_hud.in_set(SpawnSet::Post))
       .add_systems(OnExit(AppState::Menu), cleanup).add_systems(OnExit(AppState::Paused), cleanup)
       .add_systems(OnExit(AppState::Won), cleanup).add_systems(OnExit(AppState::Lost), cleanup);
} }

/// Fullscreen text with its own 2D camera (no 3D camera exists outside Playing).
fn screen(mut commands: Commands, msg: &str) {
    commands.spawn((Camera2d, ScreenUi));
    commands.spawn((ScreenUi, Node { width: percent(100), height: percent(100), justify_content: JustifyContent::Center, align_items: AlignItems::Center, ..default() },
        children![(Text::new(msg), TextFont { font_size: FontSize::Px(48.0), ..default() }, TextColor(Color::WHITE))]));
}
fn cleanup(mut commands: Commands, q: Query<Entity, With<ScreenUi>>) { for e in &q { commands.entity(e).despawn(); } }
fn boot(time: Res<Time>, mut t: Local<f32>, mut next: ResMut<NextState<AppState>>) { *t += time.delta_secs(); if *t > 0.5 { next.set(AppState::Menu); } }
fn menu_keys(keys: Res<ButtonInput<KeyCode>>, mut next: ResMut<NextState<AppState>>) { if keys.just_pressed(KeyCode::Enter) { next.set(AppState::Playing); } }
fn end_keys(keys: Res<ButtonInput<KeyCode>>, mut next: ResMut<NextState<AppState>>) { if keys.just_pressed(KeyCode::Enter) { next.set(AppState::Menu); } }
fn pause_toggle(keys: Res<ButtonInput<KeyCode>>, state: Res<State<AppState>>, mut next: ResMut<NextState<AppState>>) {
    if !keys.just_pressed(KeyCode::Escape) { return; }
    match state.get() { AppState::Playing => next.set(AppState::Paused), AppState::Paused => next.set(AppState::Playing), _ => {} }
}
fn spawn_hud(mut commands: Commands) {
    commands.spawn((LevelEntity, Node { position_type: PositionType::Absolute, left: px(16), bottom: px(16), ..default() },
        children![(HudText, Text::new("HP"), TextFont { font_size: FontSize::Px(28.0), ..default() }, TextColor(Color::WHITE))]));
}
fn hud(h: Res<HealthHud>, mut q: Query<&mut Text, With<HudText>>) { for mut t in &mut q { t.0 = format!("HP {:.0}/{:.0}", h.hp, h.max); } }

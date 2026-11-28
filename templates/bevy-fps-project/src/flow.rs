//! Integrator: state + level lifecycle. Pause (Playing <-> Paused) must not rebuild the level: see `FreshStart`.
use bevy::prelude::*;
use crate::core::*;

pub struct FlowPlugin;
impl Plugin for FlowPlugin { fn build(&self, app: &mut App) {
    app.init_state::<AppState>().init_resource::<LevelId>().init_resource::<LevelSpec>().init_resource::<HealthHud>()
       .add_message::<DamagePlayer>().add_message::<LevelComplete>().add_message::<PlaySfx>();
    configure_sets(app);
    // `--level <n>` skips the menu (QA screenshots, quick iteration).
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--level") {
        app.insert_resource(LevelId::from_arg(args.get(i + 1).map(String::as_str).unwrap_or("1")));
        app.add_systems(Update, skip_menu.run_if(|s: Res<State<AppState>>| matches!(**s, AppState::Boot | AppState::Menu)));
    }
    app.add_systems(OnEnter(AppState::Menu), teardown)
       .add_systems(OnEnter(AppState::Won), teardown)
       .add_systems(OnEnter(AppState::Lost), teardown)
       .add_systems(OnEnter(AppState::Playing), end_fresh.in_set(SpawnSet::Post))
       .add_systems(Update, advance_level.run_if(in_state(AppState::Playing)));
} }

type Owned = Or<(With<LevelEntity>, With<Player>)>; // extend with Enemy/Pickup markers as modules appear

fn teardown(mut commands: Commands, q: Query<Entity, Owned>, mut fresh: ResMut<FreshStart>, mut spec: ResMut<LevelSpec>) {
    for e in &q { commands.entity(e).try_despawn(); }
    *fresh = FreshStart(true); *spec = LevelSpec::default();
}
fn end_fresh(mut fresh: ResMut<FreshStart>) { fresh.0 = false; }

fn advance_level(mut done: MessageReader<LevelComplete>, mut level: ResMut<LevelId>, mut next: ResMut<NextState<AppState>>,
    mut commands: Commands, q: Query<Entity, Owned>, mut fresh: ResMut<FreshStart>, mut spec: ResMut<LevelSpec>) {
    if done.read().next().is_none() { return; }
    done.clear();
    match level.next() {
        Some(n) => {
            for e in &q { commands.entity(e).try_despawn(); }
            *level = n; *fresh = FreshStart(true); *spec = LevelSpec::default();
            next.set(AppState::Playing); // identity transition re-runs OnEnter(Playing)
        }
        None => next.set(AppState::Won),
    }
}

fn skip_menu(mut next: ResMut<NextState<AppState>>, mut done: Local<bool>) {
    if !*done { *done = true; next.set(AppState::Playing); }
}

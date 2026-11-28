//! Shared contract. Every module depends on this; ONLY the integrator edits it. Agents request changes in their report.
#![allow(dead_code)] // template: contract items are used as modules are added
use bevy::prelude::*;

#[derive(States, Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum AppState { #[default] Boot, Menu, Playing, Paused, Won, Lost }

/// Current level. Add variants + `next()`/`title()` as levels are built.
#[derive(Resource, Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum LevelId { #[default] One, Two }
impl LevelId {
    pub fn next(self) -> Option<LevelId> { match self { LevelId::One => Some(LevelId::Two), LevelId::Two => None } }
    pub fn title(self) -> &'static str { match self { LevelId::One => "Level One", LevelId::Two => "Level Two" } }
    pub fn from_arg(s: &str) -> LevelId { match s { "2" | "two" => LevelId::Two, _ => LevelId::One } }
}

// ---- markers ----
/// Despawned on teardown. Level plugins tag EVERYTHING they spawn with it.
#[derive(Component)] pub struct LevelEntity;
#[derive(Component)] pub struct Player;
#[derive(Component)] pub struct Health { pub hp: f32, pub max: f32 }
/// Axis-aligned static collider (world space half extents).
#[derive(Component, Clone, Copy)] pub struct Solid { pub half: Vec3 }

// ---- cross-module messages (Bevy 0.20: Message / MessageWriter / MessageReader / app.add_message) ----
// Register each with `add_message::<T>()` exactly once, in the module that owns it (flow.rs for these).
#[derive(Message)] pub struct DamagePlayer { pub amount: f32 }
#[derive(Message)] pub struct LevelComplete;
#[derive(Message)] pub struct PlaySfx(pub Sfx);
#[derive(Clone, Copy, Debug)] pub enum Sfx { Shot, Hit, Pickup }

/// Level plugins publish where things go; gameplay modules read it.
#[derive(Resource, Default)]
pub struct LevelSpec { pub player_spawn: Vec3, pub half_extent: f32 }

/// OnEnter(Playing) ordering. Level systems build the world and fill `LevelSpec`; Entities read it; Post is cleanup.
/// Every level system must early-return unless `*level == its LevelId`.
#[derive(SystemSet, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SpawnSet { Level, Entities, Post }

/// HUD snapshots: gameplay modules write, ui reads (keeps ui free of gameplay deps).
#[derive(Resource, Default)] pub struct HealthHud { pub hp: f32, pub max: f32 }

/// True when the next OnEnter(Playing) must build a fresh level (false when resuming from Paused).
/// Without this, Paused -> Playing re-runs every spawn system and duplicates the world.
#[derive(Resource)] pub struct FreshStart(pub bool);
impl Default for FreshStart { fn default() -> Self { FreshStart(true) } }

pub fn configure_sets(app: &mut App) {
    app.init_resource::<FreshStart>().configure_sets(OnEnter(AppState::Playing),
        (SpawnSet::Level, SpawnSet::Entities, SpawnSet::Post).chain().run_if(|f: Res<FreshStart>| f.0));
}

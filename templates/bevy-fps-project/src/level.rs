//! Example level module: builds a floor + a few boxes in `SpawnSet::Level`, tags them `LevelEntity`, fills `LevelSpec`.
//! Copy this per level; guard with `*level == LevelId::X`. Replace flat colors with PBR textures from assets/textures/.
use bevy::prelude::*;
use crate::core::*;

pub struct LevelPlugin;
impl Plugin for LevelPlugin { fn build(&self, app: &mut App) {
    app.add_systems(OnEnter(AppState::Playing), build_level.in_set(SpawnSet::Level));
} }

fn build_level(level: Res<LevelId>, mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>, mut mats: ResMut<Assets<StandardMaterial>>, mut spec: ResMut<LevelSpec>) {
    let tint = match *level { LevelId::One => Color::srgb(0.55, 0.5, 0.4), LevelId::Two => Color::srgb(0.35, 0.4, 0.45) };
    spec.player_spawn = Vec3::new(0.0, 0.0, 8.0);
    spec.half_extent = 40.0;
    commands.spawn((LevelEntity, Mesh3d(meshes.add(Plane3d::default().mesh().size(80.0, 80.0))),
        MeshMaterial3d(mats.add(StandardMaterial { base_color: tint, perceptual_roughness: 0.9, ..default() }))));
    let boxes = [(Vec3::new(-4.0, 1.0, 0.0), Vec3::new(1.0, 1.0, 1.0)), (Vec3::new(5.0, 1.5, -6.0), Vec3::new(1.5, 1.5, 1.5)), (Vec3::new(0.0, 0.5, -12.0), Vec3::new(3.0, 0.5, 0.5))];
    for (pos, half) in boxes {
        commands.spawn((LevelEntity, Solid { half }, Mesh3d(meshes.add(Cuboid::new(half.x * 2.0, half.y * 2.0, half.z * 2.0))),
            MeshMaterial3d(mats.add(StandardMaterial { base_color: Color::srgb(0.6, 0.6, 0.62), metallic: 0.2, perceptual_roughness: 0.6, ..default() })),
            Transform::from_translation(pos)));
    }
}

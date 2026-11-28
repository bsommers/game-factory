//! Deterministic gameplay engines, ported from the game-factory JS libs and verified against `spec/vectors/*.json`.
//!
//! * [`rng`]: PCG32 + FNV-1a seeding, plus the two legacy integer streams (mulberry32, bot) used by world-gen and autopilot.
//! * [`physics`]: fixed-step platformer physics (`platformer-physics`).
//! * [`hazard`]: entity registry, hazard behaviours and contact resolution (`hazard-kit`).
//! * [`worldgen`]: seeded circular screen generator plus the fairness validator (`world-gen`).
//! * [`autopilot`]: watchdog, humanizer, macro search and bot glue (`autopilot-kit`).
//! * [`collision2d`], [`physics2d`]: 2D shapes/SAT/casts/spatial hash/tilemap, rigid bodies, joints and a character controller (v2).
//! * [`collision3d`], [`bvh`]: 3D contacts/rays/sweeps and a deterministic SAH BVH with a serialized GPU layout (v3).
//!
//! Everything is f64 and integer-only RNG, with no clock and no `rand`, so runs are reproducible across platforms
//! (floats are compared with a 1e-9 tolerance by the conformance vectors because libm `sin`/`cos` may differ in the last ulp).
#![forbid(unsafe_code)]

pub mod autopilot;
pub mod bvh;
pub mod collision2d;
pub mod collision3d;
pub mod hazard;
pub mod physics;
pub mod physics2d;
pub mod rng;
pub mod worldgen;

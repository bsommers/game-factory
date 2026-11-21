//! Deterministic gameplay engines, ported from the game-factory JS libs and verified against `spec/vectors/*.json`.
//!
//! * [`rng`]: PCG32 + FNV-1a seeding, plus the two legacy integer streams (mulberry32, bot) used by world-gen and autopilot.
//! * [`physics`]: fixed-step platformer physics (`platformer-physics`).
//! * [`hazard`]: entity registry, hazard behaviours and contact resolution (`hazard-kit`).
//! * [`worldgen`]: seeded circular screen generator plus the fairness validator (`world-gen`).
//! * [`autopilot`]: watchdog, humanizer, macro search and bot glue (`autopilot-kit`).
//!
//! Everything is f64 and integer-only RNG, with no clock and no `rand`, so runs are reproducible across platforms
//! (floats are compared with a 1e-9 tolerance by the conformance vectors because libm `sin`/`cos` may differ in the last ulp).
#![forbid(unsafe_code)]

pub mod autopilot;
pub mod hazard;
pub mod physics;
pub mod rng;
pub mod worldgen;

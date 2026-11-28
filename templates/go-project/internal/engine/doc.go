// Package engine holds the deterministic, stdlib-only game engines shared by every
// game-factory language target. Each file is a port of a JS reference library and
// is verified against the golden vectors in spec/vectors (see vectors_test.go).
//
//	rng.go       PCG32 + FNV-1a seeding, legacy mulberry32 and bot streams (spec/rng.md)
//	physics.go   fixed-step platformer physics     (spec/platformer-physics.md)
//	hazard.go    hazard registry and patterns      (spec/hazard-kit.md)
//	worldgen.go  circular world generator + fairness validator (spec/world-gen.md)
//	autopilot.go look-ahead bot building blocks    (spec/autopilot.md)
//
// All floating point is float64. Nothing here reads the clock or the global math/rand
// source, so a given seed and input sequence reproduces bit for bit.
package engine

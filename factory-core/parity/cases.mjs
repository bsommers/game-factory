// Parity cases: the same JSON (spec/v4/examples/{combat3d,boss3d}) is fed to the JS reference and the GDScript mirror.
// `patch` shallow-merges into the example def (written to scratch files so both runtimes read identical bytes); a dotted
// key like "moves.heavy1.damageType" sets a nested field. `pinned` is a hash the contract pins (spec/v4/combat3d.md).
export const HERO = 'combat3d/hero.json';
export const GHOUL = 'combat3d/enemy-swipe.json';
const DUEL_SCRIPT = { hero: [{ at: 1, action: 'light' }, { at: 2, action: 'light' }, { at: 3, action: 'heavy' }], ghoul: [{ at: 60, action: 'swipe' }, { at: 150, action: 'swipe' }] };

export const COMBAT_CASES = [
  { name: 'duel', summary: 'the shipped duel (hero vs ghoul, seed 7): pinned event-log hash', a: { file: HERO }, b: { file: GHOUL }, frames: 240, distance: 1.4, seed: 7, script: DUEL_SCRIPT, pinned: '6fedb1fe' },
  { name: 'long-combo', summary: '600 frames, chains, cancels, poison rolls (rng)', a: { file: HERO }, b: { file: GHOUL }, frames: 600, distance: 1.4, seed: 7,
    script: { hero: [{ at: 1, action: 'light' }, { at: 2, action: 'light' }, { at: 3, action: 'heavy' }, { at: 100, action: 'light' }, { at: 101, action: 'light' }, { at: 102, action: 'heavy' }, { at: 260, action: 'light' }, { at: 261, action: 'heavy' }],
      ghoul: [{ at: 60, action: 'swipe' }, { at: 150, action: 'swipe' }, { at: 220, action: 'swipe' }, { at: 300, action: 'lunge' }, { at: 400, action: 'swipe' }] } },
  { name: 'block-and-chip', summary: 'held block takes chip damage', a: { file: HERO }, b: { file: GHOUL }, frames: 200, distance: 1.0, seed: 3,
    script: { hero: [{ from: 40, to: 140, block: true }], ghoul: [{ at: 50, action: 'swipe' }, { at: 120, action: 'swipe' }] } },
  { name: 'parry-window', summary: 'block raised just before the hit: parry, then punish', a: { file: HERO }, b: { file: GHOUL }, frames: 200, distance: 1.0, seed: 3,
    script: { hero: [{ from: 74, to: 100, block: true }, { at: 100, action: 'heavy' }], ghoul: [{ at: 60, action: 'swipe' }] } },
  { name: 'evade-iframes', summary: 'roll through a swipe (i-frames)', a: { file: HERO }, b: { file: GHOUL }, frames: 160, distance: 1.0, seed: 5,
    script: { hero: [{ at: 26, action: 'dodge' }], ghoul: [{ at: 10, action: 'swipe' }] } },
  { name: 'armor-trade', summary: 'heavy armor vs guard-break lunge, same-frame trades', a: { file: HERO }, b: { file: GHOUL }, frames: 200, distance: 1.4, seed: 11,
    script: { hero: [{ at: 1, action: 'heavy' }, { at: 80, action: 'heavy' }], ghoul: [{ at: 1, action: 'lunge' }, { at: 70, action: 'lunge' }] } },
  { name: 'guard-break-block', summary: 'blocked guard-break lunge, poise chip, block stun', a: { file: HERO }, b: { file: GHOUL }, frames: 160, distance: 1.0, seed: 4,
    script: { hero: [{ from: 1, to: 120, block: true }], ghoul: [{ at: 1, action: 'lunge' }, { at: 80, action: 'swipe' }] } },
  { name: 'extinguish-expire', summary: 'burn applied then extinguished by a water hit; poison expiry', a: { file: HERO }, b: { file: GHOUL, patch: { 'moves.swipe.onHit': [{ id: 'burn', chance: 1 }, { id: 'poison', chance: 1 }], 'moves.lunge.damageType': 'water', 'moves.lunge.guardBreak': false } }, frames: 420, distance: 1.0, seed: 6,
    script: { ghoul: [{ at: 10, action: 'swipe' }, { at: 90, action: 'lunge' }, { at: 160, action: 'swipe' }] } },
  { name: 'projectile-spit', summary: 'arc projectile with poison status, dot ticks, expiry', a: { file: HERO }, b: { file: GHOUL }, frames: 420, distance: 3, seed: 21,
    script: { ghoul: [{ at: 1, action: 'spit' }, { at: 120, action: 'spit' }], hero: [{ at: 200, action: 'light' }] } },
  { name: 'homing-pierce', summary: 'homing piercing projectile, rotate-toward, hit-set', a: { file: HERO }, b: { file: GHOUL, patch: { 'moves.spit.spawns': [{ frame: 21, offset: [0, 1.2, 0.5], projectile: { kind: 'homing', dir: [0.6, 0.3, 1], speed: 7, radius: 0.3, life: 150, turn: 0.08, pierce: 1, hit: { damage: 6, damageType: 'fire', hitstun: 10, hitstop: 2, poiseDamage: 5, knockback: [0, 0, 1.5], status: [{ id: 'burn', chance: 0.6 }] } } }] } },
    frames: 400, distance: 3.5, seed: 8, script: { ghoul: [{ at: 1, action: 'spit' }, { at: 140, action: 'spit' }] } },
  { name: 'status-burn-slow', summary: 'burn/slow/custom status, extinguish by water, tempo scaling', a: { file: HERO, patch: { 'moves.heavy1.damageType': 'water', 'moves.light1.onHit': [{ id: 'burn', chance: 0.9 }], 'resist.fire': -0.5 } },
    b: { file: GHOUL, patch: { 'moves.swipe.onHit': [{ id: 'burn', chance: 0.8 }, { id: 'slow', chance: 1 }, { id: 'bleed', chance: 0.5 }], 'moves.swipe.damageType': 'fire' } },
    statuses: { bleed: { duration: 90, tickEvery: 15, damage: 1.5, damageType: 'physical', maxStacks: 4, stackMode: 'stack' } }, frames: 500, distance: 1.0, seed: 13,
    script: { ghoul: [{ at: 20, action: 'swipe' }, { at: 90, action: 'swipe' }, { at: 160, action: 'swipe' }, { at: 240, action: 'swipe' }], hero: [{ at: 1, action: 'light' }, { at: 40, action: 'light' }, { at: 41, action: 'heavy' }, { at: 120, action: 'light' }, { at: 200, action: 'light' }, { at: 201, action: 'heavy' }, { at: 300, action: 'light' }, { at: 301, action: 'light' }] } },
  { name: 'kill-and-dot', summary: 'low-hp ghoul dies to a combo; low-hp hero dies to poison', a: { file: HERO, patch: { maxHp: 40 } }, b: { file: GHOUL, patch: { maxHp: 30, 'moves.swipe.onHit': [{ id: 'poison', chance: 1 }] } }, frames: 700, distance: 1.0, seed: 17,
    script: { ghoul: [{ at: 5, action: 'swipe' }, { at: 80, action: 'swipe' }], hero: [{ at: 200, action: 'light' }, { at: 201, action: 'light' }, { at: 202, action: 'heavy' }] } },
  { name: 'poise-stagger-scaling', summary: 'poise break, combo scaling, multihit-free chain', a: { file: HERO, patch: { comboScaling: [1, 0.8, 0.6, 0.4] } }, b: { file: GHOUL, patch: { maxPoise: 20, comboScaling: [1, 0.9] } }, frames: 400, distance: 1.2, seed: 2,
    script: { hero: [{ at: 1, action: 'light' }, { at: 2, action: 'light' }, { at: 3, action: 'heavy' }, { at: 60, action: 'light' }, { at: 61, action: 'light' }, { at: 62, action: 'heavy' }, { at: 120, action: 'light' }, { at: 121, action: 'light' }], ghoul: [{ at: 150, action: 'swipe' }] } },
  { name: 'multihit-long-active', summary: 'multihit move re-hits every N frames while active (hit-set interval)', a: { file: HERO, patch: { 'moves.light1.active': 24, 'moves.light1.multihit': { every: 6 } } }, b: { file: GHOUL }, frames: 200, distance: 1.0, seed: 31,
    script: { hero: [{ at: 1, action: 'light' }], ghoul: [{ at: 120, action: 'swipe' }] } },
  { name: 'bone-fallback-hitbox', summary: 'hitbox/hurtbox naming a bone with no pose falls back to the root transform', a: { file: HERO, patch: { 'moves.light1.hitboxes': [{ id: 'blade', bone: 'hand_r', offset: [0, 1, 0.5], shape: { type: 'sphere', r: 0.3 } }] } }, b: { file: GHOUL, patch: { hurtboxes: [{ id: 'body', bone: 'spine', shape: { type: 'capsule', a: [0, 0.4, 0], b: [0, 1.3, 0], r: 0.45 }, mult: 1 }, { id: 'core', bone: 'chest', offset: [0, 1, 0.25], shape: { type: 'sphere', r: 0.2 }, mult: 2, weak: true }] } }, frames: 160, distance: 1.0, seed: 33,
    script: { hero: [{ at: 1, action: 'light' }, { at: 40, action: 'light' }], ghoul: [{ at: 90, action: 'swipe' }] } },
  { name: 'unblockable-statusonly', summary: 'unblockable swipe through a held block; statusOnly spit applies status without damage', a: { file: HERO }, b: { file: GHOUL, patch: { 'moves.swipe.unblockable': true, 'moves.swipe.onHit': [{ id: 'burn', chance: 1 }], 'moves.lunge.statusOnly': true, 'moves.lunge.onHit': [{ id: 'poison', chance: 1 }] } }, frames: 260, distance: 1.0, seed: 35,
    script: { hero: [{ from: 1, to: 240, block: true }], ghoul: [{ at: 20, action: 'swipe' }, { at: 120, action: 'lunge' }] } },
];

// Boss cases: simulate() determinism hash + per-run log hashes + summary numbers + the head of run 0's event log.
export const BOSS_CASES = [
  { name: 'hydra-default', file: 'boss3d/hydra.json', runs: 3, seed: 1 },
  { name: 'vortex-default', file: 'boss3d/vortex.json', runs: 3, seed: 1 },
  { name: 'hydra-oracle', file: 'boss3d/hydra.json', runs: 3, seed: 7, profile: { reactionMs: 350, dodgeSkill: 1, weakAwareness: 1, hp: 1000 } },
  { name: 'vortex-novice', file: 'boss3d/vortex.json', runs: 3, seed: 5, profile: { reactionMs: 650, dodgeSkill: 0.5, weakAwareness: 0.25, attackIntervalMs: 800, dodgeCooldownMs: 1200 } },
  { name: 'hydra-flaky', file: 'boss3d/hydra.json', runs: 4, seed: 9, profile: { dodgeSkill: 0.4, hp: 400, attackDamage: 6 }, maxSeconds: 120 },
  { name: 'vortex-tanky', file: 'boss3d/vortex.json', runs: 2, seed: 3, profile: { hp: 2000, dodgeSkill: 0.6, attackDamage: 14 }, maxSeconds: 240 },
];

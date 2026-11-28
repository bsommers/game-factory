// Shared definitions (the contract every module imports). Replace/extend per game; keep the names below, tools depend on them.
export const DT = 1 / 60;            // fixed simulation step in seconds (botplay, balance and the browser loop all use it)
export const ART = [];               // art rows {module,name,w,h,frames,kind,desc}; read by the library adapter (empty = none yet)
export const TUNING = Object.freeze({
  playerSpeed: 5,                    // world units / second
  playerHp: 3,
  hitRadius: 0.6,                    // enemy touches player under this distance
  goalRadius: 0.7,
  invuln: 1,                         // seconds of immunity after a hit
});

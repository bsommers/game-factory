//! Portable RNGs (see `spec/rng.md`).
//!
//! * [`Pcg32`]: the spec RNG for everything new (PCG32 XSH-RR 64/32, fixed stream, integer-only).
//! * [`Mulberry32`]: legacy stream hard-coded in JS `world-gen` (`createRng`).
//! * [`BotRng`]: legacy stream hard-coded in JS `autopilot-kit` (`botRng`).

const MULT: u64 = 6364136223846793005;
const INC: u64 = (54 << 1) | 1;

/// FNV-1a 32-bit hash over the UTF-8 bytes of `s`.
pub fn fnv1a32(s: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.bytes() {
        h ^= u32::from(b);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// PCG32 (XSH-RR 64/32).
#[derive(Clone, Debug)]
pub struct Pcg32 {
    state: u64,
}

impl Pcg32 {
    /// Seed from a u32 (numbers are reduced mod 2^32 by the caller).
    pub fn new(seed: u32) -> Self {
        let mut r = Pcg32 { state: 0 };
        r.step();
        r.state = r.state.wrapping_add(u64::from(seed));
        r.step();
        r
    }

    /// Seed from a string via FNV-1a.
    pub fn from_str_seed(s: &str) -> Self {
        Self::new(fnv1a32(s))
    }

    fn step(&mut self) {
        self.state = self.state.wrapping_mul(MULT).wrapping_add(INC);
    }

    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.step();
        let xs = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xs.rotate_right(rot)
    }

    /// Float in [0, 1), exact in f64.
    pub fn next_float(&mut self) -> f64 {
        f64::from(self.next_u32()) / 4_294_967_296.0
    }

    /// Integer in `[a, b]` inclusive, no rejection (span must be <= 2^32).
    pub fn int(&mut self, a: i64, b: i64) -> i64 {
        let span = (b - a + 1) as u64;
        a + ((u64::from(self.next_u32()) * span) >> 32) as i64
    }

    pub fn range(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.next_float()
    }

    pub fn chance(&mut self, p: f64) -> bool {
        self.next_float() < p
    }

    /// Pick an element (slice must be non-empty). One draw.
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        let i = self.int(0, items.len() as i64 - 1) as usize;
        &items[i]
    }

    /// In-place Fisher-Yates; draws `len-1` times (none for len <= 1).
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.int(0, i as i64) as usize;
            items.swap(i, j);
        }
    }
}

/// The shared mulberry-style mixer used by both legacy streams.
fn mix(s: u32) -> u32 {
    let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
    t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
    t ^ (t >> 14)
}

/// Legacy `world-gen` stream (mulberry32).
#[derive(Clone, Debug)]
pub struct Mulberry32 {
    s: u32,
}

impl Mulberry32 {
    /// `seed mod 2^32`, or 1 if that is 0 (JS: `(seed >>> 0) || 1`).
    pub fn new(seed: i64) -> Self {
        let s = seed as u32;
        Mulberry32 { s: if s == 0 { 1 } else { s } }
    }

    pub fn next_float(&mut self) -> f64 {
        self.s = self.s.wrapping_add(0x6D2B_79F5);
        f64::from(mix(self.s)) / 4_294_967_296.0
    }

    /// `a + floor(next * (b - a + 1))`
    pub fn int(&mut self, a: i64, b: i64) -> i64 {
        a + (self.next_float() * (b - a + 1) as f64).floor() as i64
    }

    pub fn range(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.next_float()
    }

    pub fn chance(&mut self, p: f64) -> bool {
        self.next_float() < p
    }

    /// `items[floor(next * len)]`
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        let i = (self.next_float() * items.len() as f64).floor() as usize;
        &items[i]
    }

    /// Fisher-Yates using `int(0, i)` (same draw order as the JS `shuffle`).
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.int(0, i as i64) as usize;
            items.swap(i, j);
        }
    }
}

/// Legacy `autopilot-kit` stream (`botRng`).
#[derive(Clone, Debug)]
pub struct BotRng {
    s: u32,
}

impl BotRng {
    /// JS `seed | 0` (the i32 bit pattern); default seed in JS is 0x9e3779b9.
    pub fn new(seed: i32) -> Self {
        BotRng { s: seed as u32 }
    }

    pub fn next_float(&mut self) -> f64 {
        self.s = self.s.wrapping_add(0x6D2B_79F5);
        f64::from(mix(self.s)) / 4_294_967_296.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcg_known_values() {
        assert_eq!(Pcg32::new(42).next_u32(), 2_707_161_783);
        assert_eq!(fnv1a32("a"), 3_826_002_220);
    }

    #[test]
    fn shuffle_len_edge_cases_do_not_draw() {
        let mut r = Pcg32::new(1);
        let mut v: Vec<u8> = vec![];
        r.shuffle(&mut v);
        let mut one = [9];
        r.shuffle(&mut one);
        assert_eq!(r.next_u32(), Pcg32::new(1).next_u32());
    }
}

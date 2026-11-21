package engine

import "math"

// RNG is the minimal random source the engines need. PCG32, Mulberry32 and BotRNG
// all implement it.
type RNG interface {
	// Float64 returns a float in [0,1).
	Float64() float64
	// Int returns an int in [lo,hi] inclusive.
	Int(lo, hi int) int
}

// ---- PCG32 ------------------------------------------------------------------------------

const (
	pcgMult = 6364136223846793005
	pcgInc  = (54 << 1) | 1
)

// PCG32 is the portable PCG32 (XSH-RR 64/32) generator from spec/rng.md. It is the
// only generator new engine code should use.
type PCG32 struct{ state uint64 }

// NewPCG32 seeds a generator from a 32-bit seed.
func NewPCG32(seed uint32) *PCG32 {
	r := &PCG32{}
	r.step()
	r.state += uint64(seed)
	r.step()
	return r
}

// NewPCG32FromString seeds a generator with FNV1a32 of the UTF-8 bytes of s.
func NewPCG32FromString(s string) *PCG32 { return NewPCG32(FNV1a32(s)) }

func (r *PCG32) step() { r.state = r.state*pcgMult + pcgInc }

// Uint32 returns the next 32-bit output.
func (r *PCG32) Uint32() uint32 {
	old := r.state
	r.step()
	xs := uint32(((old >> 18) ^ old) >> 27)
	rot := uint32(old >> 59)
	return xs>>rot | xs<<((32-rot)&31)
}

// Float64 returns Uint32()/2^32, exact in float64.
func (r *PCG32) Float64() float64 { return float64(r.Uint32()) / 4294967296.0 }

// Int returns lo + (u32*(hi-lo+1))>>32: inclusive, no rejection, one draw. The span must
// be between 1 and 2^32.
func (r *PCG32) Int(lo, hi int) int {
	return lo + int((uint64(r.Uint32())*uint64(hi-lo+1))>>32)
}

// Range returns lo + (hi-lo)*Float64().
func (r *PCG32) Range(lo, hi float64) float64 { return lo + (hi-lo)*r.Float64() }

// Chance reports Float64() < p.
func (r *PCG32) Chance(p float64) bool { return r.Float64() < p }

// Pick returns items[Int(0,len-1)] using one draw. items must be non-empty.
func Pick[T any](r RNG, items []T) T { return items[r.Int(0, len(items)-1)] }

// Shuffle is the spec Fisher-Yates (i from len-1 down to 1, j = Int(0,i)); it draws
// len-1 times and shuffles in place.
func Shuffle[T any](r RNG, items []T) []T {
	for i := len(items) - 1; i > 0; i-- {
		j := r.Int(0, i)
		items[i], items[j] = items[j], items[i]
	}
	return items
}

// FNV1a32 is the 32-bit FNV-1a hash of the UTF-8 bytes of s.
func FNV1a32(s string) uint32 {
	h := uint32(0x811c9dc5)
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 0x01000193
	}
	return h
}

// ---- legacy streams ---------------------------------------------------------------------

// mix32 advances the shared mulberry32 core and returns the 32-bit output.
func mix32(s *uint32) uint32 {
	*s += 0x6D2B79F5
	t := *s
	t = (t ^ t>>15) * (t | 1)
	t ^= t + (t^t>>7)*(t|61)
	return t ^ t>>14
}

// Mulberry32 is the stream hard-coded in the JS world-gen createRng. It is a legacy
// stream kept only so ports reproduce the JS worlds; new code should use PCG32.
type Mulberry32 struct{ s uint32 }

// NewMulberry32 seeds like JS createRng: seed mod 2^32, with 0 mapped to 1.
func NewMulberry32(seed int64) *Mulberry32 {
	s := uint32(seed)
	if s == 0 {
		s = 1
	}
	return &Mulberry32{s: s}
}

// Float64 returns the next value in [0,1).
func (r *Mulberry32) Float64() float64 { return float64(mix32(&r.s)) / 4294967296.0 }

// Int returns lo + floor(Float64()*(hi-lo+1)).
func (r *Mulberry32) Int(lo, hi int) int {
	return lo + int(math.Floor(r.Float64()*float64(hi-lo+1)))
}

// Range returns lo + (hi-lo)*Float64().
func (r *Mulberry32) Range(lo, hi float64) float64 { return lo + (hi-lo)*r.Float64() }

// Chance reports Float64() < p.
func (r *Mulberry32) Chance(p float64) bool { return r.Float64() < p }

// BotRNG is the autopilot-kit botRng stream: the same mixing core as Mulberry32 but
// seeded as an int32 (so seed 0 stays 0).
type BotRNG struct{ s uint32 }

// DefaultBotSeed is the JS botRng default seed.
const DefaultBotSeed = 0x9e3779b9

// NewBotRNG seeds the stream from the low 32 bits of seed.
func NewBotRNG(seed int64) *BotRNG { return &BotRNG{s: uint32(seed)} }

// Float64 returns the next value in [0,1).
func (r *BotRNG) Float64() float64 { return float64(mix32(&r.s)) / 4294967296.0 }

// Int returns lo + floor(Float64()*(hi-lo+1)).
func (r *BotRNG) Int(lo, hi int) int {
	return lo + int(math.Floor(r.Float64()*float64(hi-lo+1)))
}

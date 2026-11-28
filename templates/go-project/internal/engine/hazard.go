package engine

import (
	"fmt"
	"math"
)

// Lethal says what touching an entity does.
type Lethal string

// Lethal values. The empty value means harmless.
const (
	LethalNone   Lethal = ""
	LethalLife   Lethal = "life"
	LethalPoints Lethal = "points"
)

// Entity is a feet-anchored box (X is the centre, Y the bottom) plus pattern state.
// Optional properties that distinguish "absent" from zero (Dir, Speed, Points, TopY)
// are pointers; use Ptr to set them.
type Entity struct {
	ID       int
	Kind     string
	X, Y     float64
	W, H     float64
	VX, T    float64
	Frame    int
	Lethal   Lethal
	SolidTop bool
	Dead     bool
	Layer    string
	Collect  bool
	Points   *float64
	TopY     *float64
	Dir      *float64
	Speed    *float64
	// Open is meaningful when HasOpen (set by Cycler).
	Open, HasOpen bool
	// St is free-form per-entity numeric state ("dist", "timer", "minX", "hitT", ...).
	St map[string]float64
	// LastTaunt is the most recent TauntingBoss line.
	LastTaunt string
}

// Ptr returns a pointer to v, for optional entity properties and rule-table fields.
func Ptr[T any](v T) *T { return &v }

// Clone returns a deep copy (St and pointer fields are copied).
func (e *Entity) Clone() *Entity {
	c := *e
	c.St = make(map[string]float64, len(e.St))
	for k, v := range e.St {
		c.St[k] = v
	}
	cp := func(p *float64) *float64 {
		if p == nil {
			return nil
		}
		v := *p
		return &v
	}
	c.Points, c.TopY, c.Dir, c.Speed = cp(e.Points), cp(e.TopY), cp(e.Dir), cp(e.Speed)
	return &c
}

// Opt mutates an entity at spawn time. Overlay order is base < kind defaults < spawn Opts.
type Opt func(*Entity)

// At places the entity at (x,y).
func At(x, y float64) Opt { return func(e *Entity) { e.X, e.Y = x, y } }

// WithDir sets the direction (patroller: 1 or anything else meaning -1).
func WithDir(d float64) Opt { return func(e *Entity) { e.Dir = Ptr(d) } }

// WithSpeed overrides the pattern speed for this entity.
func WithSpeed(s float64) Opt { return func(e *Entity) { e.Speed = Ptr(s) } }

// WithSt presets one St value (for example "phase" or "minX").
func WithSt(key string, v float64) Opt { return func(e *Entity) { e.St[key] = v } }

// Player is the feet-anchored player box used for contacts. Layer "" matches any layer.
type Player struct {
	X, Y  float64
	Layer string
}

// EmitEvent is delivered to Game.Emit. Name "taunt" fills Text, Dur and Ent; "sfx" fills SFX.
type EmitEvent struct {
	Name string
	Text string
	Dur  float64
	Ent  *Entity
	SFX  string
}

// Game is the facade the behaviours use. Every field is optional.
type Game struct {
	// Spawn creates and registers an entity (the caller appends it to the live list).
	Spawn func(kind string, opts ...Opt) *Entity
	// RNG should be a spec PCG32 for reproducible taunts; nil falls back to cycling.
	RNG   RNG
	Emit  func(EmitEvent)
	Width float64
	// Time is the game clock for contact cooldowns when HasTime; otherwise Entity.T is used.
	Time    float64
	HasTime bool
}

// Behaviour drives one entity kind.
type Behaviour interface {
	Init(e *Entity, g *Game)
	Update(e *Entity, dt float64, g *Game)
}

// Toucher is an optional Behaviour extension. A non-nil result replaces the default
// contact resolution for that entity.
type Toucher interface {
	OnTouch(e *Entity, p Player, g *Game) *Contact
}

type kindDef struct {
	b        Behaviour
	defaults []Opt
}

// Registry maps kinds to behaviours and hands out entity ids starting at 1.
type Registry struct {
	defs   map[string]kindDef
	nextID int
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return &Registry{defs: map[string]kindDef{}, nextID: 1} }

// Register adds (or replaces) a kind. defaults overlay the base entity before spawn Opts.
func (r *Registry) Register(kind string, b Behaviour, defaults ...Opt) *Registry {
	r.defs[kind] = kindDef{b: b, defaults: defaults}
	return r
}

// Has reports whether kind is registered.
func (r *Registry) Has(kind string) bool { _, ok := r.defs[kind]; return ok }

// Reset restarts the id counter at 1.
func (r *Registry) Reset() { r.nextID = 1 }

// Spawn makes an entity (calls Behaviour.Init after construction). The caller stores it.
func (r *Registry) Spawn(kind string, g *Game, opts ...Opt) (*Entity, error) {
	d, ok := r.defs[kind]
	if !ok {
		return nil, fmt.Errorf("hazard-kit: unknown kind %s", kind)
	}
	e := &Entity{ID: r.nextID, Kind: kind, W: 8, H: 8, Layer: "surface", St: map[string]float64{}}
	r.nextID++
	for _, o := range d.defaults {
		o(e)
	}
	for _, o := range opts {
		o(e)
	}
	if g == nil {
		g = &Game{}
	}
	d.b.Init(e, g)
	return e, nil
}

// Update ticks every live entity in order. Entities appended to *ents during the pass
// (by a spawner) are visited in the same pass, so ents is a pointer to the live slice.
func (r *Registry) Update(ents *[]*Entity, dt float64, g *Game) {
	if g == nil {
		g = &Game{}
	}
	for i := 0; i < len(*ents); i++ {
		e := (*ents)[i]
		if e.Dead {
			continue
		}
		if d, ok := r.defs[e.Kind]; ok {
			d.b.Update(e, dt, g)
		}
	}
}

func (r *Registry) touch(e *Entity, p Player, g *Game) *Contact {
	if d, ok := r.defs[e.Kind]; ok {
		if t, ok := d.b.(Toucher); ok {
			return t.OnTouch(e, p, g)
		}
	}
	return nil
}

// ---- geometry and contacts --------------------------------------------------------------

// Overlaps reports whether the feet-anchored player box (half-width hw, height hh)
// strictly overlaps the entity box.
func Overlaps(p Player, hw, hh float64, e *Entity) bool {
	return p.X+hw > e.X-e.W/2 && p.X-hw < e.X+e.W/2 && p.Y > e.Y-e.H && p.Y-hh < e.Y
}

// ContactType classifies a contact result.
type ContactType string

// Contact types.
const (
	ContactKill    ContactType = "kill"
	ContactPoints  ContactType = "points"
	ContactCollect ContactType = "collect"
)

// Contact is one resolved overlap. Kind is set for kills, Amount for points.
type Contact struct {
	Type   ContactType
	Ent    *Entity
	Kind   string
	Amount float64
}

// ContactOpts tunes ResolveContacts.
type ContactOpts struct {
	HitW, HitH, HitCooldown, PointsPenalty float64
}

// DefaultContactOpts returns HitW 8, HitH 16, HitCooldown 0.6, PointsPenalty -100.
func DefaultContactOpts() ContactOpts {
	return ContactOpts{HitW: 8, HitH: 16, HitCooldown: 0.6, PointsPenalty: -100}
}

// ResolveContacts returns the ordered contacts between the player and ents. Dead entities
// and entities on another layer are skipped. A "points" hazard re-hits only after
// HitCooldown seconds (tracked in St["hitT"]).
func ResolveContacts(reg *Registry, p Player, ents []*Entity, o ContactOpts, g *Game) []Contact {
	if g == nil {
		g = &Game{}
	}
	hw, hh := o.HitW/2, o.HitH
	var out []Contact
	for _, e := range ents {
		if e.Dead {
			continue
		}
		if e.Layer != "" && p.Layer != "" && e.Layer != p.Layer {
			continue
		}
		if !Overlaps(p, hw, hh, e) {
			continue
		}
		if c := reg.touch(e, p, g); c != nil {
			if c.Ent == nil {
				c.Ent = e
			}
			out = append(out, *c)
			continue
		}
		if e.Collect {
			out = append(out, Contact{Type: ContactCollect, Ent: e})
			continue
		}
		switch e.Lethal {
		case LethalLife:
			out = append(out, Contact{Type: ContactKill, Ent: e, Kind: e.Kind})
		case LethalPoints:
			last, ok := e.St["hitT"]
			if !ok {
				last = math.Inf(-1)
			}
			now := e.T
			if g.HasTime {
				now = g.Time
			}
			if now-last >= o.HitCooldown {
				e.St["hitT"] = now
				amount := o.PointsPenalty
				if e.Points != nil {
					amount = *e.Points
				}
				out = append(out, Contact{Type: ContactPoints, Ent: e, Amount: amount})
			}
		}
	}
	return out
}

// DefaultSlack is the horizontal slack of the solid-top queries.
const DefaultSlack = 2.0

func (e *Entity) top() float64 {
	if e.TopY != nil {
		return *e.TopY
	}
	return e.Y - e.H
}

// SolidTopUnder returns the entity whose solid top a body falling from prevY to y lands on.
func SolidTopUnder(ents []*Entity, x, y, prevY, slack float64) *Entity {
	for _, e := range ents {
		if e.Dead || !e.SolidTop {
			continue
		}
		top := e.top()
		if math.Abs(x-e.X) <= e.W/2+slack && prevY <= top+1 && y >= top {
			return e
		}
	}
	return nil
}

// SolidTopCarrying returns the entity currently carrying a body standing at (x,y).
func SolidTopCarrying(ents []*Entity, x, y, slack float64) *Entity {
	for _, e := range ents {
		if e.Dead || !e.SolidTop {
			continue
		}
		if math.Abs(x-e.X) <= e.W/2+slack && math.Abs(y-e.top()) <= 3 {
			return e
		}
	}
	return nil
}

// ---- patterns ---------------------------------------------------------------------------

func stDefault(e *Entity, key string, v float64) {
	if _, ok := e.St[key]; !ok {
		e.St[key] = v
	}
}

func advance(e *Entity, dx, framePx float64, frames int) {
	e.St["dist"] += math.Abs(dx)
	e.Frame = int(math.Floor(e.St["dist"]/framePx)) % frames
}

// Patroller walks between MinX and MaxX, turning at the ends (scorpion, guard).
// Per-entity St["minX"] and St["maxX"] override the pattern bounds.
type Patroller struct {
	W, H, Speed, MinX, MaxX, FramePx float64
	Lethal                           Lethal
	Frames                           int
}

// DefaultPatroller returns the reference parameters.
func DefaultPatroller() *Patroller {
	return &Patroller{W: 12, H: 8, Speed: 20, MinX: 0, MaxX: 320, Lethal: LethalLife, FramePx: 4, Frames: 2}
}

// Init implements Behaviour.
func (p *Patroller) Init(e *Entity, _ *Game) {
	e.W, e.H, e.Lethal, e.SolidTop = p.W, p.H, p.Lethal, false
	stDefault(e, "minX", p.MinX)
	stDefault(e, "maxX", p.MaxX)
	dir := -1.0
	if e.Dir != nil && *e.Dir == 1 {
		dir = 1
	}
	e.Dir = Ptr(dir)
	e.X = math.Min(e.St["maxX"], math.Max(e.St["minX"], e.X))
	e.VX = dir * p.speed(e)
}

func (p *Patroller) speed(e *Entity) float64 {
	if e.Speed != nil {
		return *e.Speed
	}
	return p.Speed
}

// Update implements Behaviour.
func (p *Patroller) Update(e *Entity, dt float64, _ *Game) {
	e.T += dt
	dx := float64(e.VX * dt)
	e.X += dx
	if e.X <= e.St["minX"] {
		e.X, e.Dir = e.St["minX"], Ptr(1.0)
	}
	if e.X >= e.St["maxX"] {
		e.X, e.Dir = e.St["maxX"], Ptr(-1.0)
	}
	e.VX = *e.Dir * p.speed(e)
	advance(e, dx, p.FramePx, p.Frames)
}

// Hop makes a Roller jump in a sine arc for Len of every Period seconds.
type Hop struct{ Period, Len, Height float64 }

// Roller rolls in one direction and wraps at Width (rolling log), optionally hopping.
type Roller struct {
	W, H, Speed, FramePx, Width float64
	Lethal                      Lethal
	Frames                      int
	Hop                         *Hop
}

// DefaultRoller returns the reference parameters.
func DefaultRoller() *Roller {
	return &Roller{W: 14, H: 8, Speed: 46, Lethal: LethalPoints, FramePx: 6, Frames: 4, Width: 320}
}

// Init implements Behaviour.
func (r *Roller) Init(e *Entity, _ *Game) {
	e.W, e.H, e.Lethal, e.SolidTop = r.W, r.H, r.Lethal, false
	dir, speed := -1.0, r.Speed
	if e.Dir != nil {
		dir = *e.Dir
	}
	if e.Speed != nil {
		speed = *e.Speed
	}
	e.VX = dir * speed
	e.St["baseY"] = e.Y
}

// Update implements Behaviour.
func (r *Roller) Update(e *Entity, dt float64, _ *Game) {
	e.T += dt
	dx := e.VX * dt
	e.X += dx
	if e.X+e.W/2 < 0 {
		e.X += r.Width + e.W
	}
	if e.X-e.W/2 > r.Width {
		e.X -= r.Width + e.W
	}
	if h := r.Hop; h != nil {
		ph := math.Mod(e.T, h.Period)
		k := 0.0
		if ph < h.Len {
			k = math.Sin(math.Pi * ph / h.Len)
		}
		e.Y = e.St["baseY"] - h.Height*k
	}
	advance(e, dx, r.FramePx, r.Frames)
}

// Stationary is a fixed hazard with a flicker animation (fire, snake).
type Stationary struct {
	W, H, FPS float64
	Lethal    Lethal
	Frames    int
}

// DefaultStationary returns the reference parameters.
func DefaultStationary() *Stationary {
	return &Stationary{W: 8, H: 12, Lethal: LethalLife, Frames: 3, FPS: 8}
}

// Init implements Behaviour.
func (s *Stationary) Init(e *Entity, _ *Game) {
	e.W, e.H, e.Lethal, e.SolidTop, e.VX = s.W, s.H, s.Lethal, false, 0
	stDefault(e, "phase", 0)
}

// Update implements Behaviour.
func (s *Stationary) Update(e *Entity, dt float64, _ *Game) {
	e.T += dt
	n := int(math.Floor((e.T + e.St["phase"]) * s.FPS))
	e.Frame = ((n % s.Frames) + s.Frames) % s.Frames
}

// Cycler is an open/closed cycle (crocodile, spike trap). Closed is harmless and (if
// ClosedSolid) standable; open is lethal. Stagger neighbours with St["phase"].
type Cycler struct {
	W, H, Period, OpenFrac float64
	OpenLethal             Lethal
	ClosedSolid            bool
}

// DefaultCycler returns the reference parameters.
func DefaultCycler() *Cycler {
	return &Cycler{W: 22, H: 10, Period: 2.8, OpenFrac: 0.45, OpenLethal: LethalLife, ClosedSolid: true}
}

func (c *Cycler) apply(e *Entity) {
	p := e.St["period"]
	cyc := math.Mod(math.Mod(e.T+e.St["phase"], p)+p, p)
	open := cyc >= p*(1-e.St["openFrac"])
	e.Frame = 0
	e.Lethal = LethalNone
	if open {
		e.Frame, e.Lethal = 1, c.OpenLethal
	}
	e.Open, e.HasOpen = open, true
	e.SolidTop = c.ClosedSolid && !open
}

// Init implements Behaviour.
func (c *Cycler) Init(e *Entity, _ *Game) {
	e.W, e.H, e.VX = c.W, c.H, 0
	stDefault(e, "phase", 0)
	stDefault(e, "period", c.Period)
	stDefault(e, "openFrac", c.OpenFrac)
	c.apply(e)
}

// Update implements Behaviour.
func (c *Cycler) Update(e *Entity, dt float64, _ *Game) { e.T += dt; c.apply(e) }

// Spawner spawns Kind every Every seconds through Game.Spawn. First, if set, delays the
// first spawn. MakeProps supplies per-spawn Opts.
type Spawner struct {
	Every     float64
	Kind      string
	First     *float64
	MakeProps func(e *Entity, g *Game) []Opt
}

// DefaultSpawner returns a spawner with Every 4.
func DefaultSpawner() *Spawner { return &Spawner{Every: 4} }

// Init implements Behaviour.
func (s *Spawner) Init(e *Entity, _ *Game) {
	// JS: w ??= 1; h ??= 1 -- the base entity already has W=H=8, so they stay unchanged.
	first := s.Every
	if s.First != nil {
		first = *s.First
	}
	e.St["timer"] = first
}

// Update implements Behaviour.
func (s *Spawner) Update(e *Entity, dt float64, g *Game) {
	e.T += dt
	e.St["timer"] -= dt
	for e.St["timer"] <= 0 {
		e.St["timer"] += s.Every
		if g.Spawn != nil {
			var opts []Opt
			if s.MakeProps != nil {
				opts = s.MakeProps(e, g)
			}
			g.Spawn(s.Kind, opts...)
		}
	}
}

// TauntingBoss emits a "taunt" every Every seconds (at most once per update), picking the
// line with Game.RNG (one draw) or cycling when there is no RNG, and optionally throws a
// hazard. It is harmless by itself.
type TauntingBoss struct {
	Every      float64
	Taunts     []string
	Dur        float64
	ThrowKind  string
	ThrowProps func(e *Entity, g *Game) []Opt
	SFX        string
}

// DefaultTauntingBoss returns the reference parameters.
func DefaultTauntingBoss() *TauntingBoss {
	return &TauntingBoss{Every: 4, Taunts: []string{"HA HA!"}, Dur: 2.5}
}

// Init implements Behaviour.
func (b *TauntingBoss) Init(e *Entity, _ *Game) {
	stDefault(e, "timer", b.Every)
	e.St["said"] = 0
}

// Update implements Behaviour.
func (b *TauntingBoss) Update(e *Entity, dt float64, g *Game) {
	e.T += dt
	e.St["timer"] -= dt
	if e.St["timer"] > 0 {
		return
	}
	e.St["timer"] += b.Every
	var text string
	if g.RNG != nil {
		text = Pick(g.RNG, b.Taunts)
	} else {
		text = b.Taunts[int(e.St["said"])%len(b.Taunts)]
	}
	e.St["said"]++
	e.LastTaunt = text
	if g.Emit != nil {
		g.Emit(EmitEvent{Name: "taunt", Text: text, Dur: b.Dur, Ent: e})
		if b.SFX != "" {
			g.Emit(EmitEvent{Name: "sfx", SFX: b.SFX})
		}
	}
	if b.ThrowKind != "" && g.Spawn != nil {
		var opts []Opt
		if b.ThrowProps != nil {
			opts = b.ThrowProps(e, g)
		}
		g.Spawn(b.ThrowKind, opts...)
	}
}

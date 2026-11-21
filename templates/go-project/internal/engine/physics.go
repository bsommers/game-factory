package engine

import "math"

// Mode is a body's movement mode.
type Mode string

// Body modes.
const (
	ModeGround Mode = "ground"
	ModeAir    Mode = "air"
	ModeClimb  Mode = "climb"
	ModeSwing  Mode = "swing"
	ModeDead   Mode = "dead"
)

// Config holds the physics constants. Coordinates: x right, y DOWN; a body's (X,Y) is its
// feet centre and the hitbox is HitW wide and HitH tall above Y.
type Config struct {
	Gravity, JumpV, RunSpeed, AirSpeed, AirAccel, ClimbSpeed float64
	HitW, HitH, GrabR, GrabCooldown, SwingBlend              float64
	EdgeL, EdgeR                                             float64
	// Stride is how many screens an edge transition skips; StrideFn, if set, wins.
	Stride   int
	StrideFn func(b *Body) int
	// Emit, if set, receives gameplay events. See Event.
	Emit func(Event)
}

// DefaultConfig returns the reference constants.
func DefaultConfig() Config {
	return Config{
		Gravity: 520, JumpV: 200, RunSpeed: 60, AirSpeed: 60, AirAccel: 160, ClimbSpeed: 40,
		HitW: 8, HitH: 16, GrabR: 8, GrabCooldown: 0.35, SwingBlend: 0.12,
		EdgeL: 4, EdgeR: 316, Stride: 1,
	}
}

// JumpRange is the maximum horizontal distance a run-jump covers on flat ground
// (use it for pit-width fairness checks).
func (c *Config) JumpRange() float64 { return c.RunSpeed * 2 * c.JumpV / c.Gravity }

// JumpHeight is the apex height of a jump.
func (c *Config) JumpHeight() float64 { return c.JumpV * c.JumpV / (2 * c.Gravity) }

// Event is a gameplay event delivered to Config.Emit. Names: jump, land, hardland, grab,
// release, climb, climbEnd, drop, death. Extra is a *Platform (land), *Pit (drop, death),
// *Ladder (climb), Tip (grab), the string "top" or "bottom" (climbEnd), or nil.
type Event struct {
	Name  string
	Body  *Body
	Extra any
}

// Body is a simulated actor.
type Body struct {
	X, Y, VX, VY float64
	Face         int
	Mode         Mode
	Layer        int
	OnPlatform   *Platform
	Landed       bool
	GrabCd       float64
	SwingK       float64
	OffX, OffY   float64
	Rope         *Pendulum
	Ladder       *Ladder
	T            float64
	DeathKind    string
}

// NewBody returns a grounded body at (x,y) facing right.
func NewBody(x, y float64) *Body {
	return &Body{X: x, Y: y, Face: 1, Mode: ModeGround, Landed: true}
}

// Input is one tick of player intent. DY is negative for up.
type Input struct {
	DX, DY      int
	JumpPressed bool
}

// ---- pendulum rope / vine ---------------------------------------------------------------

// Pendulum is a rope whose tip hangs Len below (Px,Py) and swings with
// angle = Amp*sin(2*pi*t/Period).
type Pendulum struct{ Px, Py, Len, Amp, Period float64 }

// Tip is the rope end position and angle at one instant.
type Tip struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	A float64 `json:"a"`
}

// Vec is a 2D vector.
type Vec struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func (p *Pendulum) omega() float64 { return 2 * math.Pi / p.Period }

// Angle returns the swing angle at time t.
func (p *Pendulum) Angle(t float64) float64 { return p.Amp * math.Sin(p.omega()*t) }

// Tip returns the rope tip at time t.
func (p *Pendulum) Tip(t float64) Tip {
	a := p.Angle(t)
	return Tip{X: p.Px + math.Sin(a)*p.Len, Y: p.Py + math.Cos(a)*p.Len, A: a}
}

// TipVel returns the rope tip velocity at time t.
func (p *Pendulum) TipVel(t float64) Vec {
	w := p.omega()
	a := p.Angle(t)
	om := p.Amp * w * math.Cos(w*t)
	return Vec{X: p.Len * om * math.Cos(a), Y: -p.Len * om * math.Sin(a)}
}

// ---- platforms --------------------------------------------------------------------------

// Platform is a one-way platform (land from above only) centred on X with its top at Y.
// DX and DY are the platform's movement this tick, carried onto standing bodies.
type Platform struct {
	ID     string
	X, Y   float64
	W      float64
	DX, DY float64
}

// MovingPlatform is a ping-pong platform on a segment. Call Update(dt) once per tick
// before stepping bodies. Add &mp.Platform to World.Platforms.
type MovingPlatform struct {
	Platform
	T              float64
	Speed          float64
	x0, y0, x1, y1 float64
	span           float64
}

// MovingOpt configures a MovingPlatform.
type MovingOpt func(*MovingPlatform)

// MovingWidth sets the platform width (default 24).
func MovingWidth(w float64) MovingOpt { return func(m *MovingPlatform) { m.W = w } }

// MovingSpeed sets the travel speed in px/s (default 20).
func MovingSpeed(s float64) MovingOpt { return func(m *MovingPlatform) { m.Speed = s } }

// MovingPhase sets the starting time offset (default 0).
func MovingPhase(t float64) MovingOpt { return func(m *MovingPlatform) { m.T = t } }

// NewMovingPlatform builds a platform travelling between (x0,y0) and (x1,y1).
func NewMovingPlatform(id string, x0, y0, x1, y1 float64, opts ...MovingOpt) *MovingPlatform {
	m := &MovingPlatform{Platform: Platform{ID: id, X: x0, Y: y0, W: 24}, Speed: 20,
		x0: x0, y0: y0, x1: x1, y1: y1}
	for _, o := range opts {
		o(m)
	}
	m.span = math.Hypot(x1-x0, y1-y0)
	if m.span == 0 {
		m.span = 1
	}
	m.place()
	return m
}

func (m *MovingPlatform) place() {
	d := math.Mod(m.T*m.Speed, 2*m.span)
	var u float64
	if d <= m.span {
		u = d / m.span
	} else {
		u = (2*m.span - d) / m.span
	}
	m.X = m.x0 + (m.x1-m.x0)*u
	m.Y = m.y0 + (m.y1-m.y0)*u
}

// Update advances the platform by dt seconds and records DX/DY.
func (m *MovingPlatform) Update(dt float64) {
	ox, oy := m.X, m.Y
	m.T += dt
	m.place()
	m.DX, m.DY = m.X-ox, m.Y-oy
}

// Pit is a gap in the ground between X0 and X1. A Drop pit is a safe hole (the game
// increments Body.Layer); any other pit kills with DeathKind = Kind (default "pit").
type Pit struct {
	X0, X1 float64
	Kind   string
	Drop   bool
}

// Ladder is climbable between Top and Bottom, W wide (0 means the default 8).
type Ladder struct{ X, Top, Bottom, W float64 }

// World describes one screen. It is plain data, rebuilt per screen by the game.
type World struct {
	GroundY   float64
	Pits      []Pit
	Platforms []*Platform
	Ladders   []Ladder
	Ropes     []*Pendulum
	// MinY, when HasMinY, is the ceiling (a body's head cannot rise above it).
	MinY    float64
	HasMinY bool
	// T is the world clock driving ropes when HasT; otherwise Body.T is used.
	T    float64
	HasT bool
}

// SetTime sets the world clock used for ropes.
func (w *World) SetTime(t float64) { w.T, w.HasT = t, true }

// ---- support queries --------------------------------------------------------------------

// PitAt returns the first pit with x0 < x < x1 (strict), or nil.
func (w *World) PitAt(x float64) *Pit {
	for i := range w.Pits {
		if x > w.Pits[i].X0 && x < w.Pits[i].X1 {
			return &w.Pits[i]
		}
	}
	return nil
}

// LadderAt returns the first ladder within reach of (x, feetY), or nil.
func (w *World) LadderAt(x, feetY float64) *Ladder {
	for i := range w.Ladders {
		l := &w.Ladders[i]
		lw := l.W
		if lw == 0 {
			lw = 8
		}
		if math.Abs(x-l.X) <= lw/2 && feetY >= l.Top-1 && feetY <= l.Bottom+1 {
			return l
		}
	}
	return nil
}

func (w *World) platformUnder(x, y, prevY float64) *Platform {
	for _, p := range w.Platforms {
		if math.Abs(x-p.X) <= p.W/2 && prevY <= p.Y+1 && y >= p.Y {
			return p
		}
	}
	return nil
}

func (w *World) platformCarrying(x, y float64) *Platform {
	for _, p := range w.Platforms {
		if math.Abs(x-p.X) <= p.W/2 && math.Abs(y-p.Y) <= 3 {
			return p
		}
	}
	return nil
}

// SupportAt returns the walkable surface under a standing body: its y and the carrying
// platform (nil for ground). ok is false when there is nothing to stand on (a pit).
func (w *World) SupportAt(x, y float64) (sy float64, p *Platform, ok bool) {
	if p = w.platformCarrying(x, y); p != nil {
		return p.Y, p, true
	}
	if w.PitAt(x) != nil {
		return 0, nil, false
	}
	return w.GroundY, nil, true
}

func (w *World) time(b *Body) float64 {
	if w.HasT {
		return w.T
	}
	return b.T
}

func emit(cfg *Config, name string, b *Body, extra any) {
	if cfg.Emit != nil {
		cfg.Emit(Event{Name: name, Body: b, Extra: extra})
	}
}

func enterPit(b *Body, q *Pit, w *World, cfg *Config) {
	if q.Drop {
		b.VX, b.VY, b.Y, b.Landed = 0, 0, w.GroundY, true
		emit(cfg, "drop", b, q)
		return
	}
	b.Mode = ModeDead
	b.DeathKind = q.Kind
	if b.DeathKind == "" {
		b.DeathKind = "pit"
	}
	b.VX, b.VY, b.Y = 0, 0, w.GroundY
	emit(cfg, "death", b, q)
}

func ballistic(b *Body, dt float64, dx int, w *World, cfg *Config) {
	prevY := b.Y
	if dx != 0 {
		target := float64(dx) * cfg.AirSpeed
		a := cfg.AirAccel * dt
		if b.VX < target {
			b.VX = math.Min(target, b.VX+a)
		} else {
			b.VX = math.Max(target, b.VX-a)
		}
	}
	b.VY += cfg.Gravity * dt
	b.X += b.VX * dt
	b.Y += b.VY * dt
	b.Landed = false
	b.OnPlatform = nil
	if w.HasMinY && b.Y-cfg.HitH < w.MinY {
		b.Y = w.MinY + cfg.HitH
		if b.VY < 0 {
			b.VY = 0
		}
	}
	if b.VY >= 0 {
		if p := w.platformUnder(b.X, b.Y, prevY); p != nil {
			b.Y, b.VY = p.Y, 0
			b.VX *= 0.5
			b.Landed = true
			b.OnPlatform = p
			emit(cfg, "land", b, p)
			return
		}
	}
	if b.VY >= 0 && b.Y >= w.GroundY {
		if q := w.PitAt(b.X); q != nil {
			enterPit(b, q, w, cfg)
			return
		}
		if b.VY > 140 {
			emit(cfg, "hardland", b, nil)
		}
		b.Y, b.VY, b.Landed = w.GroundY, 0, true
		emit(cfg, "land", b, nil)
	}
}

func tryGrab(b *Body, w *World, t float64, cfg *Config) {
	if b.GrabCd > 0 {
		return
	}
	for _, r := range w.Ropes {
		tip := r.Tip(t)
		hx, hy := b.X, b.Y-cfg.HitH
		if math.Hypot(tip.X-hx, tip.Y-hy) <= cfg.GrabR {
			b.Mode, b.Rope, b.SwingK = ModeSwing, r, 1
			b.OffX, b.OffY = hx-tip.X, hy-tip.Y
			b.VX, b.VY = 0, 0
			emit(cfg, "grab", b, tip)
			return
		}
	}
}

func stepGround(b *Body, in Input, dt float64, w *World, cfg *Config) {
	dx, dy := in.DX, in.DY
	if lad := w.LadderAt(b.X, b.Y); lad != nil && ((dy < 0 && b.Y > lad.Top+1) || (dy > 0 && b.Y < lad.Bottom-1)) {
		b.Mode, b.X, b.VX, b.VY, b.Ladder = ModeClimb, lad.X, 0, 0, lad
		emit(cfg, "climb", b, lad)
		return
	}
	if in.JumpPressed {
		b.VY = -cfg.JumpV
		b.VX = float64(dx) * cfg.AirSpeed
		if dx != 0 {
			b.Face = dx
		}
		b.Mode, b.OnPlatform, b.Landed = ModeAir, nil, false
		emit(cfg, "jump", b, nil)
		return
	}
	b.VX = float64(dx) * cfg.RunSpeed
	if dx != 0 {
		b.Face = dx
	}
	prevX := b.X
	b.X += b.VX * dt
	if carry := w.platformCarrying(prevX, b.Y); carry != nil { // uses the PRE-move x
		b.X += carry.DX
		b.Y += carry.DY
	}
	sy, p, ok := w.SupportAt(b.X, b.Y)
	if !ok {
		b.Mode, b.VY, b.OnPlatform = ModeAir, 0, nil
		return
	}
	b.Y, b.OnPlatform = sy, p
}

func stepAir(b *Body, in Input, dt float64, w *World, cfg *Config) {
	if in.DX != 0 {
		b.Face = in.DX
	}
	ballistic(b, dt, in.DX, w, cfg)
	if b.Mode != ModeAir {
		return
	}
	if b.Landed {
		b.Mode = ModeGround
		return
	}
	tryGrab(b, w, w.time(b), cfg)
}

func stepSwing(b *Body, in Input, dt float64, w *World, cfg *Config) {
	r := b.Rope
	if r == nil {
		b.Mode = ModeAir
		return
	}
	t := w.time(b)
	tip, tv := r.Tip(t), r.TipVel(t)
	b.SwingK = math.Max(0, b.SwingK-dt/cfg.SwingBlend)
	b.X = tip.X + b.OffX*b.SwingK
	b.Y = tip.Y + cfg.HitH + b.OffY*b.SwingK
	if math.Abs(tv.X) > 12 {
		if tv.X > 0 {
			b.Face = 1
		} else {
			b.Face = -1
		}
	}
	b.VX, b.VY = tv.X, tv.Y
	if in.JumpPressed {
		b.Mode, b.Rope, b.GrabCd, b.Landed = ModeAir, nil, cfg.GrabCooldown, false
		emit(cfg, "release", b, nil)
		return
	}
	if b.Y >= w.GroundY-2 && w.PitAt(b.X) == nil {
		b.Mode, b.Rope, b.Y, b.VX, b.VY, b.GrabCd = ModeGround, nil, w.GroundY, 0, 0, cfg.GrabCooldown
		emit(cfg, "land", b, nil)
	}
}

func stepClimb(b *Body, in Input, dt float64, w *World, cfg *Config) {
	l := b.Ladder
	if l == nil {
		b.Mode = ModeAir
		return
	}
	if in.DY != 0 {
		b.Y += float64(in.DY) * cfg.ClimbSpeed * dt
	}
	if b.Y <= l.Top {
		b.Y, b.Mode, b.Ladder = l.Top, ModeGround, nil
		emit(cfg, "climbEnd", b, "top")
	} else if b.Y >= l.Bottom {
		b.Y, b.Mode, b.Ladder = l.Bottom, ModeGround, nil
		emit(cfg, "climbEnd", b, "bottom")
	}
}

// StepBody advances one body by one fixed tick of dt seconds and returns it. World.T (or
// Body.T when unset) drives ropes.
func StepBody(b *Body, in Input, dt float64, w *World, cfg *Config) *Body {
	b.T += dt
	if b.GrabCd > 0 {
		b.GrabCd -= dt
	}
	switch b.Mode {
	case ModeGround:
		stepGround(b, in, dt, w, cfg)
	case ModeAir:
		stepAir(b, in, dt, w, cfg)
	case ModeSwing:
		stepSwing(b, in, dt, w, cfg)
	case ModeClimb:
		stepClimb(b, in, dt, w, cfg)
	}
	return b
}

// ---- screen-edge transitions ------------------------------------------------------------

// WrapIndex is the floor-mod ((i % n) + n) % n for integers.
func WrapIndex(i, n int) int { return ((i % n) + n) % n }

// Transition is the result of leaving a screen edge.
type Transition struct {
	Dir int     `json:"dir"`
	Idx int     `json:"idx"`
	X   float64 `json:"x"`
}

// EdgeTransition reports whether a ground or air body left a screen edge of a circular
// world of count screens. The body is not mutated; see ApplyTransition.
func EdgeTransition(b *Body, idx, count int, cfg *Config) (Transition, bool) {
	if b.Mode != ModeGround && b.Mode != ModeAir {
		return Transition{}, false
	}
	dir := 0
	if b.X < cfg.EdgeL {
		dir = -1
	} else if b.X > cfg.EdgeR {
		dir = 1
	}
	if dir == 0 {
		return Transition{}, false
	}
	stride := cfg.Stride
	if cfg.StrideFn != nil {
		stride = cfg.StrideFn(b)
	}
	x := cfg.EdgeR - 1
	if dir > 0 {
		x = cfg.EdgeL + 1
	}
	return Transition{Dir: dir, Idx: WrapIndex(idx+dir*stride, count), X: x}, true
}

// ApplyTransition moves the body to the entry x of the new screen.
func ApplyTransition(b *Body, tr Transition) *Body { b.X = tr.X; return b }

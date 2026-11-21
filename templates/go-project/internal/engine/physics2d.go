package engine

// Deterministic 2D rigid-body engine + kinematic character controller: port of
// templates/web-project/src/lib/physics2d.js (spec/v2/physics2d.md). Fixed timestep, ids count up from 1,
// bodies iterate in id order, no randomness. The solver mirrors the JS order of floating-point operations;
// products that feed sums are wrapped in float64() so a compiler can never fuse them into an FMA.

import (
	"fmt"
	"math"
)

// PhysConfig is the world configuration (defaults from DefaultPhysConfig).
type PhysConfig struct {
	GravityX, GravityY float64
	VelocityIterations int
	Slop, Baumgarte    float64
	MaxBias            float64
	RestitutionThresh  float64
	WarmRadius         float64
	CellSize           float64
	Sleep, CCD         bool
	TimeToSleep        float64
	LinearSleep        float64
	AngularSleep       float64
}

func DefaultPhysConfig() PhysConfig {
	return PhysConfig{GravityX: 0, GravityY: 600, VelocityIterations: 10, Slop: 0.25, Baumgarte: 0.2, MaxBias: 150,
		RestitutionThresh: 30, WarmRadius: 4, CellSize: 64, Sleep: true, CCD: true, TimeToSleep: 0.5, LinearSleep: 5, AngularSleep: 0.1}
}

// PhysConfigOpts is a partial config (nil = default); gravity merges per component.
type PhysConfigOpts struct {
	Gravity *struct {
		X *float64 `json:"x"`
		Y *float64 `json:"y"`
	} `json:"gravity"`
	VelocityIterations   *int     `json:"velocityIterations"`
	Slop                 *float64 `json:"slop"`
	Baumgarte            *float64 `json:"baumgarte"`
	MaxBias              *float64 `json:"maxBias"`
	RestitutionThreshold *float64 `json:"restitutionThreshold"`
	WarmRadius           *float64 `json:"warmRadius"`
	CellSize             *float64 `json:"cellSize"`
	Sleep                *bool    `json:"sleep"`
	CCD                  *bool    `json:"ccd"`
	TimeToSleep          *float64 `json:"timeToSleep"`
	LinearSleep          *float64 `json:"linearSleep"`
	AngularSleep         *float64 `json:"angularSleep"`
}

func (o PhysConfigOpts) Build() PhysConfig {
	c := DefaultPhysConfig()
	if o.Gravity != nil {
		if o.Gravity.X != nil {
			c.GravityX = *o.Gravity.X
		}
		if o.Gravity.Y != nil {
			c.GravityY = *o.Gravity.Y
		}
	}
	setF := func(dst *float64, p *float64) {
		if p != nil {
			*dst = *p
		}
	}
	if o.VelocityIterations != nil {
		c.VelocityIterations = *o.VelocityIterations
	}
	setF(&c.Slop, o.Slop)
	setF(&c.Baumgarte, o.Baumgarte)
	setF(&c.MaxBias, o.MaxBias)
	setF(&c.RestitutionThresh, o.RestitutionThreshold)
	setF(&c.WarmRadius, o.WarmRadius)
	setF(&c.CellSize, o.CellSize)
	setF(&c.TimeToSleep, o.TimeToSleep)
	setF(&c.LinearSleep, o.LinearSleep)
	setF(&c.AngularSleep, o.AngularSleep)
	if o.Sleep != nil {
		c.Sleep = *o.Sleep
	}
	if o.CCD != nil {
		c.CCD = *o.CCD
	}
	return c
}

// PhysShape is a body shape: "circle"{R}, "box"{HW,HH}, "capsule"{HL,R} or "polygon"{Points}.
type PhysShape struct {
	Type   string  `json:"type"`
	R      float64 `json:"r"`
	HW     float64 `json:"hw"`
	HH     float64 `json:"hh"`
	HL     float64 `json:"hl"`
	Points []Vec2  `json:"points"`
}

// BodyDef creates a body; nil fields take the documented defaults.
type BodyDef struct {
	Type           string     `json:"type"`
	X              float64    `json:"x"`
	Y              float64    `json:"y"`
	Angle          float64    `json:"angle"`
	VX             float64    `json:"vx"`
	VY             float64    `json:"vy"`
	W              float64    `json:"w"`
	Shape          *PhysShape `json:"shape"`
	Density        *float64   `json:"density"`
	Friction       *float64   `json:"friction"`
	Restitution    *float64   `json:"restitution"`
	Layer          *int32     `json:"layer"`
	Mask           *int32     `json:"mask"`
	Sensor         bool       `json:"sensor"`
	LinearDamping  float64    `json:"linearDamping"`
	AngularDamping float64    `json:"angularDamping"`
	GravityScale   *float64   `json:"gravityScale"`
	FixedRotation  bool       `json:"fixedRotation"`
	AllowSleep     *bool      `json:"allowSleep"`
}

type PhysBody struct {
	ID                         int
	Type                       string
	X, Y, Angle, VX, VY, W     float64
	FX, FY, Torque             float64
	Shape                      PhysShape
	Density, Friction          float64
	Restitution                float64
	Layer, Mask                int32
	Sensor                     bool
	LinearDamping, AngularDamp float64
	GravityScale               float64
	FixedRotation, AllowSleep  bool
	InvMass, InvI              float64
	Asleep                     bool
	SleepT                     float64
	Island                     int // 0 = none
}

// JointDef creates a joint ("distance", "spring" or "revolute").
type JointDef struct {
	Type             string   `json:"type"`
	A                int      `json:"a"`
	B                int      `json:"b"`
	AnchorA          *Vec2    `json:"anchorA"`
	AnchorB          *Vec2    `json:"anchorB"`
	Length           *float64 `json:"length"`
	Stiffness        *float64 `json:"stiffness"`
	Damping          float64  `json:"damping"`
	CollideConnected bool     `json:"collideConnected"`
}

type PhysJoint struct {
	ID                          int
	Type                        string
	A, B                        int
	AX, AY, BX, BY              float64
	Length                      float64
	Stiffness, Damping          float64
	CollideConnected            bool
	J, JX, JY                   float64
	rax, ray, rbx, rby          float64
	ux, uy, gamma, bias, mass   float64
	m11, m12, m22, biasX, biasY float64
}

type PhysPoint struct {
	X, Y, Depth, JN, JT                    float64
	rax, ray, rbx, rby, massN, massT, bias float64
}

type PhysContact struct {
	Key         string
	A, B        int
	NX, NY      float64
	Friction    float64
	Restitution float64
	Points      []PhysPoint
	carried     bool
}

type PhysSensor struct {
	Key           string
	Sensor, Other int
}

// PhysEvent is a contact event (begin/end: A,B) or a sensor event (enter/stay/exit: Sensor,Other).
type PhysEvent struct {
	Type          string
	A, B          int
	Sensor, Other int
	IsSensor      bool
}

type PhysWorld struct {
	Cfg                           PhysConfig
	bodies                        []*PhysBody
	joints                        []*PhysJoint
	contacts                      []*PhysContact
	sensors                       []PhysSensor
	nextID, nextJoint, nextIsland int
	time                          float64
	steps                         int
	byID                          map[int]*PhysBody
	Events                        []PhysEvent
	OnEvent                       func(PhysEvent)
}

func NewPhysWorld(cfg PhysConfig) *PhysWorld {
	return &PhysWorld{Cfg: cfg, nextID: 1, nextJoint: 1, nextIsland: 1, byID: map[int]*PhysBody{}}
}

func (w *PhysWorld) Bodies() []*PhysBody      { return w.bodies }
func (w *PhysWorld) Joints() []*PhysJoint     { return w.joints }
func (w *PhysWorld) Contacts() []*PhysContact { return w.contacts }
func (w *PhysWorld) Time() float64            { return w.time }
func (w *PhysWorld) Steps() int               { return w.steps }
func (w *PhysWorld) Body(id int) *PhysBody    { return w.byID[id] }

func pcross(ax, ay, bx, by float64) float64 { return float64(ax*by) - float64(ay*bx) }

// polyProps returns area, centroid and inertia about the centroid (unit density).
func polyProps(pts []Vec2) (area, cx, cy, inertia float64) {
	a2, I := 0.0, 0.0
	for i := range pts {
		p, q := pts[i], pts[(i+1)%len(pts)]
		cr := float64(p.X*q.Y) - float64(q.X*p.Y)
		a2 += cr
		cx += float64(p.X+q.X) * cr
		cy += float64(p.Y+q.Y) * cr
		I += float64(cr * (float64(p.X*p.X) + float64(p.X*q.X) + float64(q.X*q.X) + float64(p.Y*p.Y) + float64(p.Y*q.Y) + float64(q.Y*q.Y)))
	}
	ar := a2 / 2
	sgn := 1.0
	if ar < 0 {
		sgn = -1
	}
	A := math.Abs(ar)
	cx /= float64(6 * ar)
	cy /= float64(6 * ar)
	Io := sgn * I / 12
	return A, cx, cy, Io - float64(A*(float64(cx*cx)+float64(cy*cy)))
}

func massProps(sh PhysShape, density float64) (m, I float64) {
	switch sh.Type {
	case "circle":
		m = density * math.Pi * sh.R * sh.R
		return m, float64(float64(0.5*m)*sh.R) * sh.R
	case "box":
		m = float64(float64(density*4)*sh.HW) * sh.HH
		return m, float64(m*(float64(4*sh.HW*sh.HW)+float64(4*sh.HH*sh.HH))) / 12
	case "capsule":
		mr := float64(float64(density*4)*sh.HL) * sh.R
		mc := float64(float64(density*math.Pi)*sh.R) * sh.R
		d := float64(4*sh.R) / float64(3*math.Pi)
		hm := mc / 2
		Ir := float64(mr*(float64(4*sh.HL*sh.HL)+float64(4*sh.R*sh.R))) / 12
		Ih := float64(float64(0.5*hm)*sh.R)*sh.R - float64(float64(hm*d)*d) + float64(float64(hm*(sh.HL+d))*(sh.HL+d))
		return mr + mc, Ir + float64(2*Ih)
	}
	area, _, _, ic := polyProps(sh.Points)
	return density * area, density * ic
}

func placedShape(b *PhysBody) Shape {
	s := b.Shape
	switch s.Type {
	case "circle":
		return Circle(b.X, b.Y, s.R)
	case "box":
		if b.Angle == 0 {
			return AABB(b.X, b.Y, s.HW, s.HH)
		}
		return OBB(b.X, b.Y, s.HW, s.HH, b.Angle)
	case "capsule":
		return Capsule(b.X, b.Y, s.HL, s.R, b.Angle)
	}
	return Polygon(b.X, b.Y, s.Points, b.Angle)
}

// BodyShape is the placed collision shape of a body.
func BodyShape(b *PhysBody) Shape { return placedShape(b) }

func (w *PhysWorld) wake(b *PhysBody) {
	if !b.Asleep {
		b.SleepT = 0
		return
	}
	isl := b.Island
	for _, o := range w.bodies {
		if o.Asleep && (o == b || (isl != 0 && o.Island == isl)) {
			o.Asleep = false
			o.Island = 0
			o.SleepT = 0
		}
	}
}

// AddBody creates a body and returns its id.
func (w *PhysWorld) AddBody(def BodyDef) int {
	if def.Shape == nil {
		panic("physics2d: body needs a shape")
	}
	typ := def.Type
	if typ == "" {
		typ = "dynamic"
	}
	density := 1.0
	if def.Density != nil {
		density = *def.Density
	}
	shape := *def.Shape
	shape.Points = append([]Vec2(nil), def.Shape.Points...)
	x, y := def.X, def.Y
	if shape.Type == "polygon" {
		_, cx, cy, _ := polyProps(shape.Points)
		c, s := math.Cos(def.Angle), math.Sin(def.Angle)
		x += float64(cx*c) - float64(cy*s)
		y += float64(cx*s) + float64(cy*c)
		for i, p := range shape.Points {
			shape.Points[i] = Vec2{p.X - cx, p.Y - cy}
		}
	}
	invMass, invI := 0.0, 0.0
	if typ == "dynamic" {
		m, I := massProps(shape, density)
		if m > 0 {
			invMass = 1 / m
		}
		if !(def.FixedRotation || I <= 0) {
			invI = 1 / I
		}
	}
	b := &PhysBody{ID: w.nextID, Type: typ, X: x, Y: y, Angle: def.Angle, VX: def.VX, VY: def.VY, W: def.W, Shape: shape,
		Density: density, Friction: 0.5, Layer: 1, Mask: -1, Sensor: def.Sensor, LinearDamping: def.LinearDamping,
		AngularDamp: def.AngularDamping, GravityScale: 1, FixedRotation: def.FixedRotation, AllowSleep: true, InvMass: invMass, InvI: invI}
	w.nextID++
	if def.Friction != nil {
		b.Friction = *def.Friction
	}
	if def.Restitution != nil {
		b.Restitution = *def.Restitution
	}
	if def.Layer != nil {
		b.Layer = *def.Layer
	}
	if def.Mask != nil {
		b.Mask = *def.Mask
	}
	if def.GravityScale != nil {
		b.GravityScale = *def.GravityScale
	}
	if def.AllowSleep != nil {
		b.AllowSleep = *def.AllowSleep
	}
	w.bodies = append(w.bodies, b)
	w.byID[b.ID] = b
	return b.ID
}

func (w *PhysWorld) RemoveBody(id int) {
	nb := w.bodies[:0:0]
	for _, b := range w.bodies {
		if b.ID != id {
			nb = append(nb, b)
		}
	}
	w.bodies = nb
	nj := w.joints[:0:0]
	for _, j := range w.joints {
		if j.A != id && j.B != id {
			nj = append(nj, j)
		}
	}
	w.joints = nj
	nc := w.contacts[:0:0]
	for _, c := range w.contacts {
		if c.A != id && c.B != id {
			nc = append(nc, c)
		}
	}
	w.contacts = nc
	w.byID = map[int]*PhysBody{}
	for _, b := range w.bodies {
		w.byID[b.ID] = b
	}
}

func physAnchor(b *PhysBody, lx, ly float64) (float64, float64) {
	c, s := math.Cos(b.Angle), math.Sin(b.Angle)
	return b.X + float64(lx*c) - float64(ly*s), b.Y + float64(lx*s) + float64(ly*c)
}

func physApplyP(b *PhysBody, px, py, rx, ry, k float64) {
	b.VX += float64(float64(px*b.InvMass) * k)
	b.VY += float64(float64(py*b.InvMass) * k)
	b.W += float64(float64(b.InvI*pcross(rx, ry, px, py)) * k)
}

// AddJoint creates a joint and wakes both bodies; missing bodies panic.
func (w *PhysWorld) AddJoint(def JointDef) int {
	A, B := w.byID[def.A], w.byID[def.B]
	if A == nil || B == nil {
		panic("physics2d: joint needs two bodies")
	}
	lA, lB := Vec2{}, Vec2{}
	if def.AnchorA != nil {
		lA = *def.AnchorA
	}
	if def.AnchorB != nil {
		lB = *def.AnchorB
	}
	typ := def.Type
	if typ == "" {
		typ = "distance"
	}
	stiff := 0.0
	if typ == "spring" {
		stiff = 200
	}
	if def.Stiffness != nil {
		stiff = *def.Stiffness
	}
	j := &PhysJoint{ID: w.nextJoint, Type: typ, A: def.A, B: def.B, AX: lA.X, AY: lA.Y, BX: lB.X, BY: lB.Y,
		Stiffness: stiff, Damping: def.Damping, CollideConnected: def.CollideConnected}
	w.nextJoint++
	if def.Length != nil {
		j.Length = *def.Length
	}
	if typ != "revolute" && def.Length == nil {
		pax, pay := physAnchor(A, j.AX, j.AY)
		pbx, pby := physAnchor(B, j.BX, j.BY)
		dx, dy := pbx-pax, pby-pay
		j.Length = math.Sqrt(float64(dx*dx) + float64(dy*dy))
	}
	w.joints = append(w.joints, j)
	w.wake(A)
	w.wake(B)
	return j.ID
}

func (w *PhysWorld) RemoveJoint(id int) {
	nj := w.joints[:0:0]
	for _, j := range w.joints {
		if j.ID != id {
			nj = append(nj, j)
		}
	}
	w.joints = nj
}

func (w *PhysWorld) need(id int) *PhysBody {
	b := w.byID[id]
	if b == nil {
		panic(fmt.Sprintf("physics2d: no body %d", id))
	}
	return b
}

func (w *PhysWorld) Wake(id int) { w.wake(w.need(id)) }
func (w *PhysWorld) SetVelocity(id int, vx, vy float64, ang *float64) {
	b := w.need(id)
	w.wake(b)
	b.VX, b.VY = vx, vy
	if ang != nil {
		b.W = *ang
	}
}
func (w *PhysWorld) SetPosition(id int, x, y float64, angle *float64) {
	b := w.need(id)
	w.wake(b)
	b.X, b.Y = x, y
	if angle != nil {
		b.Angle = *angle
	}
}
func (w *PhysWorld) ApplyForce(id int, fx, fy float64) {
	b := w.need(id)
	w.wake(b)
	b.FX += fx
	b.FY += fy
}
func (w *PhysWorld) ApplyTorque(id int, t float64) {
	b := w.need(id)
	w.wake(b)
	b.Torque += t
}

// ApplyImpulse adds i*invMass to the velocity; a point (px,py) also spins the body.
func (w *PhysWorld) ApplyImpulse(id int, ix, iy float64, point *Vec2) {
	b := w.need(id)
	w.wake(b)
	b.VX += float64(ix * b.InvMass)
	b.VY += float64(iy * b.InvMass)
	if point != nil {
		b.W += float64(b.InvI * pcross(point.X-b.X, point.Y-b.Y, ix, iy))
	}
}

// KinematicStep sets a body's velocities without waking it.
func (w *PhysWorld) KinematicStep(id int, vx, vy, ang float64) {
	b := w.need(id)
	b.VX, b.VY, b.W = vx, vy, ang
}

func (w *PhysWorld) jointSkip() map[[2]int]bool {
	s := map[[2]int]bool{}
	for _, j := range w.joints {
		if !j.CollideConnected {
			lo, hi := j.A, j.B
			if !(j.A < j.B) {
				lo, hi = j.B, j.A
			}
			s[[2]int{lo, hi}] = true
		}
	}
	return s
}

func physSettled(b *PhysBody) bool {
	return b.Type == "static" || b.Asleep || (b.Type == "kinematic" && b.VX == 0 && b.VY == 0 && b.W == 0)
}
func physAwake(o *PhysBody) bool {
	return (o.Type == "dynamic" && !o.Asleep) || (o.Type == "kinematic" && !physSettled(o))
}

// Step advances the world by one fixed timestep dt.
func (w *PhysWorld) Step(dt float64) {
	cfg := &w.Cfg
	w.Events = nil
	bodies := w.bodies
	// 1. integrate velocities
	for _, b := range bodies {
		if b.Type != "dynamic" || b.Asleep {
			b.FX, b.FY, b.Torque = 0, 0, 0
			continue
		}
		b.VX += float64((float64(cfg.GravityX*b.GravityScale) + float64(b.FX*b.InvMass)) * dt)
		b.VY += float64((float64(cfg.GravityY*b.GravityScale) + float64(b.FY*b.InvMass)) * dt)
		b.W += float64(float64(b.Torque*b.InvI) * dt)
		b.VX /= 1 + float64(dt*b.LinearDamping)
		b.VY /= 1 + float64(dt*b.LinearDamping)
		b.W /= 1 + float64(dt*b.AngularDamp)
		b.FX, b.FY, b.Torque = 0, 0, 0
	}
	// 2. broadphase + narrowphase
	hash := NewSpatialHash(cfg.CellSize)
	margin := cfg.Slop * 2
	for _, b := range bodies {
		bb := BoundsOf(placedShape(b))
		hash.Insert(NumID(float64(b.ID)), Bounds{bb.MinX - margin, bb.MinY - margin, bb.MaxX + margin, bb.MaxY + margin}, b.Layer, b.Mask)
	}
	skip := w.jointSkip()
	prev := map[string]*PhysContact{}
	for _, c := range w.contacts {
		prev[c.Key] = c
	}
	prevSensors := map[string]bool{}
	for _, s := range w.sensors {
		prevSensors[s.Key] = true
	}
	var contacts []*PhysContact
	var sensors []PhysSensor
	for _, pr := range hash.Pairs(nil) {
		ia, ib := int(pr[0].Num), int(pr[1].Num)
		A, B := w.byID[ia], w.byID[ib]
		key := fmt.Sprintf("%d:%d", ia, ib)
		sp := A.Sensor || B.Sensor
		if A.Sensor && B.Sensor {
			continue
		}
		if sp {
			if A.Type == "static" && B.Type == "static" {
				continue
			}
		} else if A.Type != "dynamic" && B.Type != "dynamic" {
			continue
		}
		if skip[[2]int{ia, ib}] {
			continue
		}
		if !sp && physSettled(A) && physSettled(B) {
			if p, ok := prev[key]; ok {
				cc := *p
				cc.Points = append([]PhysPoint(nil), p.Points...)
				cc.carried = true
				contacts = append(contacts, &cc)
			}
			continue
		}
		m := Collide(placedShape(A), placedShape(B))
		if m == nil {
			continue
		}
		if sp {
			if A.Sensor {
				sensors = append(sensors, PhysSensor{key, ia, ib})
			} else {
				sensors = append(sensors, PhysSensor{key, ib, ia})
			}
			continue
		}
		if A.Asleep && physAwake(B) {
			w.wake(A)
		}
		if B.Asleep && physAwake(A) {
			w.wake(B)
		}
		old := prev[key]
		pts := make([]PhysPoint, len(m.Points))
		for i, p := range m.Points {
			jn, jt := 0.0, 0.0
			if old != nil {
				bd := float64(cfg.WarmRadius * cfg.WarmRadius)
				for _, q := range old.Points {
					dx, dy := q.X-p.X, q.Y-p.Y
					d2 := float64(dx*dx) + float64(dy*dy)
					if d2 < bd {
						bd = d2
						jn, jt = q.JN, q.JT
					}
				}
			}
			pts[i] = PhysPoint{X: p.X, Y: p.Y, Depth: p.Depth, JN: jn, JT: jt}
		}
		contacts = append(contacts, &PhysContact{Key: key, A: ia, B: ib, NX: m.Normal.X, NY: m.Normal.Y,
			Friction: math.Sqrt(float64(A.Friction * B.Friction)), Restitution: math.Max(A.Restitution, B.Restitution), Points: pts})
	}
	// events
	curC := map[string]bool{}
	for _, c := range contacts {
		curC[c.Key] = true
	}
	prevC := map[string]bool{}
	for _, c := range w.contacts {
		prevC[c.Key] = true
	}
	for _, c := range contacts {
		if !prevC[c.Key] {
			w.Events = append(w.Events, PhysEvent{Type: "begin", A: c.A, B: c.B})
		}
	}
	for _, c := range w.contacts {
		if !curC[c.Key] {
			w.Events = append(w.Events, PhysEvent{Type: "end", A: c.A, B: c.B})
		}
	}
	curS := map[string]bool{}
	for _, s := range sensors {
		curS[s.Key] = true
	}
	for _, s := range sensors {
		t := "enter"
		if prevSensors[s.Key] {
			t = "stay"
		}
		w.Events = append(w.Events, PhysEvent{Type: t, Sensor: s.Sensor, Other: s.Other, IsSensor: true})
	}
	for _, s := range w.sensors {
		if !curS[s.Key] {
			w.Events = append(w.Events, PhysEvent{Type: "exit", Sensor: s.Sensor, Other: s.Other, IsSensor: true})
		}
	}

	// 3. pre-solve
	var solve []*PhysContact
	for _, c := range contacts {
		if !c.carried {
			solve = append(solve, c)
		}
	}
	for _, c := range solve {
		A, B := w.byID[c.A], w.byID[c.B]
		tx, ty := c.NY, -c.NX
		for i := range c.Points {
			p := &c.Points[i]
			p.rax, p.ray, p.rbx, p.rby = p.X-A.X, p.Y-A.Y, p.X-B.X, p.Y-B.Y
			rnA, rnB := pcross(p.rax, p.ray, c.NX, c.NY), pcross(p.rbx, p.rby, c.NX, c.NY)
			rtA, rtB := pcross(p.rax, p.ray, tx, ty), pcross(p.rbx, p.rby, tx, ty)
			kN := A.InvMass + B.InvMass + float64(float64(A.InvI*rnA)*rnA) + float64(float64(B.InvI*rnB)*rnB)
			kT := A.InvMass + B.InvMass + float64(float64(A.InvI*rtA)*rtA) + float64(float64(B.InvI*rtB)*rtB)
			p.massN, p.massT = 0, 0
			if kN > 0 {
				p.massN = 1 / kN
			}
			if kT > 0 {
				p.massT = 1 / kT
			}
			dvx := (B.VX - float64(B.W*p.rby)) - (A.VX - float64(A.W*p.ray))
			dvy := (B.VY + float64(B.W*p.rbx)) - (A.VY + float64(A.W*p.rax))
			vn := float64(dvx*c.NX) + float64(dvy*c.NY)
			biasR := 0.0
			if vn < -cfg.RestitutionThresh {
				biasR = -c.Restitution * vn
			}
			biasP := math.Min(cfg.MaxBias, float64(math.Max(0, p.Depth-cfg.Slop)*cfg.Baumgarte)/dt)
			p.bias = math.Max(biasR, biasP)
			px := float64(p.JN*c.NX) + float64(p.JT*tx)
			py := float64(p.JN*c.NY) + float64(p.JT*ty)
			physApplyP(A, px, py, p.rax, p.ray, -1)
			physApplyP(B, px, py, p.rbx, p.rby, 1)
		}
	}
	for _, j := range w.joints {
		A, B := w.byID[j.A], w.byID[j.B]
		if A.Asleep && physAwake(B) {
			w.wake(A)
		}
		if B.Asleep && physAwake(A) {
			w.wake(B)
		}
	}
	var jlive []*PhysJoint
	for _, j := range w.joints {
		if !(physSettled(w.byID[j.A]) && physSettled(w.byID[j.B])) {
			jlive = append(jlive, j)
		}
	}
	for _, j := range jlive {
		w.prestepJoint(j, dt)
	}

	// 4. velocity iterations
	for it := 0; it < cfg.VelocityIterations; it++ {
		for _, j := range jlive {
			w.solveJoint(j)
		}
		for _, c := range solve {
			A, B := w.byID[c.A], w.byID[c.B]
			tx, ty := c.NY, -c.NX
			for i := range c.Points {
				p := &c.Points[i]
				dvx := (B.VX - float64(B.W*p.rby)) - (A.VX - float64(A.W*p.ray))
				dvy := (B.VY + float64(B.W*p.rbx)) - (A.VY + float64(A.W*p.rax))
				lam := -p.massT * (float64(dvx*tx) + float64(dvy*ty))
				maxF := c.Friction * p.JN
				nj := math.Min(maxF, math.Max(-maxF, p.JT+lam))
				d := nj - p.JT
				p.JT = nj
				physApplyP(A, float64(tx*d), float64(ty*d), p.rax, p.ray, -1)
				physApplyP(B, float64(tx*d), float64(ty*d), p.rbx, p.rby, 1)
			}
			for i := range c.Points {
				p := &c.Points[i]
				dvx := (B.VX - float64(B.W*p.rby)) - (A.VX - float64(A.W*p.ray))
				dvy := (B.VY + float64(B.W*p.rbx)) - (A.VY + float64(A.W*p.rax))
				lam := -p.massN * (float64(dvx*c.NX) + float64(dvy*c.NY) - p.bias)
				nj := math.Max(p.JN+lam, 0)
				d := nj - p.JN
				p.JN = nj
				physApplyP(A, float64(c.NX*d), float64(c.NY*d), p.rax, p.ray, -1)
				physApplyP(B, float64(c.NX*d), float64(c.NY*d), p.rbx, p.rby, 1)
			}
		}
	}
	// 5. integrate positions
	for _, b := range bodies {
		if b.Type == "static" || b.Asleep {
			continue
		}
		mx, my := float64(b.VX*dt), float64(b.VY*dt)
		if b.Type == "dynamic" && !b.Sensor && cfg.CCD {
			t := w.ccdFraction(b, mx, my)
			if t < 1 {
				mx *= t
				my *= t
			}
		}
		b.X += mx
		b.Y += my
		b.Angle += float64(b.W * dt)
	}
	// 6. sleeping
	if cfg.Sleep {
		var live []*PhysBody
		for _, b := range bodies {
			if b.Type == "dynamic" && !b.Asleep {
				live = append(live, b)
			}
		}
		idx := map[int]int{}
		par := make([]int, len(live))
		for i, b := range live {
			idx[b.ID] = i
			par[i] = i
		}
		find := func(i int) int {
			for par[i] != i {
				par[i] = par[par[i]]
				i = par[i]
			}
			return i
		}
		uni := func(a, b int) {
			x, ok1 := idx[a]
			y, ok2 := idx[b]
			if !ok1 || !ok2 {
				return
			}
			rx, ry := find(x), find(y)
			if rx != ry {
				hi, lo := rx, ry
				if ry > rx {
					hi, lo = ry, rx
				}
				par[hi] = lo
			}
		}
		for _, c := range solve {
			uni(c.A, c.B)
		}
		for _, j := range jlive {
			uni(j.A, j.B)
		}
		minT := map[int]float64{}
		for i, b := range live {
			still := b.AllowSleep && float64(b.VX*b.VX)+float64(b.VY*b.VY) < float64(cfg.LinearSleep*cfg.LinearSleep) && float64(b.W*b.W) < float64(cfg.AngularSleep*cfg.AngularSleep)
			if still {
				b.SleepT = b.SleepT + dt
			} else {
				b.SleepT = 0
			}
			r := find(i)
			cur, ok := minT[r]
			if !ok {
				cur = math.Inf(1)
			}
			minT[r] = math.Min(cur, b.SleepT)
		}
		isl := map[int]int{}
		for i, b := range live {
			r := find(i)
			if minT[r] >= cfg.TimeToSleep {
				if _, ok := isl[r]; !ok {
					isl[r] = w.nextIsland
					w.nextIsland++
				}
				b.Asleep = true
				b.Island = isl[r]
				b.VX, b.VY, b.W = 0, 0, 0
			}
		}
	}
	w.contacts = make([]*PhysContact, len(contacts))
	for i, c := range contacts {
		nc := &PhysContact{Key: c.Key, A: c.A, B: c.B, NX: c.NX, NY: c.NY, Friction: c.Friction, Restitution: c.Restitution}
		nc.Points = make([]PhysPoint, len(c.Points))
		for k, p := range c.Points {
			nc.Points[k] = PhysPoint{X: p.X, Y: p.Y, Depth: p.Depth, JN: p.JN, JT: p.JT}
		}
		w.contacts[i] = nc
	}
	w.sensors = sensors
	w.time += dt
	w.steps++
	if w.OnEvent != nil {
		for _, e := range w.Events {
			w.OnEvent(e)
		}
	}
}

// ccdFraction returns the safe fraction of the displacement against static solids and bounces the velocity on impact.
func (w *PhysWorld) ccdFraction(b *PhysBody, mx, my float64) float64 {
	cfg := &w.Cfg
	sh := placedShape(b)
	bb := BoundsOf(sh)
	minDim := math.Min(bb.MaxX-bb.MinX, bb.MaxY-bb.MinY) / 2
	d := math.Sqrt(float64(mx*mx) + float64(my*my))
	if d <= float64(minDim*0.5) {
		return 1
	}
	var best *CastHit2D
	var bestO *PhysBody
	for _, o := range w.bodies {
		if o.Type != "static" || o.Sensor || !CanCollide(b.Layer, b.Mask, o.Layer, o.Mask) {
			continue
		}
		ob := BoundsOf(placedShape(o))
		if !BoundsOverlap(Bounds{bb.MinX + math.Min(0, mx), bb.MinY + math.Min(0, my), bb.MaxX + math.Max(0, mx), bb.MaxY + math.Max(0, my)}, ob) {
			continue
		}
		h := ShapeCast(sh, mx, my, placedShape(o))
		lim := 1.0
		if best != nil {
			lim = best.T
		}
		if h != nil && !h.Overlap && h.T < lim {
			best, bestO = h, o
		}
	}
	if best == nil {
		return 1
	}
	vn := float64(b.VX*best.Normal.X) + float64(b.VY*best.Normal.Y)
	if vn < 0 {
		e := 0.0
		if -vn > cfg.RestitutionThresh {
			e = 1
		}
		e = math.Max(b.Restitution, bestO.Restitution) * e
		b.VX -= float64(float64((1+e)*vn) * best.Normal.X)
		b.VY -= float64(float64((1+e)*vn) * best.Normal.Y)
	}
	return best.T * (1 - 1e-6)
}

func (w *PhysWorld) prestepJoint(j *PhysJoint, dt float64) {
	cfg := &w.Cfg
	A, B := w.byID[j.A], w.byID[j.B]
	ca, sa, cb, sb := math.Cos(A.Angle), math.Sin(A.Angle), math.Cos(B.Angle), math.Sin(B.Angle)
	j.rax = float64(j.AX*ca) - float64(j.AY*sa)
	j.ray = float64(j.AX*sa) + float64(j.AY*ca)
	j.rbx = float64(j.BX*cb) - float64(j.BY*sb)
	j.rby = float64(j.BX*sb) + float64(j.BY*cb)
	dx := B.X + j.rbx - A.X - j.rax
	dy := B.Y + j.rby - A.Y - j.ray
	if j.Type == "revolute" {
		iA, iB := A.InvI, B.InvI
		mm := A.InvMass + B.InvMass
		k11 := mm + float64(float64(iA*j.ray)*j.ray) + float64(float64(iB*j.rby)*j.rby)
		k12 := float64(float64(-iA*j.rax)*j.ray) - float64(float64(iB*j.rbx)*j.rby)
		k22 := mm + float64(float64(iA*j.rax)*j.rax) + float64(float64(iB*j.rbx)*j.rbx)
		det := float64(k11*k22) - float64(k12*k12)
		id := 0.0
		if det != 0 {
			id = 1 / det
		}
		j.m11 = float64(k22 * id)
		j.m12 = float64(-k12 * id)
		j.m22 = float64(k11 * id)
		j.biasX = float64(dx*cfg.Baumgarte) / dt
		j.biasY = float64(dy*cfg.Baumgarte) / dt
		physApplyP(A, j.JX, j.JY, j.rax, j.ray, -1)
		physApplyP(B, j.JX, j.JY, j.rbx, j.rby, 1)
		return
	}
	l := math.Sqrt(float64(dx*dx) + float64(dy*dy))
	if l > 0 {
		j.ux, j.uy = dx/l, dy/l
	} else {
		j.ux, j.uy = 1, 0
	}
	C := l - j.Length
	crA, crB := pcross(j.rax, j.ray, j.ux, j.uy), pcross(j.rbx, j.rby, j.ux, j.uy)
	k := A.InvMass + B.InvMass + float64(float64(A.InvI*crA)*crA) + float64(float64(B.InvI*crB)*crB)
	if j.Stiffness > 0 {
		j.gamma = 1 / float64(dt*(j.Damping+float64(dt*j.Stiffness)))
		j.bias = float64(float64(float64(C*dt)*j.Stiffness) * j.gamma)
	} else {
		j.gamma = 0
		j.bias = float64(C*cfg.Baumgarte) / dt
	}
	if k+j.gamma > 0 {
		j.mass = 1 / (k + j.gamma)
	} else {
		j.mass = 0
	}
	physApplyP(A, float64(j.ux*j.J), float64(j.uy*j.J), j.rax, j.ray, -1)
	physApplyP(B, float64(j.ux*j.J), float64(j.uy*j.J), j.rbx, j.rby, 1)
}

func (w *PhysWorld) solveJoint(j *PhysJoint) {
	A, B := w.byID[j.A], w.byID[j.B]
	cx := (B.VX - float64(B.W*j.rby)) - (A.VX - float64(A.W*j.ray))
	cy := (B.VY + float64(B.W*j.rbx)) - (A.VY + float64(A.W*j.rax))
	if j.Type == "revolute" {
		rx, ry := -(cx + j.biasX), -(cy + j.biasY)
		ix := float64(j.m11*rx) + float64(j.m12*ry)
		iy := float64(j.m12*rx) + float64(j.m22*ry)
		j.JX += ix
		j.JY += iy
		physApplyP(A, ix, iy, j.rax, j.ray, -1)
		physApplyP(B, ix, iy, j.rbx, j.rby, 1)
		return
	}
	imp := -j.mass * (float64(cx*j.ux) + float64(cy*j.uy) + j.bias + float64(j.gamma*j.J))
	j.J += imp
	physApplyP(A, float64(j.ux*imp), float64(j.uy*imp), j.rax, j.ray, -1)
	physApplyP(B, float64(j.ux*imp), float64(j.uy*imp), j.rbx, j.rby, 1)
}

// Energy is the kinetic + gravitational potential energy of all dynamic bodies.
func (w *PhysWorld) Energy() float64 {
	e := 0.0
	for _, b := range w.bodies {
		if b.Type == "dynamic" && b.InvMass > 0 {
			m := 1 / b.InvMass
			rot := 0.0
			if b.InvI > 0 {
				rot = float64(float64(0.5*(1/b.InvI))*b.W) * b.W
			}
			e += float64(float64(0.5*m)*(float64(b.VX*b.VX)+float64(b.VY*b.VY))) + rot - float64(m*(float64(w.Cfg.GravityX*b.X)+float64(w.Cfg.GravityY*b.Y)))*b.GravityScale
		}
	}
	return e
}

type PhysRayHit struct {
	Body int
	Hit  RayHit2D
}

// Raycast is the nearest hit among non-sensor bodies (ties: lowest id).
func (w *PhysWorld) Raycast(ox, oy, dx, dy, maxT float64, includeSensors bool, layer, mask *int32) *PhysRayHit {
	var best *PhysRayHit
	for _, b := range w.bodies {
		if (b.Sensor && !includeSensors) || !CanCollide(b.Layer, b.Mask, layerOf(layer), maskOf(mask)) {
			continue
		}
		h := Raycast2D(placedShape(b), ox, oy, dx, dy, maxT)
		if h != nil && (best == nil || h.T < best.Hit.T) {
			best = &PhysRayHit{b.ID, *h}
		}
	}
	return best
}

func (w *PhysWorld) QueryAABB(bb Bounds) []int {
	out := []int{}
	for _, b := range w.bodies {
		if BoundsOverlap(BoundsOf(placedShape(b)), bb) {
			out = append(out, b.ID)
		}
	}
	return out
}

func (w *PhysWorld) QueryPoint(x, y float64) []int {
	out := []int{}
	for _, b := range w.bodies {
		if ContainsPoint(placedShape(b), x, y) {
			out = append(out, b.ID)
		}
	}
	return out
}

// ---- kinematic character controller ----------------------------------------------------------------------

type CharConfig struct {
	Gravity, JumpV, RunSpeed, AirSpeed, AirAccel float64
	HitW, HitH, StepHeight, SnapDist             float64
	MaxFall, DropTime                            float64
	// Emit is called with "jump", "hardland" or "land" (ground collider for "land").
	Emit func(name string, b *CharBody, ground *Collider)
}

func DefaultCharConfig() CharConfig {
	return CharConfig{Gravity: 520, JumpV: 200, RunSpeed: 60, AirSpeed: 60, AirAccel: 160, HitW: 8, HitH: 16, StepHeight: 4, SnapDist: 4, MaxFall: 1000, DropTime: 0.25}
}

// CharBody is a feet-anchored character: the box spans y-HitH..y.
type CharBody struct {
	X, Y, VX, VY float64
	Face         int
	Mode         string
	Layer        int
	OnPlatform   *Collider
	Landed       bool
	T, DropT     float64
	Ground       *Collider
}

func NewCharBody(x, y float64) *CharBody {
	return &CharBody{X: x, Y: y, Face: 1, Mode: "ground", Landed: true}
}

func openOv(a0, a1, b0, b1 float64) bool { return a0 < b1 && b0 < a1 }

func findSupport(cs []*Collider, b *CharBody, hw, maxDrop float64) (float64, *Collider) {
	best := math.Inf(1)
	var bc *Collider
	for _, c := range cs {
		if c.Kind == "oneway" && b.DropT > 0 {
			continue
		}
		var s float64
		if c.Kind == "slope" {
			if b.X < c.MinX || b.X > c.MaxX {
				continue
			}
			s = SurfaceY(c, b.X)
		} else {
			if !openOv(b.X-hw, b.X+hw, c.MinX, c.MaxX) {
				continue
			}
			s = c.MinY
		}
		if s >= b.Y-1e-6 && s <= b.Y+maxDrop+1e-9 && s < best {
			best, bc = s, c
		}
	}
	return best, bc
}

func moveCharacter(b *CharBody, dx, dy float64, world Source, cfg *CharConfig, wasGround bool) {
	hw, hh := cfg.HitW/2, cfg.HitH
	landed := false
	var ground *Collider
	q := func(m float64) []*Collider {
		return world.Query(Bounds{b.X - hw - m, b.Y - hh - m, b.X + hw + m, b.Y + m})
	}
	nx := math.Min(256, math.Max(1, math.Ceil(math.Abs(dx)/hw)))
	sx := dx / nx
	for i := 0; float64(i) < nx && dx != 0; i++ {
		b.X += sx
		cs := q(math.Abs(sx) + cfg.StepHeight)
		for _, c := range cs {
			if c.Kind != "solid" || !openOv(b.X-hw, b.X+hw, c.MinX, c.MaxX) || !openOv(b.Y-hh, b.Y, c.MinY, c.MaxY) {
				continue
			}
			rise := b.Y - c.MinY
			stepOK := false
			if (wasGround || landed) && rise > 0 && rise <= cfg.StepHeight {
				blocked := false
				for _, o := range cs {
					if o.Kind == "solid" && openOv(b.X-hw, b.X+hw, o.MinX, o.MaxX) && openOv(b.Y-rise-hh, b.Y-rise, o.MinY, o.MaxY) {
						blocked = true
						break
					}
				}
				stepOK = !blocked
			}
			if stepOK {
				b.Y -= rise
			} else {
				if sx > 0 {
					b.X = c.MinX - hw
				} else {
					b.X = c.MaxX + hw
				}
				b.VX = 0
			}
		}
		for _, c := range cs {
			if c.Kind != "slope" || b.X < c.MinX || b.X > c.MaxX {
				continue
			}
			s := SurfaceY(c, b.X)
			if !(b.Y > s && b.Y-hh < c.MaxY) {
				continue
			}
			grad := math.Abs(c.Slope.Y1-c.Slope.Y0) / (c.Slope.X1 - c.Slope.X0)
			if b.Y-s <= float64(math.Abs(sx)*grad)+1e-4 {
				b.Y = s
				landed = true
				ground = c
			} else {
				if sx > 0 {
					b.X = c.MinX - hw
				} else {
					b.X = c.MaxX + hw
				}
				b.VX = 0
			}
		}
	}
	prevY := b.Y
	cs := q(math.Abs(dy) + cfg.SnapDist + 1)
	if dy < 0 {
		cl := math.Inf(-1)
		for _, c := range cs {
			if c.Kind == "oneway" {
				continue
			}
			var inx bool
			if c.Kind == "slope" {
				inx = b.X >= c.MinX && b.X <= c.MaxX
			} else {
				inx = openOv(b.X-hw, b.X+hw, c.MinX, c.MaxX)
			}
			if inx && prevY-hh >= c.MaxY-1e-6 && prevY+dy-hh < c.MaxY && c.MaxY > cl {
				cl = c.MaxY
			}
		}
		if cl > math.Inf(-1) {
			b.Y = cl + hh
			b.VY = 0
		} else {
			b.Y = prevY + dy
		}
		landed = false
		ground = nil
	} else {
		if s, c := findSupport(cs, b, hw, dy); c != nil {
			b.Y = s
			landed = true
			ground = c
		} else {
			b.Y = prevY + dy
		}
	}
	if !landed && wasGround && b.VY >= 0 {
		if s, c := findSupport(q(cfg.SnapDist+1), b, hw, cfg.SnapDist); c != nil {
			b.Y = s
			landed = true
			ground = c
		}
	}
	b.Landed = landed
	b.Ground = ground
	if ground != nil && ground.Kind == "oneway" {
		b.OnPlatform = ground
	} else {
		b.OnPlatform = nil
	}
	if landed {
		b.VY = 0
		b.Mode = "ground"
	} else {
		b.Mode = "air"
	}
}

// StepCharacter advances one character one fixed tick. dx in {-1,0,1}, dy in {-1,0,1} (up negative).
func StepCharacter(b *CharBody, dxIn, dyIn float64, jumpPressed bool, dt float64, world Source, cfg *CharConfig) *CharBody {
	emit := func(n string, ground *Collider) {
		if cfg.Emit != nil {
			cfg.Emit(n, b, ground)
		}
	}
	b.T += dt
	if b.DropT > 0 {
		b.DropT -= dt
	}
	dx, dy := int(int32(int64(dxIn))), int(int32(int64(dyIn))) // JS `|0`
	wasGround := b.Mode == "ground"
	if dx != 0 {
		b.Face = dx
	}
	if wasGround {
		if jumpPressed && dy > 0 && b.Ground != nil && b.Ground.Kind == "oneway" {
			b.DropT = cfg.DropTime
			b.VY = 0
			b.VX = float64(dx) * cfg.RunSpeed
			wasGround = false
		} else if jumpPressed {
			b.VY = -cfg.JumpV
			b.VX = float64(dx) * cfg.AirSpeed
			b.Mode = "air"
			b.Landed = false
			b.Ground = nil
			b.OnPlatform = nil
			emit("jump", nil)
			return b
		} else {
			b.VX = float64(dx) * cfg.RunSpeed
			b.VY = 0
		}
	}
	if !wasGround {
		if dx != 0 {
			target := float64(dx) * cfg.AirSpeed
			a := float64(cfg.AirAccel * dt)
			if b.VX < target {
				b.VX = math.Min(target, b.VX+a)
			} else {
				b.VX = math.Max(target, b.VX-a)
			}
		}
		b.VY = math.Min(cfg.MaxFall, b.VY+float64(cfg.Gravity*dt))
	}
	impact, was := b.VY, b.Mode
	moveCharacter(b, float64(b.VX*dt), float64(b.VY*dt), world, cfg, wasGround)
	if b.Mode == "ground" && (was == "air" || !wasGround) {
		if impact > 140 {
			emit("hardland", nil)
		}
		emit("land", b.Ground)
	}
	return b
}

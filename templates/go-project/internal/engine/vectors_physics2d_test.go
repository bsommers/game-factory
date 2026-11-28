package engine

import (
	"encoding/json"
	"testing"
)

// Conformance harness for spec/v2/vectors/physics2d.json (spec/v2/physics2d.md): fixed-step world sims and the
// kinematic character controller. Ids, step numbers, event types/order, contact counts, mode, asleep exact;
// floats within 1e-9.

type physSimInput struct {
	Op      string         `json:"op"`
	Config  PhysConfigOpts `json:"config"`
	Bodies  []BodyDef      `json:"bodies"`
	Joints  []JointDef     `json:"joints"`
	Steps   int            `json:"steps"`
	DT      *float64       `json:"dt"`
	Impulse []struct {
		Step int     `json:"step"`
		ID   int     `json:"id"`
		IX   float64 `json:"ix"`
		IY   float64 `json:"iy"`
	} `json:"impulses"`
	Kinematic []struct {
		Step int     `json:"step"`
		ID   int     `json:"id"`
		VX   float64 `json:"vx"`
		VY   float64 `json:"vy"`
		W    float64 `json:"w"`
	} `json:"kinematic"`
	Checkpoints []int `json:"checkpoints"`

	// character
	Map       *TilemapOpts       `json:"map"`
	Colliders []Collider         `json:"colliders"`
	Cfg       map[string]float64 `json:"cfg"`
	Body      struct {
		X    float64 `json:"x"`
		Y    float64 `json:"y"`
		Mode string  `json:"mode"`
	} `json:"body"`
	Script []struct {
		DX float64 `json:"dx"`
		DY float64 `json:"dy"`
		N  int     `json:"n"`
		JP bool    `json:"jp"`
	} `json:"script"`
}

func runPhysics2D(t *testing.T, raw json.RawMessage) any {
	in := decode[physSimInput](t, raw)
	if in.Op == "character" {
		var src Source
		if in.Map != nil {
			src = NewTilemap(*in.Map)
		} else {
			src = NewScene(in.Colliders, 32)
		}
		cfg := DefaultCharConfig()
		for k, v := range in.Cfg {
			switch k {
			case "gravity":
				cfg.Gravity = v
			case "jumpV":
				cfg.JumpV = v
			case "runSpeed":
				cfg.RunSpeed = v
			case "airSpeed":
				cfg.AirSpeed = v
			case "airAccel":
				cfg.AirAccel = v
			case "hitW":
				cfg.HitW = v
			case "hitH":
				cfg.HitH = v
			case "stepHeight":
				cfg.StepHeight = v
			case "snapDist":
				cfg.SnapDist = v
			case "maxFall":
				cfg.MaxFall = v
			case "dropTime":
				cfg.DropTime = v
			default:
				t.Fatalf("unknown character cfg key %q", k)
			}
		}
		step := 0
		events := []map[string]any{}
		cfg.Emit = func(name string, _ *CharBody, _ *Collider) {
			events = append(events, map[string]any{"n": name, "step": step})
		}
		b := NewCharBody(in.Body.X, in.Body.Y)
		if in.Body.Mode != "" {
			b.Mode = in.Body.Mode
		}
		states := []map[string]any{}
		for _, seg := range in.Script {
			for k := 0; k < seg.N; k++ {
				StepCharacter(b, seg.DX, seg.DY, seg.JP && k == 0, 1.0/60, src, &cfg)
				step++
			}
			states = append(states, map[string]any{"step": step, "x": b.X, "y": b.Y, "vx": b.VX, "vy": b.VY, "mode": b.Mode})
		}
		return map[string]any{"states": states, "events": events}
	}

	w := NewPhysWorld(in.Config.Build())
	for _, d := range in.Bodies {
		w.AddBody(d)
	}
	for _, j := range in.Joints {
		w.AddJoint(j)
	}
	dt := 1.0 / 60
	if in.DT != nil {
		dt = *in.DT
	}
	cps := in.Checkpoints
	if cps == nil {
		cps = []int{in.Steps}
	}
	states := []map[string]any{}
	events := []map[string]any{}
	for s := 1; s <= in.Steps; s++ {
		for _, im := range in.Impulse {
			if im.Step == s {
				w.ApplyImpulse(im.ID, im.IX, im.IY, nil)
			}
		}
		for _, k := range in.Kinematic {
			if k.Step == s {
				w.KinematicStep(k.ID, k.VX, k.VY, k.W)
			}
		}
		w.Step(dt)
		for _, e := range w.Events {
			m := map[string]any{"step": s, "type": e.Type}
			if e.IsSensor {
				m["sensor"], m["other"] = e.Sensor, e.Other
			} else {
				m["a"], m["b"] = e.A, e.B
			}
			events = append(events, m)
		}
		for _, c := range cps {
			if c == s {
				bs := []map[string]any{}
				for _, b := range w.Bodies() {
					bs = append(bs, map[string]any{"id": b.ID, "x": b.X, "y": b.Y, "angle": b.Angle, "vx": b.VX, "vy": b.VY, "w": b.W, "asleep": b.Asleep})
				}
				states = append(states, map[string]any{"step": s, "bodies": bs})
				break
			}
		}
	}
	contacts := []map[string]any{}
	for _, c := range w.Contacts() {
		jn := []float64{}
		for _, p := range c.Points {
			jn = append(jn, p.JN)
		}
		contacts = append(contacts, map[string]any{"key": c.Key, "points": len(c.Points), "jn": jn})
	}
	return map[string]any{"states": states, "events": events, "contacts": contacts}
}

func TestVectorsPhysics2D(t *testing.T) {
	runSpecVectors(t, "v2", "physics2d.json", runPhysics2D)
}

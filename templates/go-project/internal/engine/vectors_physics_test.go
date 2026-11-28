package engine

import (
	"encoding/json"
	"fmt"
	"testing"
)

type physCfg map[string]float64

func (m physCfg) apply() Config {
	c := DefaultConfig()
	for k, v := range m {
		switch k {
		case "gravity":
			c.Gravity = v
		case "jumpV":
			c.JumpV = v
		case "runSpeed":
			c.RunSpeed = v
		case "airSpeed":
			c.AirSpeed = v
		case "airAccel":
			c.AirAccel = v
		case "climbSpeed":
			c.ClimbSpeed = v
		case "hitW":
			c.HitW = v
		case "hitH":
			c.HitH = v
		case "grabR":
			c.GrabR = v
		case "grabCooldown":
			c.GrabCooldown = v
		case "swingBlend":
			c.SwingBlend = v
		case "edgeL":
			c.EdgeL = v
		case "edgeR":
			c.EdgeR = v
		case "stride":
			c.Stride = int(v)
		}
	}
	return c
}

type movingJSON struct {
	X0    float64  `json:"x0"`
	Y0    float64  `json:"y0"`
	X1    *float64 `json:"x1"`
	Y1    *float64 `json:"y1"`
	W     *float64 `json:"w"`
	Speed *float64 `json:"speed"`
	Phase *float64 `json:"phase"`
}

func (m movingJSON) build(id string) *MovingPlatform {
	x1, y1 := m.X0, m.Y0
	if m.X1 != nil {
		x1 = *m.X1
	}
	if m.Y1 != nil {
		y1 = *m.Y1
	}
	var opts []MovingOpt
	if m.W != nil {
		opts = append(opts, MovingWidth(*m.W))
	}
	if m.Speed != nil {
		opts = append(opts, MovingSpeed(*m.Speed))
	}
	if m.Phase != nil {
		opts = append(opts, MovingPhase(*m.Phase))
	}
	return NewMovingPlatform(id, m.X0, m.Y0, x1, y1, opts...)
}

type worldJSON struct {
	GroundY float64 `json:"groundY"`
	Pits    []struct {
		X0   float64 `json:"x0"`
		X1   float64 `json:"x1"`
		Kind string  `json:"kind"`
		Drop bool    `json:"drop"`
	} `json:"pits"`
	Platforms []struct {
		ID     any         `json:"id"`
		X      float64     `json:"x"`
		Y      float64     `json:"y"`
		W      float64     `json:"w"`
		Moving *movingJSON `json:"moving"`
	} `json:"platforms"`
	Ladders []Ladder `json:"ladders"`
	Ropes   []struct {
		Px, Py, Len, Amp, Period float64
	} `json:"ropes"`
	Bounds *struct {
		MinY float64 `json:"minY"`
	} `json:"bounds"`
}

func idString(id any) string {
	switch v := id.(type) {
	case nil:
		return ""
	case string:
		return v
	}
	return fmt.Sprint(id)
}

func (wj worldJSON) build() (*World, []*MovingPlatform) {
	w := &World{GroundY: wj.GroundY, Ladders: wj.Ladders}
	for _, p := range wj.Pits {
		w.Pits = append(w.Pits, Pit{X0: p.X0, X1: p.X1, Kind: p.Kind, Drop: p.Drop})
	}
	var movers []*MovingPlatform
	for _, p := range wj.Platforms {
		if p.Moving != nil {
			m := p.Moving.build(idString(p.ID))
			movers = append(movers, m)
			w.Platforms = append(w.Platforms, &m.Platform)
		} else {
			w.Platforms = append(w.Platforms, &Platform{ID: idString(p.ID), X: p.X, Y: p.Y, W: p.W})
		}
	}
	for _, r := range wj.Ropes {
		w.Ropes = append(w.Ropes, &Pendulum{Px: r.Px, Py: r.Py, Len: r.Len, Amp: r.Amp, Period: r.Period})
	}
	if wj.Bounds != nil {
		w.MinY, w.HasMinY = wj.Bounds.MinY, true
	}
	return w, movers
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func TestVectorsPlatformerPhysics(t *testing.T) {
	runVectors(t, "platformer-physics.json", func(t *testing.T, raw json.RawMessage) any {
		var head struct {
			Op  string  `json:"op"`
			Cfg physCfg `json:"cfg"`
		}
		if err := json.Unmarshal(raw, &head); err != nil {
			t.Fatal(err)
		}
		cfg := head.Cfg.apply()
		switch head.Op {
		case "ranges":
			return map[string]any{"jumpRange": cfg.JumpRange(), "jumpHeight": cfg.JumpHeight()}
		case "pendulum":
			in := decode[struct {
				Rope struct{ Px, Py, Len, Amp, Period float64 } `json:"rope"`
				Ts   []float64                                  `json:"ts"`
			}](t, raw)
			p := Pendulum(in.Rope)
			samples := []any{}
			for _, ts := range in.Ts {
				samples = append(samples, map[string]any{"angle": p.Angle(ts), "tip": p.Tip(ts), "tipVel": p.TipVel(ts)})
			}
			return map[string]any{"samples": samples}
		case "moving":
			in := decode[struct {
				Platform movingJSON `json:"platform"`
				Dt       float64    `json:"dt"`
				Ticks    int        `json:"ticks"`
			}](t, raw)
			m := in.Platform.build("")
			fr := func() any { return map[string]any{"x": m.X, "y": m.Y, "dx": m.DX, "dy": m.DY, "t": m.T} }
			frames := []any{fr()}
			for i := 0; i < in.Ticks; i++ {
				m.Update(in.Dt)
				frames = append(frames, fr())
			}
			return map[string]any{"frames": frames}
		case "support":
			in := decode[struct {
				World     worldJSON   `json:"world"`
				PitAt     []float64   `json:"pitAt"`
				LadderAt  [][]float64 `json:"ladderAt"`
				SupportAt [][]float64 `json:"supportAt"`
			}](t, raw)
			w, _ := in.World.build()
			out := map[string]any{"pitAt": []any{}, "ladderAt": []any{}, "supportAt": []any{}}
			var pa, la, sa []any
			for _, x := range in.PitAt {
				pa = append(pa, pitIndex(w, w.PitAt(x)))
			}
			for _, q := range in.LadderAt {
				la = append(la, ladderIndex(w, w.LadderAt(q[0], q[1])))
			}
			for _, q := range in.SupportAt {
				y, p, ok := w.SupportAt(q[0], q[1])
				if !ok {
					sa = append(sa, nil)
					continue
				}
				var pid any
				if p != nil {
					pid = nullable(p.ID)
				}
				sa = append(sa, map[string]any{"y": y, "platform": pid})
			}
			if pa != nil {
				out["pitAt"] = pa
			}
			if la != nil {
				out["ladderAt"] = la
			}
			if sa != nil {
				out["supportAt"] = sa
			}
			return out
		case "edge":
			in := decode[struct {
				Cases []struct {
					Body struct {
						X    float64 `json:"x"`
						Mode string  `json:"mode"`
					} `json:"body"`
					Idx, Count int
					Cfg        physCfg `json:"cfg"`
				} `json:"cases"`
			}](t, raw)
			res := []any{}
			for _, c := range in.Cases {
				b := NewBody(c.Body.X, 0)
				if c.Body.Mode != "" {
					b.Mode = Mode(c.Body.Mode)
				}
				cc := c.Cfg.apply()
				var tr any
				if x, ok := EdgeTransition(b, c.Idx, c.Count, &cc); ok {
					tr = x
				}
				res = append(res, map[string]any{"wrapIndex": WrapIndex(c.Idx, c.Count), "tr": tr})
			}
			return map[string]any{"results": res}
		case "sim":
			return runPhysicsSim(t, raw, &cfg)
		}
		t.Fatalf("unknown op %s", head.Op)
		return nil
	})
}

func pitIndex(w *World, q *Pit) any {
	for i := range w.Pits {
		if &w.Pits[i] == q && q != nil {
			return i
		}
	}
	return nil
}

func ladderIndex(w *World, l *Ladder) any {
	for i := range w.Ladders {
		if &w.Ladders[i] == l && l != nil {
			return i
		}
	}
	return nil
}

func runPhysicsSim(t *testing.T, raw json.RawMessage, cfg *Config) any {
	in := decode[struct {
		World worldJSON `json:"world"`
		Body  struct {
			X, Y float64
			Set  struct {
				Mode  string   `json:"mode"`
				VY    *float64 `json:"vy"`
				GrabC *float64 `json:"grabCd"`
			} `json:"set"`
		} `json:"body"`
		Script []struct {
			DX, DY int
			JP     bool `json:"jp"`
			N      int  `json:"n"`
		} `json:"script"`
		Dt       float64 `json:"dt"`
		UseWorld bool    `json:"useWorldT"`
	}](t, raw)
	w, movers := in.World.build()
	b := NewBody(in.Body.X, in.Body.Y)
	if in.Body.Set.Mode != "" {
		b.Mode = Mode(in.Body.Set.Mode)
	}
	if in.Body.Set.VY != nil {
		b.VY = *in.Body.Set.VY
	}
	if in.Body.Set.GrabC != nil {
		b.GrabCd = *in.Body.Set.GrabC
	}
	events := []any{}
	tick := 0
	cfg.Emit = func(e Event) {
		var extra any
		switch x := e.Extra.(type) {
		case nil:
		case *Platform:
			extra = map[string]any{"platform": nullable(x.ID)}
		case *Pit:
			extra = map[string]any{"pit": pitIndex(w, x)}
		case *Ladder:
			extra = map[string]any{"ladder": ladderIndex(w, x)}
		case Tip:
			extra = x
		case string:
			extra = x
		default:
			t.Fatalf("unexpected event extra %T", e.Extra)
		}
		events = append(events, map[string]any{"tick": tick, "name": e.Name, "extra": extra})
	}
	var seq []Input
	for _, s := range in.Script {
		for i := 0; i < s.N; i++ {
			seq = append(seq, Input{DX: s.DX, DY: s.DY, JumpPressed: s.JP})
		}
	}
	clock := 0.0
	frames := []any{}
	for tick = 0; tick < len(seq); tick++ {
		for _, m := range movers {
			m.Update(in.Dt)
		}
		if in.UseWorld {
			clock += in.Dt
			w.SetTime(clock)
		}
		StepBody(b, seq[tick], in.Dt, w, cfg)
		var onp, rope, lad any
		if b.OnPlatform != nil {
			onp = "[obj]"
			if b.OnPlatform.ID != "" {
				onp = b.OnPlatform.ID
			}
		}
		for i, r := range w.Ropes {
			if r == b.Rope && r != nil {
				rope = i
			}
		}
		lad = ladderIndex(w, b.Ladder)
		frames = append(frames, map[string]any{
			"x": b.X, "y": b.Y, "vx": b.VX, "vy": b.VY, "face": b.Face, "mode": string(b.Mode),
			"layer": b.Layer, "landed": b.Landed, "onPlatform": onp, "grabCd": b.GrabCd,
			"swingK": b.SwingK, "offX": b.OffX, "offY": b.OffY, "t": b.T,
			"deathKind": nullable(b.DeathKind), "rope": rope, "ladder": lad,
		})
	}
	return map[string]any{"frames": frames, "events": events}
}

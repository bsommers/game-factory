package engine

import (
	"encoding/json"
	"fmt"
	"testing"
)

type kindJSON struct {
	Pattern  string         `json:"pattern"`
	Params   map[string]any `json:"params"`
	Defaults map[string]any `json:"defaults"`
}

// propOpts converts a JSON props object (spawn props or kind defaults) into entity Opts.
func propOpts(m map[string]any) []Opt {
	var opts []Opt
	num := func(v any) float64 { f, _ := v.(float64); return f }
	for k, v := range m {
		k, v := k, v
		switch k {
		case "x":
			opts = append(opts, func(e *Entity) { e.X = num(v) })
		case "y":
			opts = append(opts, func(e *Entity) { e.Y = num(v) })
		case "w":
			opts = append(opts, func(e *Entity) { e.W = num(v) })
		case "h":
			opts = append(opts, func(e *Entity) { e.H = num(v) })
		case "t":
			opts = append(opts, func(e *Entity) { e.T = num(v) })
		case "dir":
			opts = append(opts, WithDir(num(v)))
		case "speed":
			opts = append(opts, WithSpeed(num(v)))
		case "points":
			opts = append(opts, func(e *Entity) { e.Points = Ptr(num(v)) })
		case "topY":
			opts = append(opts, func(e *Entity) { e.TopY = Ptr(num(v)) })
		case "dead":
			opts = append(opts, func(e *Entity) { e.Dead = v == true })
		case "collect":
			opts = append(opts, func(e *Entity) { e.Collect = v == true })
		case "layer":
			opts = append(opts, func(e *Entity) { e.Layer, _ = v.(string) })
		case "lethal":
			opts = append(opts, func(e *Entity) { s, _ := v.(string); e.Lethal = Lethal(s) })
		case "st":
			for sk, sv := range v.(map[string]any) {
				opts = append(opts, WithSt(sk, num(sv)))
			}
		default:
			panic("unhandled prop " + k)
		}
	}
	return opts
}

type faulty struct{}

func (faulty) Init(*Entity, *Game)            {}
func (faulty) Update(*Entity, float64, *Game) { panic("boom") }

func fill(t *testing.T, params map[string]any, into any) {
	t.Helper()
	b, _ := json.Marshal(params)
	if err := json.Unmarshal(b, into); err != nil {
		t.Fatal(err)
	}
}

// behaviourFor builds the declarative fixture behaviour (spec: spawner.params.props and
// tauntingBoss.params.throwProps are static objects standing in for the closures).
func behaviourFor(t *testing.T, k kindJSON) Behaviour {
	p := map[string]any{}
	for a, b := range k.Params {
		p[a] = b
	}
	switch k.Pattern {
	case "patroller":
		b := DefaultPatroller()
		fill(t, p, b)
		return b
	case "roller":
		b := DefaultRoller()
		fill(t, p, b)
		return b
	case "stationary":
		b := DefaultStationary()
		fill(t, p, b)
		return b
	case "cycler":
		b := DefaultCycler()
		fill(t, p, b)
		return b
	case "spawner":
		props, _ := p["props"].(map[string]any)
		delete(p, "props")
		b := DefaultSpawner()
		fill(t, p, b)
		b.MakeProps = func(*Entity, *Game) []Opt { return propOpts(props) }
		return b
	case "tauntingBoss":
		props, hasProps := p["throwProps"].(map[string]any)
		delete(p, "throwProps")
		b := DefaultTauntingBoss()
		fill(t, p, b)
		if hasProps {
			b.ThrowProps = func(*Entity, *Game) []Opt { return propOpts(props) }
		}
		return b
	case "faulty":
		return faulty{}
	}
	t.Fatalf("unknown pattern %s", k.Pattern)
	return nil
}

func makeRegistry(t *testing.T, kinds map[string]kindJSON) *Registry {
	reg := NewRegistry()
	for name, k := range kinds {
		reg.Register(name, behaviourFor(t, k), propOpts(k.Defaults)...)
	}
	return reg
}

func entSnap(e *Entity) map[string]any {
	st := map[string]any{}
	for k, v := range e.St {
		st[k] = v
	}
	if e.LastTaunt != "" {
		st["last"] = e.LastTaunt
	}
	m := map[string]any{
		"id": e.ID, "kind": e.Kind, "x": e.X, "y": e.Y, "w": e.W, "h": e.H, "vx": e.VX, "t": e.T,
		"frame": e.Frame, "lethal": nullable(string(e.Lethal)), "solidTop": e.SolidTop,
		"dead": e.Dead, "layer": e.Layer, "st": st,
	}
	if e.Collect {
		m["collect"] = true
	}
	if e.Points != nil {
		m["points"] = *e.Points
	}
	if e.TopY != nil {
		m["topY"] = *e.TopY
	}
	if e.Dir != nil {
		m["dir"] = *e.Dir
	}
	if e.Speed != nil {
		m["speed"] = *e.Speed
	}
	if e.HasOpen {
		m["open"] = e.Open
	}
	return m
}

func snaps(ents []*Entity) []any {
	out := []any{}
	for _, e := range ents {
		out = append(out, entSnap(e))
	}
	return out
}

type entSpec struct {
	Kind  string         `json:"kind"`
	Props map[string]any `json:"props"`
}

func spawnAll(t *testing.T, reg *Registry, specs []entSpec, g *Game) []*Entity {
	var ents []*Entity
	for _, s := range specs {
		e, err := reg.Spawn(s.Kind, g, propOpts(s.Props)...)
		if err != nil {
			t.Fatal(err)
		}
		ents = append(ents, e)
	}
	return ents
}

func orNilKind(c Contact) (any, any) {
	var kind, amount any
	if c.Type == ContactKill {
		kind = c.Kind
	}
	if c.Type == ContactPoints {
		amount = c.Amount
	}
	return kind, amount
}

func TestVectorsHazardKit(t *testing.T) {
	runVectors(t, "hazard-kit.json", func(t *testing.T, raw json.RawMessage) any {
		var head struct {
			Op string `json:"op"`
		}
		_ = json.Unmarshal(raw, &head)
		switch head.Op {
		case "overlaps":
			in := decode[struct {
				Cases []struct {
					P      Player                       `json:"p"`
					HW, HH float64                      `json:"-"`
					E      struct{ X, Y, W, H float64 } `json:"e"`
				} `json:"cases"`
			}](t, raw)
			var cases []struct {
				Hw float64 `json:"hw"`
				Hh float64 `json:"hh"`
			}
			_ = json.Unmarshal(mustField(t, raw, "cases"), &cases)
			res := []any{}
			for i, c := range in.Cases {
				e := &Entity{X: c.E.X, Y: c.E.Y, W: c.E.W, H: c.E.H}
				res = append(res, Overlaps(c.P, cases[i].Hw, cases[i].Hh, e))
			}
			return map[string]any{"results": res}
		case "sim":
			in := decode[struct {
				Kinds    map[string]kindJSON `json:"kinds"`
				Entities []entSpec           `json:"entities"`
				Ticks    int                 `json:"ticks"`
				Dt       float64             `json:"dt"`
				Width    float64             `json:"width"`
				RngSeed  *float64            `json:"rngSeed"`
				NoRng    bool                `json:"noRng"`
			}](t, raw)
			reg := makeRegistry(t, in.Kinds)
			var ents []*Entity
			events := []any{}
			tick := 0
			g := &Game{Width: in.Width}
			if in.RngSeed != nil && !in.NoRng {
				g.RNG = NewPCG32(seedU32(*in.RngSeed))
			}
			g.Spawn = func(kind string, opts ...Opt) *Entity {
				e, err := reg.Spawn(kind, g, opts...)
				if err != nil {
					panic(err)
				}
				ents = append(ents, e)
				return e
			}
			g.Emit = func(ev EmitEvent) {
				data := map[string]any{}
				switch ev.Name {
				case "taunt":
					data = map[string]any{"text": ev.Text, "dur": ev.Dur, "ent": ev.Ent.ID}
				case "sfx":
					data = map[string]any{"name": ev.SFX}
				}
				events = append(events, map[string]any{"tick": tick, "name": ev.Name, "data": data})
			}
			for _, s := range in.Entities {
				g.Spawn(s.Kind, propOpts(s.Props)...)
			}
			frames := []any{snaps(ents)}
			for tick = 1; tick <= in.Ticks; tick++ {
				reg.Update(&ents, in.Dt, g)
				frames = append(frames, snaps(ents))
			}
			return map[string]any{"frames": frames, "events": events, "count": len(ents)}
		case "contacts":
			in := decode[struct {
				Kinds    map[string]kindJSON `json:"kinds"`
				Entities []entSpec           `json:"entities"`
				Steps    []struct {
					Time   *float64 `json:"time"`
					Player Player   `json:"player"`
				} `json:"steps"`
				Opts map[string]float64 `json:"opts"`
			}](t, raw)
			reg := makeRegistry(t, in.Kinds)
			ents := spawnAll(t, reg, in.Entities, &Game{})
			o := DefaultContactOpts()
			for k, v := range in.Opts {
				switch k {
				case "hitW":
					o.HitW = v
				case "hitH":
					o.HitH = v
				case "hitCooldown":
					o.HitCooldown = v
				case "pointsPenalty":
					o.PointsPenalty = v
				default:
					t.Fatalf("opt %s", k)
				}
			}
			steps := []any{}
			for _, s := range in.Steps {
				g := &Game{}
				if s.Time != nil {
					g.Time, g.HasTime = *s.Time, true
				}
				res := []any{}
				for _, c := range ResolveContacts(reg, s.Player, ents, o, g) {
					kind, amount := orNilKind(c)
					res = append(res, map[string]any{"type": string(c.Type), "ent": c.Ent.ID, "kind": kind, "amount": amount})
				}
				steps = append(steps, res)
			}
			return map[string]any{"steps": steps, "ents": snaps(ents)}
		case "solid":
			in := decode[struct {
				Kinds    map[string]kindJSON `json:"kinds"`
				Entities []entSpec           `json:"entities"`
				Under    [][]float64         `json:"under"`
				Carrying [][]float64         `json:"carrying"`
			}](t, raw)
			reg := makeRegistry(t, in.Kinds)
			ents := spawnAll(t, reg, in.Entities, &Game{})
			id := func(e *Entity) any {
				if e == nil {
					return nil
				}
				return e.ID
			}
			slack := func(q []float64, i int) float64 {
				if len(q) > i {
					return q[i]
				}
				return DefaultSlack
			}
			under, carrying := []any{}, []any{}
			for _, q := range in.Under {
				under = append(under, id(SolidTopUnder(ents, q[0], q[1], q[2], slack(q, 3))))
			}
			for _, q := range in.Carrying {
				carrying = append(carrying, id(SolidTopCarrying(ents, q[0], q[1], slack(q, 2))))
			}
			return map[string]any{"under": under, "carrying": carrying}
		}
		t.Fatalf("unknown op %s", head.Op)
		return nil
	})
}

func mustField(t *testing.T, raw json.RawMessage, key string) json.RawMessage {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m[key]
}

// ---- autopilot ----------------------------------------------------------------------------

func TestVectorsAutopilot(t *testing.T) {
	runVectors(t, "autopilot.json", func(t *testing.T, raw json.RawMessage) any {
		var head struct {
			Op string `json:"op"`
		}
		_ = json.Unmarshal(raw, &head)
		switch head.Op {
		case "input":
			in := decode[struct {
				Args []any `json:"args"`
			}](t, raw)
			for len(in.Args) < 3 { // JS default parameters: dx=0, dy=0, jp=false
				in.Args = append(in.Args, nil)
			}
			dx, _ := in.Args[0].(float64)
			dy, _ := in.Args[1].(float64)
			jp, _ := in.Args[2].(bool)
			return map[string]any{"value": NewBotInput(int(dx), int(dy), jp)}
		case "botRng":
			in := decode[struct {
				Seed float64 `json:"seed"`
				N    int     `json:"n"`
			}](t, raw)
			r := NewBotRNG(int64(in.Seed))
			vals := []any{}
			for i := 0; i < in.N; i++ {
				vals = append(vals, r.Float64())
			}
			return map[string]any{"values": vals}
		case "trajectory":
			in := decode[struct {
				Kinds    map[string]kindJSON `json:"kinds"`
				Entities []entSpec           `json:"entities"`
				N        int                 `json:"n"`
				Dt       float64             `json:"dt"`
			}](t, raw)
			reg := makeRegistry(t, in.Kinds)
			ents := spawnAll(t, reg, in.Entities, &Game{})
			upd := func(e *Entity, dt float64) { reg.Update(&[]*Entity{e}, dt, &Game{}) }
			frames := Trajectory(ents, in.N, in.Dt, upd, func(e *Entity) any { return entSnap(e) })
			return map[string]any{"frames": frames}
		case "search":
			in := decode[struct {
				Families  []struct{ Bias float64 } `json:"families"`
				CostTable [][]float64              `json:"costTable"`
				Opts      struct {
					Count       *int     `json:"count"`
					Stride      *int     `json:"stride"`
					RobustBelow *float64 `json:"robustBelow"`
					NTax        *float64 `json:"nTax"`
				} `json:"opts"`
			}](t, raw)
			type macro struct {
				Family int `json:"family"`
				N      int `json:"n"`
			}
			var fams []Family[macro]
			for fi, f := range in.Families {
				fi := fi
				fams = append(fams, Family[macro]{Bias: f.Bias, Make: func(n int) macro { return macro{fi, n} }})
			}
			so := DefaultSearchOpts()
			if in.Opts.Count != nil {
				so.Count = *in.Opts.Count
			}
			if in.Opts.Stride != nil {
				so.Stride = *in.Opts.Stride
			}
			if in.Opts.RobustBelow != nil {
				so.RobustBelow = *in.Opts.RobustBelow
			}
			if in.Opts.NTax != nil {
				so.NTax = *in.Opts.NTax
			}
			cost := func(m macro) float64 { return in.CostTable[m.Family][m.N/so.Stride] }
			r := SearchMacros(fams, cost, so)
			if r == nil {
				return map[string]any{"result": nil}
			}
			return map[string]any{"result": map[string]any{"cost": r.Cost, "family": r.Family, "n": r.N, "macro": r.Macro}}
		case "watchdog":
			in := decode[struct {
				Opts struct {
					Limit      *float64 `json:"limit"`
					PanicTicks *int     `json:"panicTicks"`
				} `json:"opts"`
				Ticks [][]any `json:"ticks"`
			}](t, raw)
			wd := DefaultWatchdog()
			if in.Opts.Limit != nil {
				wd.Limit = *in.Opts.Limit
			}
			if in.Opts.PanicTicks != nil {
				wd.PanicTicks = *in.Opts.PanicTicks
			}
			steps := []any{}
			for i, tk := range in.Ticks {
				key := fmt.Sprint(tk[0])
				tm, _ := tk[1].(float64)
				flail := wd.Tick(key, tm)
				var inp any
				if flail {
					inp = wd.Flail(i + 1)
				}
				steps = append(steps, map[string]any{"flail": flail, "input": inp, "stuck": wd.Stuck})
			}
			return map[string]any{"steps": steps}
		case "humanize":
			in := decode[struct {
				Skill float64 `json:"skill"`
				Rng   struct {
					Kind string `json:"kind"`
					Seed any    `json:"seed"`
				} `json:"rng"`
				Seq []struct {
					DX     int   `json:"dx"`
					JP     bool  `json:"jp"`
					CanAct *bool `json:"canAct"`
				} `json:"seq"`
			}](t, raw)
			var rng func() float64
			seedNum, _ := in.Rng.Seed.(float64)
			switch s := in.Rng.Seed.(type) {
			case string:
				rng = NewPCG32FromString(s).Float64
			default:
				if in.Rng.Kind == "pcg32" {
					rng = NewPCG32(seedU32(seedNum)).Float64
				} else {
					rng = NewBotRNG(int64(seedNum)).Float64
				}
			}
			h := Humanize(in.Skill, rng)
			out := []any{}
			for _, s := range in.Seq {
				can := s.CanAct == nil || *s.CanAct
				out = append(out, h(NewBotInput(s.DX, 0, s.JP), can))
			}
			return map[string]any{"outputs": out}
		case "autopilot":
			type tick struct {
				Key         string  `json:"key"`
				Time        float64 `json:"time"`
				Playing     *bool   `json:"playing"`
				CanHumanize *bool   `json:"canHumanize"`
				Decide      any     `json:"decide"`
			}
			in := decode[struct {
				Cfg struct {
					Skill    *float64 `json:"skill"`
					Seed     *int64   `json:"seed"`
					Watchdog struct {
						Limit      *float64 `json:"limit"`
						PanicTicks *int     `json:"panicTicks"`
					} `json:"watchdog"`
				} `json:"cfg"`
				Ticks []tick `json:"ticks"`
			}](t, raw)
			ap := NewAutopilot(AutopilotConfig[*tick]{
				Decide: func(g *tick, _ float64) (BotInput, error) {
					d, ok := g.Decide.(map[string]any)
					if !ok {
						return BotInput{}, fmt.Errorf("decide failed")
					}
					dx, _ := d["dx"].(float64)
					dy, _ := d["dy"].(float64)
					jump, _ := d["jump"].(bool)
					return NewBotInput(int(dx), int(dy), jump), nil
				},
				ProgressKey: func(g *tick) string { return g.Key },
				Time:        func(g *tick) float64 { return g.Time },
				Playing:     func(g *tick) bool { return g.Playing == nil || *g.Playing },
				CanHumanize: func(g *tick) bool { return g.CanHumanize == nil || *g.CanHumanize },
				Skill:       in.Cfg.Skill, Seed: in.Cfg.Seed,
				WatchLimit: in.Cfg.Watchdog.Limit, WatchPanic: in.Cfg.Watchdog.PanicTicks,
			})
			outs := []any{}
			for i := range in.Ticks {
				outs = append(outs, ap.Input(&in.Ticks[i], 1.0/60))
			}
			return map[string]any{"outputs": outs, "stats": map[string]any{
				"errors": ap.Stats.Errors, "stuck": ap.Stats.Stuck, "hasError": ap.Stats.LastError != ""}}
		}
		t.Fatalf("unknown op %s", head.Op)
		return nil
	})
}

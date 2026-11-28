package engine

import (
	"encoding/json"
	"math"
	"testing"
)

// Conformance harness for spec/v3/vectors/character.json (runner contract: spec/v3/collision3d.md,
// "Character vectors"). Floats compare at 1e-9, grounded exactly.

func TestVectorsCharacter(t *testing.T) {
	cases := loadSpecCases(t, "v3", "character.json")
	const tol = 1e-9
	for _, raw := range cases {
		var c struct {
			Name string `json:"name"`
			Cfg  struct {
				Pos           *V3      `json:"pos"`
				Radius        *float64 `json:"radius"`
				Height        *float64 `json:"height"`
				StepHeight    *float64 `json:"stepHeight"`
				MinGroundY    *float64 `json:"minGroundY"`
				Skin          *float64 `json:"skin"`
				SnapDistance  *float64 `json:"snapDistance"`
				MaxIterations *int     `json:"maxIterations"`
			} `json:"cfg"`
			World        json.RawMessage `json:"world"`
			ReportGround bool            `json:"reportGround"`
			Script       []struct {
				Vel      *V3 `json:"vel"`
				Platform *struct {
					From     int `json:"from"`
					Count    int `json:"count"`
					Velocity V3  `json:"velocity"`
				} `json:"platform"`
				Jump *float64 `json:"jump"`
				DX   float64  `json:"dx"`
				DZ   float64  `json:"dz"`
				N    int      `json:"n"`
			} `json:"script"`
			Expected struct {
				Trace [][4]float64 `json:"trace"`
				Final struct {
					Pos            V3   `json:"pos"`
					Vel            V3   `json:"vel"`
					Grounded       bool `json:"grounded"`
					GroundNormal   V3   `json:"groundNormal"`
					GroundIndex    *int `json:"groundIndex"`
					GroundMaterial *int `json:"groundMaterial"`
				} `json:"final"`
			} `json:"expected"`
		}
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatal(err)
		}
		t.Run(c.Name, func(t *testing.T) {
			ch := NewCharacter(CharacterOpts{Pos: c.Cfg.Pos, Radius: c.Cfg.Radius, Height: c.Cfg.Height, StepHeight: c.Cfg.StepHeight,
				MinGroundY: c.Cfg.MinGroundY, Skin: c.Cfg.Skin, SnapDistance: c.Cfg.SnapDistance, MaxIterations: c.Cfg.MaxIterations})
			// world = flat soup or {tris, materials}; platform segments translate triangles of a private copy.
			var tris []float64
			var mats []*int
			if err := json.Unmarshal(c.World, &tris); err != nil {
				var ow struct {
					Tris      []float64 `json:"tris"`
					Materials []*int    `json:"materials"`
				}
				if err := json.Unmarshal(c.World, &ow); err != nil {
					t.Fatal(err)
				}
				tris, mats = ow.Tris, ow.Materials
			}
			w := SoupWorld(tris)
			w.Materials = mats
			dt := 1.0 / 60
			vy := 0.0
			step := 0
			near := func(what string, got, want float64) {
				if math.Abs(got-want) > tol || math.IsNaN(got) {
					t.Fatalf("step %d %s: got %.17g want %.17g", step, what, got, want)
				}
			}
			for _, seg := range c.Script {
				if seg.Jump != nil {
					vy = *seg.Jump
				}
				for k := 0; k < seg.N; k++ {
					var vel V3
					if seg.Vel != nil {
						vel = *seg.Vel
					} else {
						if ch.Grounded && vy <= 0 {
							vy = 0
						} else {
							vy = vy - float64(20*dt)
						}
						vel = V3{seg.DX, vy, seg.DZ}
					}
					if pf := seg.Platform; pf != nil {
						for tr := pf.From; tr < pf.From+pf.Count; tr++ {
							for q := 0; q < 9; q++ {
								tris[tr*9+q] += float64(pf.Velocity[q%3] * dt)
							}
						}
						ch.GroundVelocity = pf.Velocity
					} else {
						ch.GroundVelocity = V3{}
					}
					ch.MoveAndSlide(vel, dt, w)
					if seg.Vel == nil && ch.Grounded && vy <= 0 {
						vy = 0
					}
					if step >= len(c.Expected.Trace) {
						t.Fatalf("trace longer than expected (%d)", len(c.Expected.Trace))
					}
					e := c.Expected.Trace[step]
					for i := 0; i < 3; i++ {
						near("pos", ch.Pos[i], e[i])
					}
					g := 0.0
					if ch.Grounded {
						g = 1
					}
					if g != e[3] {
						t.Fatalf("step %d grounded: got %v want %v", step, ch.Grounded, e[3])
					}
					step++
				}
			}
			if step != len(c.Expected.Trace) {
				t.Fatalf("trace length %d want %d", step, len(c.Expected.Trace))
			}
			f := c.Expected.Final
			for i := 0; i < 3; i++ {
				near("final pos", ch.Pos[i], f.Pos[i])
				near("final vel", ch.Vel[i], f.Vel[i])
				near("final groundNormal", ch.GroundNormal[i], f.GroundNormal[i])
			}
			if c.ReportGround {
				if f.GroundIndex == nil || ch.GroundIndex != *f.GroundIndex {
					t.Fatalf("final groundIndex %d want %v", ch.GroundIndex, f.GroundIndex)
				}
				if (ch.GroundMaterial == nil) != (f.GroundMaterial == nil) || (ch.GroundMaterial != nil && *ch.GroundMaterial != *f.GroundMaterial) {
					t.Fatalf("final groundMaterial %v want %v", ch.GroundMaterial, f.GroundMaterial)
				}
			}
			if ch.Grounded != f.Grounded {
				t.Fatalf("final grounded %v want %v", ch.Grounded, f.Grounded)
			}
		})
	}
}

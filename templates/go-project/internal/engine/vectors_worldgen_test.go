package engine

import (
	"encoding/json"
	"fmt"
	"testing"
)

type validateJSON struct {
	EdgeClear                float64 `json:"edgeClear"`
	Gap                      float64 `json:"gap"`
	CollectClear             float64 `json:"collectClear"`
	AllowEdgeItems           bool    `json:"allowEdgeItems"`
	AllowItemsNearZones      bool    `json:"allowItemsNearZones"`
	RollingSweepsCollectible bool    `json:"rollingSweepsCollectible"`
	MaxHardRun               int     `json:"maxHardRun"`
	Crossable                *struct {
		MaxPit float64 `json:"maxPit"`
	} `json:"crossable"`
	Hard *struct {
		Tags []string `json:"tags"`
	} `json:"hard"`
}

// opts maps the declarative fixtures (crossable={maxPit}, hard={tags}) to closures.
func (v validateJSON) opts() ValidateOpts {
	o := ValidateOpts{EdgeClear: v.EdgeClear, Gap: v.Gap, CollectClear: v.CollectClear,
		AllowEdgeItems: v.AllowEdgeItems, AllowItemsNearZones: v.AllowItemsNearZones,
		RollingSweepsCollectible: v.RollingSweepsCollectible, MaxHardRun: v.MaxHardRun}
	if v.Crossable != nil {
		max := v.Crossable.MaxPit
		o.Crossable = func(d *Screen) (bool, string) {
			if d.Pit == nil || d.Pit.W <= max {
				return true, ""
			}
			return false, fmt.Sprintf("pit %s too wide", fnum(d.Pit.W))
		}
	}
	if v.Hard != nil {
		tags := v.Hard.Tags
		o.IsHard = func(d *Screen) bool {
			for _, t := range tags {
				if t == d.Tag {
					return true
				}
			}
			return false
		}
	}
	return o
}

func TestVectorsWorldGen(t *testing.T) {
	runVectors(t, "world-gen.json", func(t *testing.T, raw json.RawMessage) any {
		var head struct {
			Op string `json:"op"`
		}
		_ = json.Unmarshal(raw, &head)
		switch head.Op {
		case "helpers":
			in := decode[struct {
				Wrap     [][2]int            `json:"wrap"`
				CircDist [][3]int            `json:"circDist"`
				RampOf   [][3]int            `json:"rampOf"`
				LerpVal  [][]json.RawMessage `json:"lerpVal"`
			}](t, raw)
			out := map[string]any{"wrap": []any{}, "circDist": []any{}, "rampOf": []any{}, "lerpVal": []any{}}
			var wr, cd, ro, lv []any
			for _, a := range in.Wrap {
				wr = append(wr, Wrap(a[0], a[1]))
			}
			for _, a := range in.CircDist {
				cd = append(cd, CircDist(a[0], a[1], a[2]))
			}
			for _, a := range in.RampOf {
				ro = append(ro, RampOf(a[0], a[1], a[2]))
			}
			for _, a := range in.LerpVal {
				var v Val
				if err := json.Unmarshal(a[0], &v); err != nil {
					t.Fatal(err)
				}
				var tt float64
				_ = json.Unmarshal(a[1], &tt)
				lv = append(lv, v.Lerp(tt))
			}
			out["wrap"], out["circDist"], out["rampOf"], out["lerpVal"] = wr, cd, ro, lv
			return out
		case "rng":
			in := decode[struct {
				Seed float64 `json:"seed"`
				N    int     `json:"n"`
			}](t, raw)
			r := NewMulberry32(int64(in.Seed))
			vals := []any{}
			for i := 0; i < in.N; i++ {
				vals = append(vals, r.Float64())
			}
			return map[string]any{"values": vals}
		case "shuffle":
			in := decode[struct {
				Seed  float64 `json:"seed"`
				Items []any   `json:"items"`
			}](t, raw)
			items := append([]any{}, in.Items...)
			return map[string]any{"values": Shuffle[any](NewMulberry32(int64(in.Seed)), items)}
		case "weighted":
			in := decode[struct {
				Seed  float64  `json:"seed"`
				N     int      `json:"n"`
				Items [][2]any `json:"items"`
			}](t, raw)
			var weights []float64
			for _, it := range in.Items {
				w, _ := it[1].(float64)
				weights = append(weights, w)
			}
			r := NewMulberry32(int64(in.Seed))
			vals := []any{}
			for i := 0; i < in.N; i++ {
				vals = append(vals, in.Items[PickWeighted(r, weights)][0])
			}
			return map[string]any{"values": vals}
		case "generate":
			in := decode[struct {
				Rules    Rules         `json:"rules"`
				Validate *validateJSON `json:"validate"`
			}](t, raw)
			w, err := Generate(&in.Rules)
			if err != nil {
				t.Fatal(err)
			}
			det, err := IsDeterministic(&in.Rules)
			if err != nil {
				t.Fatal(err)
			}
			out := map[string]any{"world": w, "deterministic": det}
			if in.Validate != nil {
				out["validation"] = ValidateWorld(w, in.Validate.opts())
			}
			return out
		case "validate":
			in := decode[struct {
				World GeneratedWorld `json:"world"`
				Opts  validateJSON   `json:"opts"`
			}](t, raw)
			return map[string]any{"validation": ValidateWorld(&in.World, in.Opts.opts())}
		}
		t.Fatalf("unknown op %s", head.Op)
		return nil
	})
}

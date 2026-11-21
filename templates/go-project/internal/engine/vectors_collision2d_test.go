package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Conformance harness for spec/v2/vectors/collision2d.json (spec/v2/collision2d.md). Ints/strings/bools/null
// compare exactly, floats at 1e-9 (shared compare in vectors_test.go). The vectors are found through
// FACTORY_SPEC_DIR (the spec directory) or by searching upward from the working directory for spec/<ver>/vectors/.

// specVersionDir locates spec/<ver>/vectors (ver is "v2" or "v3").
func specVersionDir(ver string) (string, bool) {
	if d := os.Getenv("FACTORY_SPEC_DIR"); d != "" {
		for _, c := range []string{d, filepath.Join(d, ver, "vectors"), filepath.Join(d, "spec", ver, "vectors")} {
			if st, err := os.Stat(c); err == nil && st.IsDir() {
				if _, err := os.Stat(filepath.Join(c, "collision"+map[string]string{"v2": "2d", "v3": "3d"}[ver]+".json")); err == nil {
					return c, true
				}
			}
		}
		return "", false
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", false
	}
	for {
		c := filepath.Join(dir, "spec", ver, "vectors")
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			return c, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

// loadSpecCases reads spec/<ver>/vectors/<file> as a list of raw cases.
func loadSpecCases(t *testing.T, ver, file string) []json.RawMessage {
	t.Helper()
	dir, ok := specVersionDir(ver)
	if !ok {
		t.Skip("spec/" + ver + "/vectors not found (set FACTORY_SPEC_DIR or scaffold with spec/)")
	}
	raw, err := os.ReadFile(filepath.Join(dir, file))
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []json.RawMessage `json:"cases"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) == 0 {
		t.Fatalf("%s has no cases", file)
	}
	return f.Cases
}

// runSpecVectors runs {name,input,expect} cases (the v1/v2 layout) from spec/<ver>/vectors/<file>.
func runSpecVectors(t *testing.T, ver, file string, run func(t *testing.T, in json.RawMessage) any) {
	t.Helper()
	cases := loadSpecCases(t, ver, file)
	pass := 0
	for _, raw := range cases {
		var c vecCase
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatal(err)
		}
		t.Run(c.Name, func(t *testing.T) {
			got := toGeneric(t, run(t, c.Input))
			var want any
			if err := json.Unmarshal(c.Expect, &want); err != nil {
				t.Fatal(err)
			}
			if diff := compare("$", want, got); diff != "" {
				t.Fatal(diff)
			}
			pass++
		})
	}
	t.Logf("%s: %d/%d vectors", file, pass, len(cases))
}

type hashItemJSON struct {
	ID     ID     `json:"id"`
	Bounds Bounds `json:"bounds"`
	Layer  *int32 `json:"layer"`
	Mask   *int32 `json:"mask"`
}

func TestVectorsCollision2D(t *testing.T) {
	runSpecVectors(t, "v2", "collision2d.json", func(t *testing.T, raw json.RawMessage) any {
		in := decode[struct {
			Op         string         `json:"op"`
			A          Shape          `json:"a"`
			B          Shape          `json:"b"`
			Shape      Shape          `json:"shape"`
			X          float64        `json:"x"`
			Y          float64        `json:"y"`
			OX         float64        `json:"ox"`
			OY         float64        `json:"oy"`
			DX         float64        `json:"dx"`
			DY         float64        `json:"dy"`
			MaxT       *float64       `json:"maxT"`
			Boxes      []Shape        `json:"boxes"`
			Iterations *int           `json:"iterations"`
			CellSize   float64        `json:"cellSize"`
			Items      []hashItemJSON `json:"items"`
			Moves      []struct {
				ID     ID     `json:"id"`
				Bounds Bounds `json:"bounds"`
			} `json:"moves"`
			Removes []ID        `json:"removes"`
			Queries []Bounds    `json:"queries"`
			Map     TilemapOpts `json:"map"`
			Shapes  []struct {
				Shape Shape `json:"shape"`
				Opts  struct {
					Layer    *int32   `json:"layer"`
					Mask     *int32   `json:"mask"`
					PrevMaxY *float64 `json:"prevMaxY"`
				} `json:"opts"`
			} `json:"shapes"`
		}](t, raw)
		switch in.Op {
		case "collide":
			return Collide(in.A, in.B)
		case "distance":
			return Distance2D(in.A, in.B)
		case "contains":
			return ContainsPoint(in.Shape, in.X, in.Y)
		case "bounds":
			return BoundsOf(in.Shape)
		case "raycast":
			maxT := 1.0
			if in.MaxT != nil {
				maxT = *in.MaxT
			}
			return Raycast2D(in.Shape, in.OX, in.OY, in.DX, in.DY, maxT)
		case "shapeCast":
			return ShapeCast(in.A, in.DX, in.DY, in.B)
		case "sweptAABB":
			return SweptAABB(in.A, in.DX, in.DY, in.B)
		case "moveAABB":
			it := 4
			if in.Iterations != nil {
				it = *in.Iterations
			}
			return MoveAABB(in.A, in.DX, in.DY, in.Boxes, it)
		case "hash":
			cs := in.CellSize
			if cs == 0 {
				cs = 32
			}
			h := NewSpatialHash(cs)
			for _, it := range in.Items {
				h.Insert(it.ID, it.Bounds, layerOf(it.Layer), maskOf(it.Mask))
			}
			for _, m := range in.Moves {
				h.Update(m.ID, m.Bounds)
			}
			for _, r := range in.Removes {
				h.Remove(r)
			}
			qs := make([][]ID, 0, len(in.Queries))
			for _, q := range in.Queries {
				qs = append(qs, h.Query(q))
			}
			return map[string]any{"pairs": h.Pairs(nil), "queries": qs}
		case "tilemap":
			tm := NewTilemap(in.Map)
			qs := make([][]*Collider, 0, len(in.Queries))
			for _, q := range in.Queries {
				qs = append(qs, tm.Query(q))
			}
			shapes := make([][]map[string]any, 0, len(in.Shapes))
			for _, s := range in.Shapes {
				row := []map[string]any{}
				for _, r := range CollideSource(tm, s.Shape, SourceOpts{Layer: s.Opts.Layer, Mask: s.Opts.Mask, PrevMaxY: s.Opts.PrevMaxY}) {
					row = append(row, map[string]any{"col": r.Collider.Col, "row": r.Collider.Row, "manifold": r.Manifold})
				}
				shapes = append(shapes, row)
			}
			return map[string]any{"queries": qs, "shapes": shapes}
		}
		t.Fatalf("unknown collision op %q", in.Op)
		return nil
	})
}

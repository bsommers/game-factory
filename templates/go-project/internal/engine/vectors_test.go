package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// Conformance harness for spec/vectors/*.json (see spec/README.md). Floats compare at
// 1e-9 (relative 1e-12 above 1e6); ints, strings, bools and null compare exactly because
// an integer-valued float below 2^53 leaves no room inside that tolerance for a miss.
//
// The vectors are found through the FACTORY_SPEC_DIR environment variable (either the
// vectors directory itself or the spec directory that contains vectors/), otherwise by
// searching upward from the working directory for spec/vectors/.

type vecCase struct {
	Name   string          `json:"name"`
	Input  json.RawMessage `json:"input"`
	Expect json.RawMessage `json:"expect"`
}

func specVectorsDir() (string, bool) {
	if d := os.Getenv("FACTORY_SPEC_DIR"); d != "" {
		for _, c := range []string{d, filepath.Join(d, "vectors")} {
			if _, err := os.Stat(filepath.Join(c, "rng.json")); err == nil {
				return c, true
			}
		}
		return "", false
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", false
	}
	for {
		c := filepath.Join(dir, "spec", "vectors")
		if _, err := os.Stat(filepath.Join(c, "rng.json")); err == nil {
			return c, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

func loadVectors(t *testing.T, file string) []vecCase {
	t.Helper()
	dir, ok := specVectorsDir()
	if !ok {
		t.Skip("spec/vectors not found (set FACTORY_SPEC_DIR or scaffold with spec/)")
	}
	raw, err := os.ReadFile(filepath.Join(dir, file))
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Engine string    `json:"engine"`
		Cases  []vecCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) == 0 {
		t.Fatalf("%s has no cases", file)
	}
	return f.Cases
}

// runVectors runs every case of file through run and compares with the expectation.
func runVectors(t *testing.T, file string, run func(t *testing.T, in json.RawMessage) any) {
	t.Helper()
	cases := loadVectors(t, file)
	pass := 0
	for _, c := range cases {
		c := c
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

func toGeneric(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func compare(path string, want, got any) string {
	switch w := want.(type) {
	case nil:
		if got != nil {
			return fmt.Sprintf("%s: want null, got %v", path, got)
		}
	case bool, string:
		if want != got {
			return fmt.Sprintf("%s: want %v, got %v", path, want, got)
		}
	case float64:
		g, ok := got.(float64)
		if !ok {
			return fmt.Sprintf("%s: want number %v, got %T %v", path, w, got, got)
		}
		tol := 1e-9
		if math.Abs(w) > 1e6 {
			tol = 1e-12 * math.Abs(w)
		}
		if math.Abs(w-g) > tol || math.IsNaN(g) {
			return fmt.Sprintf("%s: want %v, got %v", path, w, g)
		}
	case []any:
		g, ok := got.([]any)
		if !ok || len(g) != len(w) {
			return fmt.Sprintf("%s: want array len %d, got %T len %d", path, len(w), got, len(g))
		}
		for i := range w {
			if d := compare(fmt.Sprintf("%s[%d]", path, i), w[i], g[i]); d != "" {
				return d
			}
		}
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok {
			return fmt.Sprintf("%s: want object, got %T %v", path, got, got)
		}
		var wk, gk []string
		for k := range w {
			wk = append(wk, k)
		}
		for k := range g {
			gk = append(gk, k)
		}
		sort.Strings(wk)
		sort.Strings(gk)
		if fmt.Sprint(wk) != fmt.Sprint(gk) {
			return fmt.Sprintf("%s: keys want %v, got %v", path, wk, gk)
		}
		for _, k := range wk {
			if d := compare(path+"."+k, w[k], g[k]); d != "" {
				return d
			}
		}
	}
	return ""
}

func decode[T any](t *testing.T, raw json.RawMessage) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("decode input: %v", err)
	}
	return v
}

// seedU32 reduces a JSON number seed mod 2^32 like JS `>>> 0`.
func seedU32(f float64) uint32 { return uint32(int64(f)) }

// ---- rng ----------------------------------------------------------------------------------

func TestVectorsRNG(t *testing.T) {
	runVectors(t, "rng.json", func(t *testing.T, raw json.RawMessage) any {
		in := decode[struct {
			Alg   string  `json:"alg"`
			Seed  any     `json:"seed"`
			Op    string  `json:"op"`
			N     int     `json:"n"`
			Lo    float64 `json:"lo"`
			Hi    float64 `json:"hi"`
			P     float64 `json:"p"`
			Items []any   `json:"items"`
			Str   string  `json:"str"`
		}](t, raw)
		if in.Op == "fnv1a" {
			return map[string]any{"u32": FNV1a32(in.Str)}
		}
		seedF := 0.0 // JS: null >>> 0 == 0
		var pcgSeedStr *string
		switch s := in.Seed.(type) {
		case float64:
			seedF = s
		case string:
			pcgSeedStr = &s
		}
		var vals []any
		switch in.Alg {
		case "pcg32":
			var r *PCG32
			if pcgSeedStr != nil {
				r = NewPCG32FromString(*pcgSeedStr)
			} else {
				r = NewPCG32(seedU32(seedF))
			}
			switch in.Op {
			case "u32":
				for i := 0; i < in.N; i++ {
					vals = append(vals, r.Uint32())
				}
			case "float":
				for i := 0; i < in.N; i++ {
					vals = append(vals, r.Float64())
				}
			case "int":
				for i := 0; i < in.N; i++ {
					vals = append(vals, r.Int(int(in.Lo), int(in.Hi)))
				}
			case "range":
				for i := 0; i < in.N; i++ {
					vals = append(vals, r.Range(in.Lo, in.Hi))
				}
			case "chance":
				for i := 0; i < in.N; i++ {
					vals = append(vals, r.Chance(in.P))
				}
			case "pick":
				for i := 0; i < in.N; i++ {
					vals = append(vals, Pick[any](r, in.Items))
				}
			case "shuffle":
				items := append([]any{}, in.Items...)
				Shuffle[any](r, items)
				vals = items
			default:
				t.Fatalf("pcg32 op %s", in.Op)
			}
		case "mulberry32":
			r := NewMulberry32(int64(seedF))
			for i := 0; i < in.N; i++ {
				switch in.Op {
				case "float":
					vals = append(vals, r.Float64())
				case "int":
					vals = append(vals, r.Int(int(in.Lo), int(in.Hi)))
				default:
					t.Fatalf("mulberry32 op %s", in.Op)
				}
			}
		case "bot":
			r := NewBotRNG(int64(seedF))
			for i := 0; i < in.N; i++ {
				vals = append(vals, r.Float64())
			}
		default:
			t.Fatalf("alg %s", in.Alg)
		}
		if vals == nil {
			vals = []any{}
		}
		return map[string]any{"values": vals}
	})
}

func TestSpecChecks(t *testing.T) {
	if got := NewPCG32(42).Uint32(); got != 2707161783 {
		t.Errorf("pcg32 seed 42 first = %d", got)
	}
	if got := FNV1a32("a"); got != 3826002220 {
		t.Errorf("fnv1a(a) = %d", got)
	}
}

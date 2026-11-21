package engine

import (
	"encoding/json"
	"math"
	"testing"
)

var posInf = math.Inf(1)

func abs3(x float64) float64 { return math.Abs(x) }

// Conformance harness for spec/v3/vectors/bvh.json (spec/v3/bvh.md): node count, serialized size and FNV-1a
// checksum exact, ray hits / query indices exact indices with t within 1e-9.

func TestVectorsBVH(t *testing.T) {
	cases := loadSpecCases(t, "v3", "bvh.json")
	pass := 0
	for _, raw := range cases {
		var c struct {
			Name    string    `json:"name"`
			Kind    string    `json:"kind"`
			Prims   []float64 `json:"prims"`
			Options struct {
				MaxLeafSize *int `json:"maxLeafSize"`
			} `json:"options"`
			Expected struct {
				Rays []struct {
					O V3 `json:"o"`
					D V3 `json:"d"`
				} `json:"rays"`
				QueryAABB struct {
					Box struct {
						Min V3 `json:"min"`
						Max V3 `json:"max"`
					} `json:"box"`
				} `json:"queryAABB"`
				QuerySphere struct {
					Sphere struct {
						C V3      `json:"c"`
						R float64 `json:"r"`
					} `json:"sphere"`
				} `json:"querySphere"`
			} `json:"expected"`
		}
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatal(err)
		}
		var full struct {
			Expected json.RawMessage `json:"expected"`
		}
		_ = json.Unmarshal(raw, &full)
		t.Run(c.Name, func(t *testing.T) {
			leaf := 4
			if c.Options.MaxLeafSize != nil {
				leaf = *c.Options.MaxLeafSize
			}
			var bv *BVH
			var err error
			if c.Kind == "aabb" {
				bv, err = BuildAABBs(c.Prims, leaf)
			} else {
				bv, err = BuildTriangles(c.Prims, leaf)
			}
			if err != nil {
				t.Fatal(err)
			}
			buf := bv.Serialize()
			rays, hits := []map[string]any{}, []any{}
			for _, r := range c.Expected.Rays {
				rays = append(rays, map[string]any{"o": r.O, "d": r.D})
				if h := bv.Raycast(r.O, r.D, BVHRayOpts{}); h != nil {
					hits = append(hits, map[string]any{"t": h.T, "index": h.Index})
				} else {
					hits = append(hits, nil)
				}
			}
			bx := c.Expected.QueryAABB.Box
			sp := c.Expected.QuerySphere.Sphere
			got := toGeneric(t, map[string]any{
				"nodeCount": bv.NodeCount, "bytes": len(buf), "fnv1a32": FNV1a32Bytes(buf),
				"rays": rays, "hits": hits,
				"queryAABB":   map[string]any{"box": map[string]any{"min": bx.Min, "max": bx.Max}, "indices": bv.QueryAABB(AABB3{bx.Min, bx.Max})},
				"querySphere": map[string]any{"sphere": map[string]any{"c": sp.C, "r": sp.R}, "indices": bv.QuerySphere(sp.C, sp.R)},
			})
			var want any
			if err := json.Unmarshal(full.Expected, &want); err != nil {
				t.Fatal(err)
			}
			if diff := compare("$", want, got); diff != "" {
				t.Fatal(diff)
			}
			// the serialized buffer must round-trip
			if rt, err := DeserializeBVH(buf); err != nil || rt.NodeCount != bv.NodeCount || rt.Count != bv.Count {
				t.Fatalf("round trip failed: %v", err)
			}
			pass++
		})
	}
	t.Logf("bvh.json: %d/%d vectors", pass, len(cases))
}

package engine

import (
	"encoding/json"
	"testing"
)

// Conformance harness for spec/v3/vectors/collision3d.json (spec/v3/collision3d.md): {name, op, args, expected}
// cases. abs 1e-9 on floats (shared compare), null vs non-null and indices exact.

func con3(c *Contact3) any {
	if c == nil {
		return nil
	}
	return map[string]any{"normal": c.Normal, "depth": c.Depth}
}

func hit3(h *Hit3) any {
	if h == nil {
		return nil
	}
	return map[string]any{"t": h.T, "normal": h.Normal, "point": h.Point}
}

func flatTri(a [3]V3) Tri { return Tri(a) }

func runCollision3D(t *testing.T, op string, args json.RawMessage) any {
	switch op {
	case "sphereSphere":
		a := decode[struct {
			A  V3      `json:"a"`
			RA float64 `json:"ra"`
			B  V3      `json:"b"`
			RB float64 `json:"rb"`
		}](t, args)
		return con3(SphereSphere(Sphere{a.A, a.RA}, Sphere{a.B, a.RB}))
	case "sphereAABB":
		a := decode[struct {
			C        V3      `json:"c"`
			R        float64 `json:"r"`
			Min, Max V3
		}](t, args)
		return con3(SphereAABB(Sphere{a.C, a.R}, AABB3{a.Min, a.Max}))
	case "aabbAABB":
		a := decode[struct {
			AMin V3 `json:"amin"`
			AMax V3 `json:"amax"`
			BMin V3 `json:"bmin"`
			BMax V3 `json:"bmax"`
		}](t, args)
		return con3(AABBAABB(AABB3{a.AMin, a.AMax}, AABB3{a.BMin, a.BMax}))
	case "sphereTriangle":
		a := decode[struct {
			C   V3      `json:"c"`
			R   float64 `json:"r"`
			Tri [3]V3   `json:"tri"`
		}](t, args)
		return con3(SphereTriangle(Sphere{a.C, a.R}, flatTri(a.Tri)))
	case "capsuleCapsule":
		a := decode[struct {
			A0 V3      `json:"a0"`
			A1 V3      `json:"a1"`
			RA float64 `json:"ra"`
			B0 V3      `json:"b0"`
			B1 V3      `json:"b1"`
			RB float64 `json:"rb"`
		}](t, args)
		return con3(CapsuleCapsule(Capsule3{a.A0, a.A1, a.RA}, Capsule3{a.B0, a.B1, a.RB}))
	case "capsuleTriangle":
		a := decode[struct {
			P   V3      `json:"p"`
			Q   V3      `json:"q"`
			R   float64 `json:"r"`
			Tri [3]V3   `json:"tri"`
		}](t, args)
		return con3(CapsuleTriangle(Capsule3{a.P, a.Q, a.R}, flatTri(a.Tri)))
	case "obbOBB":
		a := decode[struct {
			AC V3         `json:"ac"`
			AH V3         `json:"ah"`
			AQ [4]float64 `json:"aq"`
			BC V3         `json:"bc"`
			BH V3         `json:"bh"`
			BQ [4]float64 `json:"bq"`
		}](t, args)
		x := OBBOBB(OBBFromQuat(a.AC, a.AH, a.AQ), OBBFromQuat(a.BC, a.BH, a.BQ))
		if x == nil {
			return nil
		}
		return map[string]any{"depth": x.Depth, "normalAbs": V3{abs3(x.Normal[0]), abs3(x.Normal[1]), abs3(x.Normal[2])}}
	case "raySphere":
		a := decode[struct {
			O V3      `json:"o"`
			D V3      `json:"d"`
			C V3      `json:"c"`
			R float64 `json:"r"`
		}](t, args)
		return hit3(RaySphere(a.O, a.D, Sphere{a.C, a.R}, posInf))
	case "rayAABB":
		a := decode[struct {
			O        V3 `json:"o"`
			D        V3 `json:"d"`
			Min, Max V3
		}](t, args)
		return hit3(RayAABB(a.O, a.D, AABB3{a.Min, a.Max}, posInf))
	case "rayTriangle":
		a := decode[struct {
			O   V3    `json:"o"`
			D   V3    `json:"d"`
			Tri [3]V3 `json:"tri"`
		}](t, args)
		h := RayTriangle(a.O, a.D, flatTri(a.Tri), 0, posInf, false)
		if h == nil {
			return nil
		}
		return map[string]any{"t": h.T, "u": h.U, "v": h.V, "front": h.Front}
	case "rayCapsule":
		a := decode[struct {
			O V3      `json:"o"`
			D V3      `json:"d"`
			P V3      `json:"p"`
			Q V3      `json:"q"`
			R float64 `json:"r"`
		}](t, args)
		h := RayCapsule(a.O, a.D, Capsule3{a.P, a.Q, a.R}, posInf)
		if h == nil {
			return nil
		}
		return map[string]any{"t": h.T, "normal": h.Normal}
	case "closestPointTriangle":
		a := decode[struct {
			P   V3    `json:"p"`
			Tri [3]V3 `json:"tri"`
		}](t, args)
		return map[string]any{"p": ClosestPointTriangle(a.P, a.Tri[0], a.Tri[1], a.Tri[2])}
	case "closestSegSeg":
		a := decode[struct {
			P1 V3 `json:"p1"`
			Q1 V3 `json:"q1"`
			P2 V3 `json:"p2"`
			Q2 V3 `json:"q2"`
		}](t, args)
		x := ClosestSegSeg(a.P1, a.Q1, a.P2, a.Q2)
		return map[string]any{"s": x.S, "t": x.T, "d2": x.D2}
	case "sweepSphere":
		a := decode[struct {
			C    V3        `json:"c"`
			R    float64   `json:"r"`
			D    V3        `json:"d"`
			Tris []float64 `json:"tris"`
		}](t, args)
		h := SweepSphere(a.C, a.R, a.D, SoupWorld(a.Tris))
		if h == nil {
			return nil
		}
		return map[string]any{"t": h.T, "normal": h.Normal, "index": h.Index}
	}
	t.Fatalf("unknown collision3d op %q", op)
	return nil
}

func TestVectorsCollision3D(t *testing.T) {
	cases := loadSpecCases(t, "v3", "collision3d.json")
	pass := 0
	for _, raw := range cases {
		var c struct {
			Name     string          `json:"name"`
			Op       string          `json:"op"`
			Args     json.RawMessage `json:"args"`
			Expected json.RawMessage `json:"expected"`
		}
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatal(err)
		}
		t.Run(c.Name, func(t *testing.T) {
			got := toGeneric(t, runCollision3D(t, c.Op, c.Args))
			var want any
			if err := json.Unmarshal(c.Expected, &want); err != nil {
				t.Fatal(err)
			}
			if diff := compare("$", want, got); diff != "" {
				t.Fatal(diff)
			}
			pass++
		})
	}
	t.Logf("collision3d.json: %d/%d vectors", pass, len(cases))
}

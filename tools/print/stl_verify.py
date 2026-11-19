#!/usr/bin/env python3
"""
Standalone 3D Printability, Watertightness & Bilateral Symmetry QA Verifier.

Audits binary STL, OBJ/MTL/texture, and Blender .blend deliverables using NumPy + SciPy:
  - Binary STL format integrity, triangle count, bounding box (mm), signed volume (cm^3)
  - 2-manifold watertight edge topology (0 boundary edges, 0 non-manifold edges, consistent winding)
  - Zero NaN/Inf vertices & zero degenerate (zero-area) triangles
  - Connected shell component count & Euler characteristic (chi = V - E + F)
  - Optional bilateral X-symmetry RMS error (mm and % of width) via cKDTree
  - OBJ + MTL + referenced texture existence and header validation
  - Blender .blend file existence and magic header check (uncompressed, zstd, gzip)

Usage:
  python3 -m mesh_qa.stl_verify model.stl [--check-symmetry] [--expected-height-mm 180]
  python3 -m mesh_qa.stl_verify model.stl model.obj scene.blend --json-out report.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree


def fmt_size(num_bytes: int) -> str:
    if num_bytes < 1024:
        return f"{num_bytes} B"
    if num_bytes < 1024**2:
        return f"{num_bytes / 1024:.1f} KB"
    return f"{num_bytes / (1024**2):.2f} MB"


def parse_binary_stl(path: Path) -> tuple[str, np.ndarray, int]:
    """Parse a binary STL file using struct + numpy. Returns (header, tris[N,3,3], file_size)."""
    data = path.read_bytes()
    file_size = len(data)
    if file_size < 84:
        raise ValueError(f"STL file too small ({file_size} bytes)")

    header = data[:80].decode("ascii", errors="replace").strip("\x00 ").strip()
    tri_count = struct.unpack_from("<I", data, 80)[0]
    expected_size = 84 + tri_count * 50

    if expected_size != file_size:
        raise ValueError(
            f"Not a valid binary STL (header says {tri_count} tris => {expected_size} B, actual {file_size} B)"
        )
    if tri_count == 0:
        raise ValueError("Binary STL contains 0 triangles")

    stl_dtype = np.dtype(
        [
            ("normal", "<f4", (3,)),
            ("v0", "<f4", (3,)),
            ("v1", "<f4", (3,)),
            ("v2", "<f4", (3,)),
            ("attr", "<u2"),
        ]
    )
    records = np.frombuffer(data, dtype=stl_dtype, offset=84, count=tri_count)
    tris = np.stack([records["v0"], records["v1"], records["v2"]], axis=1)
    return header, tris, file_size


def audit_stl(
    path: str | Path,
    expected_height_mm: float | None = None,
    height_tol_mm: float = 20.0,
    check_symmetry: bool = False,
    max_symmetry_rms_mm: float = 1.5,
    require_single_shell: bool = True,
) -> dict[str, Any]:
    path = Path(path)
    result: dict[str, Any] = {
        "path": str(path),
        "exists": path.exists(),
        "pass": False,
        "issues": [],
    }
    if not path.exists():
        result["issues"].append(f"Missing STL file: {path.name}")
        return result

    try:
        header, tris_f32, file_size = parse_binary_stl(path)
    except Exception as exc:
        result["issues"].append(str(exc))
        return result

    result["file_size_bytes"] = file_size
    result["file_size_human"] = fmt_size(file_size)
    result["header"] = header
    n_tris = int(tris_f32.shape[0])
    result["triangle_count"] = n_tris

    non_finite_coords = int((~np.isfinite(tris_f32)).sum())
    result["non_finite_coords"] = non_finite_coords
    if non_finite_coords > 0:
        result["issues"].append(f"{non_finite_coords} NaN/Inf vertex coordinates found")
        return result

    tris = tris_f32.astype(np.float64)
    v0, v1, v2 = tris[:, 0], tris[:, 1], tris[:, 2]

    all_pts = tris.reshape(-1, 3)
    bbox_min = all_pts.min(axis=0)
    bbox_max = all_pts.max(axis=0)
    bbox_size = bbox_max - bbox_min
    result["bbox_min_mm"] = [round(float(x), 3) for x in bbox_min]
    result["bbox_max_mm"] = [round(float(x), 3) for x in bbox_max]
    result["bbox_size_mm"] = {
        "x": round(float(bbox_size[0]), 3),
        "y": round(float(bbox_size[1]), 3),
        "z": round(float(bbox_size[2]), 3),
    }

    if expected_height_mm is not None:
        z_h = float(bbox_size[2])
        if abs(z_h - expected_height_mm) > height_tol_mm:
            result["issues"].append(
                f"Height Z={z_h:.2f} mm outside target {expected_height_mm}±{height_tol_mm} mm"
            )

    e1 = v1 - v0
    e2 = v2 - v0
    cross = np.cross(e1, e2)
    areas = 0.5 * np.linalg.norm(cross, axis=1)
    degenerate_count = int((areas <= 1e-10).sum())
    result["surface_area_cm2"] = round(float(areas.sum()) / 100.0, 3)
    result["min_triangle_area_mm2"] = float(areas.min())
    result["degenerate_triangles"] = degenerate_count
    if degenerate_count > 0:
        result["issues"].append(f"{degenerate_count} zero-area/degenerate triangles")

    signed_vol_mm3 = float(np.einsum("ij,ij->i", v0, np.cross(v1, v2)).sum() / 6.0)
    signed_vol_cm3 = signed_vol_mm3 / 1000.0
    result["signed_volume_mm3"] = round(signed_vol_mm3, 2)
    result["signed_volume_cm3"] = round(signed_vol_cm3, 3)
    if signed_vol_cm3 <= 0.0:
        result["issues"].append(
            f"Signed volume is non-positive ({signed_vol_cm3:.3f} cm^3) — inverted normals or open mesh"
        )

    verts_canon = tris_f32.reshape(-1, 3).copy()
    verts_canon[verts_canon == 0.0] = 0.0
    verts_void = np.ascontiguousarray(verts_canon).view(np.dtype((np.void, 12))).ravel()
    _, unique_idx, inv_idx = np.unique(verts_void, return_index=True, return_inverse=True)
    unique_verts = verts_canon[unique_idx].astype(np.float64)
    faces = inv_idx.reshape(n_tris, 3)
    n_verts = int(unique_verts.shape[0])
    result["unique_vertex_count"] = n_verts

    collapsed_tris = int(
        ((faces[:, 0] == faces[:, 1]) | (faces[:, 1] == faces[:, 2]) | (faces[:, 2] == faces[:, 0])).sum()
    )
    result["collapsed_index_triangles"] = collapsed_tris
    if collapsed_tris > 0:
        result["issues"].append(f"{collapsed_tris} triangles have duplicate vertex indices")

    h_src = np.concatenate([faces[:, 0], faces[:, 1], faces[:, 2]])
    h_dst = np.concatenate([faces[:, 1], faces[:, 2], faces[:, 0]])

    u_min = np.minimum(h_src, h_dst).astype(np.int64)
    u_max = np.maximum(h_src, h_dst).astype(np.int64)
    stride = np.int64(n_verts + 1)
    u_keys = u_min * stride + u_max

    uniq_u, u_counts = np.unique(u_keys, return_counts=True)
    n_edges = int(uniq_u.shape[0])
    boundary_edges = int((u_counts == 1).sum())
    manifold_edges = int((u_counts == 2).sum())
    non_manifold_edges = int((u_counts > 2).sum())

    d_keys = h_src.astype(np.int64) * stride + h_dst.astype(np.int64)
    _, d_counts = np.unique(d_keys, return_counts=True)
    inconsistent_orientation_edges = int((d_counts > 1).sum())

    watertight_manifold = (
        boundary_edges == 0
        and non_manifold_edges == 0
        and inconsistent_orientation_edges == 0
        and degenerate_count == 0
        and collapsed_tris == 0
        and signed_vol_cm3 > 0.0
    )

    adj = coo_matrix(
        (np.ones(len(u_min) * 2, dtype=np.int8), (np.concatenate([u_min, u_max]), np.concatenate([u_max, u_min]))),
        shape=(n_verts, n_verts),
    )
    n_components, _ = connected_components(adj, directed=False)

    euler_chi = n_verts - n_edges + n_tris
    result["topology"] = {
        "unique_edges": n_edges,
        "manifold_edges_2": manifold_edges,
        "boundary_edges_1": boundary_edges,
        "non_manifold_edges_gt2": non_manifold_edges,
        "inconsistent_orientation_edges": inconsistent_orientation_edges,
        "connected_components": int(n_components),
        "euler_characteristic": int(euler_chi),
        "watertight_manifold": watertight_manifold,
    }

    if boundary_edges > 0:
        result["issues"].append(f"Mesh is NOT watertight: {boundary_edges} open boundary edges")
    if non_manifold_edges > 0:
        result["issues"].append(f"Mesh is non-manifold: {non_manifold_edges} edges shared by >2 triangles")
    if inconsistent_orientation_edges > 0:
        result["issues"].append(
            f"Inconsistent winding: {inconsistent_orientation_edges} duplicate directed half-edges"
        )
    if require_single_shell and int(n_components) != 1:
        result["issues"].append(f"Expected 1 connected shell, found {int(n_components)}")

    if check_symmetry:
        tree = cKDTree(unique_verts)
        mirrored_zero = unique_verts.copy()
        mirrored_zero[:, 0] = -mirrored_zero[:, 0]
        dists_zero, _ = tree.query(mirrored_zero, k=1)
        rms_zero = float(np.sqrt(np.mean(dists_zero**2)))
        mean_zero = float(np.mean(dists_zero))
        p95_zero = float(np.percentile(dists_zero, 95))
        max_zero = float(np.max(dists_zero))

        x_mid = 0.5 * float(bbox_min[0] + bbox_max[0])
        mirrored_mid = unique_verts.copy()
        mirrored_mid[:, 0] = 2.0 * x_mid - mirrored_mid[:, 0]
        dists_mid, _ = tree.query(mirrored_mid, k=1)
        rms_mid = float(np.sqrt(np.mean(dists_mid**2)))

        width_x = max(float(bbox_size[0]), 1e-6)
        rms_pct_width = (rms_zero / width_x) * 100.0

        result["bilateral_symmetry_x"] = {
            "x_midpoint_mm": round(x_mid, 4),
            "rms_about_x0_mm": round(rms_zero, 4),
            "mean_about_x0_mm": round(mean_zero, 4),
            "p95_about_x0_mm": round(p95_zero, 4),
            "max_about_x0_mm": round(max_zero, 4),
            "rms_about_xmid_mm": round(rms_mid, 4),
            "rms_pct_of_width": round(rms_pct_width, 3),
        }
        if rms_zero > max_symmetry_rms_mm:
            result["issues"].append(
                f"Bilateral X-symmetry RMS is high: {rms_zero:.3f} mm (target <= {max_symmetry_rms_mm} mm)"
            )

    result["pass"] = len(result["issues"]) == 0
    return result


def audit_obj_mtl(obj_path: str | Path, require_textures: bool = False) -> dict[str, Any]:
    obj_path = Path(obj_path)
    result: dict[str, Any] = {
        "path": str(obj_path),
        "exists": obj_path.exists(),
        "pass": False,
        "issues": [],
    }
    if not obj_path.exists():
        result["issues"].append(f"Missing OBJ file: {obj_path.name}")
        return result

    file_size = obj_path.stat().st_size
    result["file_size_bytes"] = file_size
    result["file_size_human"] = fmt_size(file_size)
    if file_size == 0:
        result["issues"].append("OBJ file is empty")
        return result

    v_count = vt_count = vn_count = f_count = f_with_uv = 0
    mtllibs: list[str] = []
    used_mtls: set[str] = set()
    objects: list[str] = []
    min_v = [math.inf, math.inf, math.inf]
    max_v = [-math.inf, -math.inf, -math.inf]

    with open(obj_path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("v "):
                v_count += 1
                parts = line.split()
                if len(parts) >= 4:
                    x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
                    min_v[0] = min(min_v[0], x)
                    min_v[1] = min(min_v[1], y)
                    min_v[2] = min(min_v[2], z)
                    max_v[0] = max(max_v[0], x)
                    max_v[1] = max(max_v[1], y)
                    max_v[2] = max(max_v[2], z)
            elif line.startswith("vt "):
                vt_count += 1
            elif line.startswith("vn "):
                vn_count += 1
            elif line.startswith("f "):
                f_count += 1
                tokens = line.split()[1:]
                if tokens and "/" in tokens[0]:
                    segs = tokens[0].split("/")
                    if len(segs) >= 2 and segs[1]:
                        f_with_uv += 1
            elif line.startswith("mtllib "):
                mtllibs.append(line[7:].strip())
            elif line.startswith("usemtl "):
                used_mtls.add(line[7:].strip())
            elif line.startswith("o "):
                objects.append(line[2:].strip())

    result["counts"] = {
        "vertices": v_count,
        "uv_coords": vt_count,
        "normals": vn_count,
        "faces": f_count,
        "faces_with_uv": f_with_uv,
        "objects": objects,
    }
    if v_count > 0:
        result["bbox_size_raw"] = [round(max_v[i] - min_v[i], 4) for i in range(3)]
    else:
        result["issues"].append("OBJ contains 0 vertices")
    if f_count == 0:
        result["issues"].append("OBJ contains 0 faces")

    defined_mtls: set[str] = set()
    mtl_reports = []
    texture_reports = []
    tex_keywords = {
        "map_Kd", "map_Ka", "map_Ks", "map_Ns", "map_d", "map_Bump", "bump",
        "map_Pr", "map_Pm", "map_Ps", "map_Ke", "norm", "disp", "decal", "refl",
    }

    for ml in mtllibs:
        mtl_path = obj_path.parent / ml
        m_info: dict[str, Any] = {"name": ml, "path": str(mtl_path), "exists": mtl_path.exists()}
        if not mtl_path.exists():
            result["issues"].append(f"Missing MTL file referenced by OBJ: {ml}")
            mtl_reports.append(m_info)
            continue
        m_size = mtl_path.stat().st_size
        m_info["file_size_bytes"] = m_size
        m_info["file_size_human"] = fmt_size(m_size)
        with open(mtl_path, "r", encoding="utf-8", errors="replace") as mf:
            for line in mf:
                s = line.strip()
                if not s or s.startswith("#"):
                    continue
                parts = s.split()
                key = parts[0]
                if key == "newmtl" and len(parts) >= 2:
                    defined_mtls.add(s[7:].strip())
                elif key in tex_keywords and len(parts) >= 2:
                    tex_ref = parts[-1]
                    tex_path = Path(tex_ref) if os.path.isabs(tex_ref) else (mtl_path.parent / tex_ref)
                    tex_exists = tex_path.exists()
                    tex_size = tex_path.stat().st_size if tex_exists else 0
                    valid_hdr = False
                    if tex_exists and tex_size >= 12:
                        sig = tex_path.read_bytes()[:8]
                        valid_hdr = (
                            sig == b"\x89PNG\r\n\x1a\n"
                            or sig[:3] == b"\xff\xd8\xff"
                            or (sig[:4] == b"RIFF")
                        )
                    texture_reports.append(
                        {
                            "directive": key,
                            "ref": tex_ref,
                            "resolved_path": str(tex_path),
                            "exists": tex_exists,
                            "file_size_bytes": tex_size,
                            "valid_image_header": valid_hdr,
                        }
                    )
                    if not tex_exists or tex_size == 0:
                        result["issues"].append(f"Missing/empty texture referenced in {ml}: {tex_ref}")
                    elif not valid_hdr:
                        result["issues"].append(f"Invalid image header for texture: {tex_ref}")
        mtl_reports.append(m_info)

    missing_mtls = sorted(used_mtls - defined_mtls)
    if mtllibs and missing_mtls:
        result["issues"].append(f"OBJ uses materials not defined in MTL: {missing_mtls}")
    if require_textures and not texture_reports:
        result["issues"].append("MTL references zero texture image maps")

    result["mtl_files"] = mtl_reports
    result["defined_materials"] = sorted(defined_mtls)
    result["used_materials"] = sorted(used_mtls)
    result["textures"] = texture_reports
    result["pass"] = len(result["issues"]) == 0
    return result


def audit_blend(blend_path: str | Path) -> dict[str, Any]:
    blend_path = Path(blend_path)
    result: dict[str, Any] = {
        "path": str(blend_path),
        "exists": blend_path.exists(),
        "pass": False,
        "issues": [],
    }
    if not blend_path.exists():
        result["issues"].append(f"Missing Blender file: {blend_path.name}")
        return result

    size = blend_path.stat().st_size
    result["file_size_bytes"] = size
    result["file_size_human"] = fmt_size(size)
    if size < 16:
        result["issues"].append(f"Blender file too small ({size} bytes)")
        return result

    magic = blend_path.read_bytes()[:12]
    if magic.startswith(b"BLENDER"):
        result["format"] = "uncompressed_blend"
    elif magic.startswith(b"\x28\xb5\x2f\xfd"):
        result["format"] = "zstd_compressed_blend"
    elif magic.startswith(b"\x1f\x8b"):
        result["format"] = "gzip_compressed_blend"
    else:
        result["format"] = "unknown"
        result["issues"].append(f"Unrecognized .blend header magic: {magic[:8]!r}")

    result["pass"] = len(result["issues"]) == 0
    return result


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Verify binary STL, OBJ/MTL, and .blend deliverables.")
    p.add_argument("files", nargs="+", help="Paths to .stl, .obj, or .blend files")
    p.add_argument("--expected-height-mm", type=float, default=None)
    p.add_argument("--height-tol-mm", type=float, default=20.0)
    p.add_argument("--check-symmetry", action="store_true")
    p.add_argument("--max-symmetry-rms-mm", type=float, default=1.5)
    p.add_argument("--allow-multi-shell", action="store_true")
    p.add_argument("--json-out", type=Path, default=None)
    args = p.parse_args(argv)

    reports = []
    all_issues = []
    for f in args.files:
        fp = Path(f)
        ext = fp.suffix.lower()
        if ext == ".stl":
            rep = audit_stl(
                fp,
                expected_height_mm=args.expected_height_mm,
                height_tol_mm=args.height_tol_mm,
                check_symmetry=args.check_symmetry,
                max_symmetry_rms_mm=args.max_symmetry_rms_mm,
                require_single_shell=not args.allow_multi_shell,
            )
        elif ext == ".obj":
            rep = audit_obj_mtl(fp)
        elif ext == ".blend":
            rep = audit_blend(fp)
        else:
            rep = {"path": str(fp), "pass": False, "issues": [f"Unsupported file extension: {ext}"]}
        reports.append(rep)
        all_issues.extend(f"[{fp.name}] {iss}" for iss in rep.get("issues", []))

    payload = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "overall_pass": len(all_issues) == 0,
        "issue_count": len(all_issues),
        "all_issues": all_issues,
        "results": reports,
    }
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(payload, indent=2))
    return 0 if payload["overall_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

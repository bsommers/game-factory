# Rendering and ray tracing

Rule: games ship zero runtime dependencies, so we build by default; third-party options are opt-in.

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Own CPU tracer (tools/render) | zero deps, deterministic, testable in Node, runs in CI | slow vs GPU | Built (offline art, bakes, shots) |
| Own WebGPU WGSL compute (raytrace-kit) | realtime, no deps | WebGPU coverage uneven; not CI-verifiable | Built, with fallbacks |
| WebGL2 SDF marcher | wide support | spheres only | Built (fallback) |
| three.js + three-gpu-pathtracer | mature, full features | runtime dep, large, breaks zero-dep rule | Opt-in only |
| WebGPU raw | what we use | verbose | see above |
| wgpu (Rust) | native GPU, cross-platform | separate toolchain | Future port |

## Use
`node tools/render/pathtrace.mjs tools/render/scenes/cornell.json --out out/c.png --spp 64 [--threads N --denoise --mode ao|normal --passes N]`. Scene: spheres, triangles, quads, planes, OBJ meshes, lambert/metal/dielectric/emissive, point/area lights, env (gradient or `.hdr`), DOF camera. Determinism: each (pixel, sample) has its own integer RNG, so output is independent of thread count and tile order (same-machine; Math transcendentals). Capabilities: `render.trace`, `render.info`. Browser: `templates/web-project/src/kits/raytrace-kit`. Style link: styles/presets/raytraced-3d.

## Follow-on (not built)
- Rust (wgpu) and Go ports of the tracer, driven by shared spec vectors (scene + seed -> expected checksums/pixel stats).
- Hardware RT via Vulkan RT / DXR.

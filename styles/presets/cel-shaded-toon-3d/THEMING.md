# Theming Cel-shaded Toon 3D

Real-time 3D with banded lighting and inverted-hull outlines in a small custom WebGL2 renderer; low-poly meshes with flat colour ramps.

Apply a theme with `styles.apply` (theme.json mixin). Guidance for this style:

- Define 3-band ramps (shadow, mid, light) per material and keep the shadow band tinted toward the theme complementary hue.
- Outline colour is the darkest ramp colour, 1.5-2.5px at 720p.
- UI skin: flat panels with thick outlines matching the 3D outline.
- Music: orchestral-lite pads with a bright lead; explore in 6/8 for adventure.
- Title: orbiting camera around the hero with the logo in screen space.

Limits: about 150k triangles; no shadow cascades: use blob shadows or a single 1024 shadow map; WebGL2 required.

Pitfalls: hull outlines double on thin meshes: thicken in view space; banding shimmer with normal-map-free low-poly: smooth normals; no headless GPU in CI: test maths on CPU, shots need a real browser; shader compile differences across drivers.

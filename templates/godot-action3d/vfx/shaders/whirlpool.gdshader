// Whirlpool funnel on a radial disc mesh (vfx_loader builds it in metres, radius = field.radius). Compatibility safe.
// Funnel profile = vfx3d.js funnelDepth(): dip = depth * (1 - r/R)^power * amp; spiral phase = vfx3d.js swirlAngle().
shader_type spatial;
render_mode cull_disabled, specular_schlick_ggx;

uniform float t = 0.0;
uniform float radius = 10.0;
uniform float depth = 2.0;
uniform float power = 2.0;
uniform float amp = 1.0; // fieldAmp(): ramp * pulse, set by the host each frame
uniform float swirl_rate = 1.5;
uniform float twist = 3.0;
uniform float arms = 5.0;
uniform float foam = 0.6;
uniform float core_radius = 2.0;
uniform vec3 color : source_color = vec3(0.2, 0.4, 0.5);
uniform vec3 deep_color : source_color = vec3(0.02, 0.08, 0.1);
uniform vec3 foam_color : source_color = vec3(0.9, 0.95, 0.95);

varying vec2 v_local;
varying float v_depth01;

void vertex() {
	float r = length(VERTEX.xz);
	float u = clamp(1.0 - r / radius, 0.0, 1.0);
	float dip = depth * pow(u, power) * amp;
	float slope = depth * power * pow(u, max(power - 1.0, 0.0)) / radius * amp; // d(height)/dr (height = -dip)
	vec2 dir = r > 0.0001 ? VERTEX.xz / r : vec2(0.0);
	VERTEX.y -= dip;
	NORMAL = normalize(vec3(-slope * dir.x, 1.0, -slope * dir.y));
	v_local = VERTEX.xz;
	v_depth01 = depth > 0.0 ? clamp(dip / (depth * max(amp, 0.0001)), 0.0, 1.0) : 0.0;
}

void fragment() {
	float r = length(v_local);
	float rn = r / radius;
	float ang = atan(v_local.y, v_local.x);
	float sw = swirl_rate * t + twist * (1.0 - rn) * 3.14159265;
	float band = 0.5 + 0.5 * sin(arms * (ang - sw));
	float streak = smoothstep(0.72, 0.98, band) * smoothstep(0.0, 0.25, rn) * (1.0 - smoothstep(0.55, 1.0, rn) * 0.5);
	vec3 base = mix(color, deep_color, pow(v_depth01, 0.7));
	float rim = smoothstep(0.82, 1.0, rn);
	float f = clamp(streak * foam + rim * foam * 0.5 * (0.5 + 0.5 * sin(ang * 11.0 - swirl_rate * t * 2.0)), 0.0, 1.0);
	float core = 1.0 - smoothstep(core_radius * 0.6, core_radius * 1.4, r);
	ALBEDO = mix(mix(base, foam_color, f), vec3(0.0), core * 0.85);
	ROUGHNESS = mix(0.1, 0.65, f);
	SPECULAR = 0.5;
	ALPHA = 1.0 - smoothstep(0.88, 1.0, rn);
}

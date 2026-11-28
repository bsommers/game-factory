// Gerstner water surface (spatial, Compatibility/GLES3 safe: no screen or depth texture).
// Mirrors templates/web-project/src/lib/vfx3d.js gerstner()/waterHeight(): the mesh grid is the REST grid (x0,z0) and each vertex is
// displaced by sum_i [qa_i*d_i*cos(th_i), a_i*sin(th_i), ...] with th = k*(d.p0) - omega*t + phase. `t` is a uniform so the host owns time.
shader_type spatial;
render_mode cull_disabled, specular_schlick_ggx;

uniform float t = 0.0;
uniform float level = 0.0;
uniform vec4 wave_a[4]; // dirx, dirz, k, omega
uniform vec4 wave_b[4]; // amplitude, qa (horizontal), phase, steepness/n  (amplitude 0 = unused slot)
uniform vec3 color : source_color = vec3(0.2, 0.4, 0.5);
uniform vec3 deep_color : source_color = vec3(0.02, 0.1, 0.15);
uniform vec3 foam_color : source_color = vec3(0.9, 0.95, 0.95);
uniform float foam = 0.5;
uniform float opacity = 1.0;
uniform float flow_speed = 0.0; // texture-free flow shimmer speed (m/s along flow_dir)
uniform vec2 flow_dir = vec2(1.0, 0.0);
uniform vec2 hole_center = vec2(0.0, 0.0); // whirlpool funnel cut-out (world XZ)
uniform float hole_radius = 0.0;

varying float v_crest;
varying vec3 v_world;

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	vec3 disp = vec3(0.0);
	vec3 nrm = vec3(0.0, 1.0, 0.0);
	float amp_sum = 0.0;
	for (int i = 0; i < 4; i++) {
		float a = wave_b[i].x;
		if (a <= 0.0) { continue; }
		vec2 d = wave_a[i].xy;
		float k = wave_a[i].z;
		float th = k * dot(d, VERTEX.xz) - wave_a[i].w * t + wave_b[i].z;
		float c = cos(th), s = sin(th);
		disp.xz += wave_b[i].y * d * c;
		disp.y += a * s;
		nrm.xz -= d * k * a * c;
		nrm.y -= wave_b[i].w * s;
		amp_sum += a;
	}
	VERTEX += disp;
	VERTEX.y += level;
	NORMAL = normalize(nrm);
	v_crest = amp_sum > 0.0 ? clamp(disp.y / amp_sum, -1.0, 1.0) : 0.0;
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	if (hole_radius > 0.0 && distance(v_world.xz, hole_center) < hole_radius) { discard; }
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	vec2 q = v_world.xz * 0.9 + flow_dir * flow_speed * t;
	float n = vnoise(q * 2.0) * 0.6 + vnoise(q * 5.0 + 7.0) * 0.4;
	vec3 base = mix(deep_color, color, clamp(0.55 + 0.45 * v_crest + (n - 0.5) * 0.35, 0.0, 1.0));
	float f = smoothstep(0.55, 0.95, v_crest + (n - 0.5) * 0.5) * foam;
	ALBEDO = mix(base, foam_color, f) + fres * 0.12;
	ROUGHNESS = mix(0.12, 0.7, f);
	SPECULAR = 0.6;
	ALPHA = opacity;
}

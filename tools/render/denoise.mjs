// denoise-lite: edge-avoiding A-trous wavelet filter (B3 spline, 5x5 taps, doubling step) on linear rgb.
// Edge stop is a luminance-relative colour distance, so bright edges survive. Deterministic, no deps.
export function denoise(rgb, w, h, { iterations = 3, sigma = 0.25 } = {}) {
  const k = [1 / 16, 1 / 4, 3 / 8, 1 / 4, 1 / 16];
  let src = Float64Array.from(rgb), dst = new Float64Array(rgb.length);
  for (let it = 0; it < iterations; it++) {
    const step = 1 << it;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3, r = src[i], g = src[i + 1], b = src[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b, den = sigma * sigma * (lum * lum + 0.05);
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx * step)), yy = Math.min(h - 1, Math.max(0, y + dy * step)), j = (yy * w + xx) * 3;
        const d0 = src[j] - r, d1 = src[j + 1] - g, d2 = src[j + 2] - b;
        const wt = k[dx + 2] * k[dy + 2] * Math.exp(-(d0 * d0 + d1 * d1 + d2 * d2) / den);
        sr += src[j] * wt; sg += src[j + 1] * wt; sb += src[j + 2] * wt; sw += wt;
      }
      dst[i] = sr / sw; dst[i + 1] = sg / sw; dst[i + 2] = sb / sw;
    }
    [src, dst] = [dst, src];
  }
  return src;
}

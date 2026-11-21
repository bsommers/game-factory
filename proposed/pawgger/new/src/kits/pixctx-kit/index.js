// pixctx-kit: Canvas2D shim backed by an RGBA array so Node tests/tools can render real frames (fillRect, drawImage, alpha, lighter,
// destination-out, multiply, translate/scale) and write PNGs with art-kit's encodePng. Zero deps. Proposed by Pawgger (render).
// ------------------------------------------------------------------ Canvas2D shim backed by an RGBA array (Node tests/tools)
const colorCache = new Map();
function parseColor(s) {
  if (typeof s !== 'string') return [255, 0, 255, 1];
  let c = colorCache.get(s); if (c) return c;
  let m;
  if ((m = /^#([0-9a-f]{6})$/i.exec(s))) { const n = parseInt(m[1], 16); c = [n >> 16, (n >> 8) & 255, n & 255, 1]; }
  else if ((m = /^#([0-9a-f]{3})$/i.exec(s))) { c = [...m[1]].map((h) => parseInt(h + h, 16)); c.push(1); }
  else if ((m = /^rgba?\(([^)]+)\)/i.exec(s))) { const p = m[1].split(',').map((v) => parseFloat(v)); c = [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1]; }
  else c = s === 'white' ? [255, 255, 255, 1] : [0, 0, 0, 1];
  colorCache.set(s, c); return c;
}

export function createPixCanvas(w, h) {
  const canvas = { width: w, height: h, w, h, rgba: new Uint8ClampedArray(w * h * 4), isPixCanvas: true, _ctx: null };
  canvas.getContext = () => canvas._ctx || (canvas._ctx = makeCtx(canvas));
  return canvas;
}
/** createPixCtx(w,h) -> ctx (ctx.canvas has {width,height,w,h,rgba}). Supports what the renderer uses: fillRect, clearRect, drawImage, globalAlpha,
 *  source-over / lighter / destination-out / multiply, save/restore, translate, scale, setTransform. Path APIs are accepted and ignored. */
export function createPixCtx(w, h) { return createPixCanvas(w, h).getContext('2d'); }

function makeCtx(canvas) {
  const st = { fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: false, lineWidth: 1, font: '10px sans-serif', textAlign: 'start' };
  let tx = 0, ty = 0, sx = 1, sy = 1; const stack = [];
  const px = canvas.rgba, cw = canvas.width, ch = canvas.height;
  function put(i, r, g, b, a) {                                   // a = source alpha 0..1 (already includes globalAlpha)
    if (a <= 0) return;
    const op = st.globalCompositeOperation, da = px[i + 3] / 255;
    if (op === 'lighter') { px[i] = Math.min(255, px[i] + r * a); px[i + 1] = Math.min(255, px[i + 1] + g * a); px[i + 2] = Math.min(255, px[i + 2] + b * a); px[i + 3] = Math.max(px[i + 3], a * 255); return; }
    if (op === 'destination-out') { px[i + 3] = px[i + 3] * (1 - a); return; }
    if (op === 'multiply') { px[i] += (px[i] * r / 255 - px[i]) * a; px[i + 1] += (px[i + 1] * g / 255 - px[i + 1]) * a; px[i + 2] += (px[i + 2] * b / 255 - px[i + 2]) * a; return; }
    if (a >= 1) { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; return; }
    const oa = a + da * (1 - a);
    px[i] = (r * a + px[i] * da * (1 - a)) / oa; px[i + 1] = (g * a + px[i + 1] * da * (1 - a)) / oa; px[i + 2] = (b * a + px[i + 2] * da * (1 - a)) / oa; px[i + 3] = oa * 255;
  }
  function devRect(x, y, w, h) {
    let x0 = tx + sx * x, x1 = tx + sx * (x + w), y0 = ty + sy * y, y1 = ty + sy * (y + h);
    if (x0 > x1) [x0, x1] = [x1, x0]; if (y0 > y1) [y0, y1] = [y1, y0];
    return [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)];
  }
  const fillColor = (style) => (style && typeof style === 'object' && style.stops && style.stops.length ? parseColor(style.stops[0][1]) : parseColor(style));
  const ctx = {
    canvas, get width() { return cw; }, get height() { return ch; }, isPixCtx: true,
    save() { stack.push([tx, ty, sx, sy, st.fillStyle, st.globalAlpha, st.globalCompositeOperation]); },
    restore() { const s = stack.pop(); if (s) { [tx, ty, sx, sy, st.fillStyle, st.globalAlpha, st.globalCompositeOperation] = s; } },
    translate(x, y) { tx += sx * x; ty += sy * y; }, scale(a, b) { sx *= a; sy *= b; },
    setTransform(a, b, c, d, e, f) { sx = a; sy = d; tx = e; ty = f; }, resetTransform() { sx = sy = 1; tx = ty = 0; },
    fillRect(x, y, w, h) {
      const [x0, y0, x1, y1] = devRect(x, y, w, h), c = fillColor(st.fillStyle), a = c[3] * st.globalAlpha;
      for (let j = Math.max(0, y0); j < Math.min(ch, y1); j++) for (let i = Math.max(0, x0); i < Math.min(cw, x1); i++) put((j * cw + i) * 4, c[0], c[1], c[2], a);
    },
    clearRect(x, y, w, h) { const [x0, y0, x1, y1] = devRect(x, y, w, h); for (let j = Math.max(0, y0); j < Math.min(ch, y1); j++) for (let i = Math.max(0, x0); i < Math.min(cw, x1); i++) { const k = (j * cw + i) * 4; px[k] = px[k + 1] = px[k + 2] = px[k + 3] = 0; } },
    drawImage(img, ...a) {
      const src = img && img.rgba ? img : (img && img.canvas && img.canvas.rgba ? img.canvas : null); if (!src) return;
      const sw0 = src.w ?? src.width, sh0 = src.h ?? src.height;
      let s0x = 0, s0y = 0, sw = sw0, sh = sh0, dx, dy, dw, dh;
      if (a.length >= 8) [s0x, s0y, sw, sh, dx, dy, dw, dh] = a; else if (a.length >= 4) [dx, dy, dw, dh] = a; else { [dx, dy] = a; dw = sw0; dh = sh0; }
      const [x0, y0, x1, y1] = devRect(dx, dy, dw, dh), flipX = (sx < 0) !== (dw < 0), flipY = (sy < 0) !== (dh < 0), W2 = x1 - x0, H2 = y1 - y0;
      if (W2 <= 0 || H2 <= 0) return;
      const ga = st.globalAlpha, sp = src.rgba;
      for (let j = Math.max(0, y0); j < Math.min(ch, y1); j++) {
        let v = (j - y0 + 0.5) / H2; if (flipY) v = 1 - v; const syy = s0y + Math.min(sh - 1, Math.floor(v * sh));
        for (let i = Math.max(0, x0); i < Math.min(cw, x1); i++) {
          let u = (i - x0 + 0.5) / W2; if (flipX) u = 1 - u; const sxx = s0x + Math.min(sw - 1, Math.floor(u * sw));
          if (sxx < 0 || syy < 0 || sxx >= sw0 || syy >= sh0) continue;
          const k = (syy * sw0 + sxx) * 4, al = sp[k + 3] / 255 * ga; if (al > 0) put((j * cw + i) * 4, sp[k], sp[k + 1], sp[k + 2], al);
        }
      }
    },
    createLinearGradient() { return { stops: [], addColorStop(t, c) { this.stops.push([t, c]); } }; },
    createRadialGradient() { return { stops: [], addColorStop(t, c) { this.stops.push([t, c]); } }; },
    measureText: (s) => ({ width: String(s).length * 6 }),
    getImageData: (x, y, w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = ((y + j) * cw + x + i) * 4, o = (j * w + i) * 4; d[o] = px[k]; d[o + 1] = px[k + 1]; d[o + 2] = px[k + 2]; d[o + 3] = px[k + 3]; } return { width: w, height: h, data: d }; },
  };
  for (const k of Object.keys(st)) Object.defineProperty(ctx, k, { get: () => st[k], set: (v) => { st[k] = v; }, enumerable: true });
  for (const m of ['beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'rect', 'fill', 'stroke', 'clip', 'fillText', 'strokeText', 'strokeRect', 'quadraticCurveTo', 'bezierCurveTo', 'setLineDash', 'roundRect']) ctx[m] = () => {};
  return ctx;
}
/** Encode a PixCtx/PixCanvas as PNG bytes (Node). */
export async function pixToPng(ctxOrCanvas, scale = 1) {
  const c = ctxOrCanvas.canvas || ctxOrCanvas, { encodePng } = await import('../art-kit/index.js');
  return encodePng({ w: c.width, h: c.height, rgba: c.rgba }, scale);
}


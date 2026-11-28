// Minimal PNG encoder (RGBA8), adapted from tools/web/sheet.mjs (not imported, to keep tools/render standalone).
import { deflateSync, crc32 } from 'node:zlib';
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Linear HDR (Float64/32 rgb, 3 per pixel) -> RGBA8 with exposure, ACES filmic fit and sRGB gamma.
export function tonemapRGBA(rgb, w, h, { exposure = 1, tonemap = 'aces' } = {}) {
  const out = new Uint8ClampedArray(w * h * 4);
  const enc = (c) => {
    c *= exposure;
    if (tonemap === 'aces') c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    c = c < 0 ? 0 : c > 1 ? 1 : c;
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = Math.round(enc(rgb[i * 3]) * 255); out[i * 4 + 1] = Math.round(enc(rgb[i * 3 + 1]) * 255);
    out[i * 4 + 2] = Math.round(enc(rgb[i * 3 + 2]) * 255); out[i * 4 + 3] = 255;
  }
  return out;
}

// Radiance .hdr (RGBE) reader (flat and new-style RLE scanlines) plus a flat writer for tests.
export function parseHDR(buf) {
  buf = Buffer.from(buf);
  let p = 0;
  const line = () => { let s = ''; while (p < buf.length && buf[p] !== 10) s += String.fromCharCode(buf[p++]); p++; return s; };
  const magic = line();
  if (!/^#\?(RADIANCE|RGBE)/.test(magic)) throw new Error('not a Radiance .hdr file');
  for (let l = line(); l !== '' && p < buf.length; l = line()) { /* header variables */ }
  const m = /^([-+])Y (\d+) ([-+])X (\d+)$/.exec(line());
  if (!m) throw new Error('unsupported .hdr resolution line');
  const h = +m[2], w = +m[4], rgb = new Float32Array(w * h * 3);
  const put = (i, r, g, b, e) => {
    const f = e ? Math.pow(2, e - 136) : 0; // 2^(e-128)/256
    rgb[i * 3] = r * f; rgb[i * 3 + 1] = g * f; rgb[i * 3 + 2] = b * f;
  };
  const sc = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    const rle = w >= 8 && w < 32768 && buf[p] === 2 && buf[p + 1] === 2 && !(buf[p + 2] & 0x80);
    if (rle) {
      if (((buf[p + 2] << 8) | buf[p + 3]) !== w) throw new Error('bad .hdr scanline width');
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let n = buf[p++];
          if (n > 128) { n -= 128; const v = buf[p++]; while (n-- > 0 && x < w) sc[(x++) * 4 + c] = v; }
          else while (n-- > 0 && x < w) sc[(x++) * 4 + c] = buf[p++];
        }
      }
    } else for (let x = 0; x < w; x++) { for (let c = 0; c < 4; c++) sc[x * 4 + c] = buf[p++]; }
    for (let x = 0; x < w; x++) put(y * w + x, sc[x * 4], sc[x * 4 + 1], sc[x * 4 + 2], sc[x * 4 + 3]);
  }
  return { width: w, height: h, rgb };
}
export function encodeHDR(w, h, rgb) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`);
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2], m = Math.max(r, g, b);
    if (m < 1e-32) continue;
    let e = Math.floor(Math.log2(m)) + 1; // m * 2^-e in [0.5, 1)
    if (m * Math.pow(2, -e) >= 1) e++;
    const ff = Math.pow(2, -e) * 256;
    px[i * 4] = Math.min(255, Math.floor(r * ff)); px[i * 4 + 1] = Math.min(255, Math.floor(g * ff)); px[i * 4 + 2] = Math.min(255, Math.floor(b * ff)); px[i * 4 + 3] = e + 128;
  }
  return Buffer.concat([head, px]);
}

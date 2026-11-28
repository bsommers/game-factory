#!/usr/bin/env node
// Zero-dep CC0 PBR texture + HDRI fetcher (Poly Haven API). Failures are logged and skipped (non-fatal).
// Usage: node tools/fetch_textures.mjs [--config sets.json] [--res 1k|2k]
//   sets.json = { "textureSets": { "<biome>": [{ "name": "...", "slugs": ["polyhaven_slug", ...] }] }, "skies": [{ "name": "...", "slugs": [...] }] }
//   Slugs are tried in order; the first one that has color+normal+rough wins (slugs drift, so always list fallbacks).
//   Without --config the built-in post-apocalyptic desert/bunker/city sets below are fetched (Cheesemageddon).
// Writes assets/textures/<biome>/<name>_{color,normal,rough}.jpg, assets/textures/sky/<name>.hdr,
// assets/textures/MANIFEST.json and assets/textures/INDEX.md. Failures are logged and skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEX = path.join(ROOT, 'assets/textures');
const MANIFEST = path.join(TEX, 'MANIFEST.json');
const INDEX = path.join(TEX, 'INDEX.md');
const UA = 'game-factory-asset-fetch/1.0';

// Each entry: local name + ordered Poly Haven slug candidates (first with all maps wins).
let TEXTURE_SETS = {
  desert: [
    { name: 'sand_dune', slugs: ['aerial_sand', 'coast_sand_01', 'coast_sand_02', 'coast_sand_05'] },
    { name: 'cracked_dry_earth', slugs: ['brown_mud_dry', 'brown_mud_02', 'brown_mud_03', 'aerial_ground_rock'] },
    { name: 'rusted_corrugated_metal', slugs: ['corrugated_iron', 'box_profile_metal_sheet', 'rusty_metal_02'] },
    { name: 'rock_cliff', slugs: ['cliff_side', 'aerial_rocks_02', 'aerial_rocks_01'] },
    { name: 'asphalt_cracked', slugs: ['asphalt_04', 'asphalt_02', 'asphalt_07'] },
    { name: 'rusty_car_body_metal', slugs: ['rusty_metal', 'rust_coarse_01', 'rusty_metal_02'] },
  ],
  bunker: [
    { name: 'concrete_wall', slugs: ['concrete_wall_001', 'concrete_block_wall', 'concrete_panels', 'concrete'] },
    { name: 'concrete_floor', slugs: ['concrete_floor_02', 'concrete_floor_worn_001', 'concrete_floor_03'] },
    { name: 'metal_plate_riveted', slugs: ['metal_plate', 'blue_metal_plate'] },
    { name: 'rusty_pipe', slugs: ['rusty_metal_02', 'rusty_metal', 'rust_coarse_01'] },
    { name: 'tile_floor_dirty', slugs: ['brown_floor_tiles', 'blue_floor_tiles_01', 'checkered_pavement_tiles'] },
    { name: 'grated_metal', slugs: ['metal_grate_rusty', 'metal_plate'] },
  ],
  city: [
    { name: 'concrete_facade', slugs: ['concrete_tile_facade', 'concrete_panels', 'concrete_wall_001'] },
    { name: 'brick_wall', slugs: ['brick_wall_10', 'brick_wall_11', 'brick_wall_09'] },
    { name: 'metal_panel_facade', slugs: ['corrugated_iron', 'metal_plate', 'box_profile_metal_sheet'] },
    { name: 'asphalt_road', slugs: ['asphalt_01', 'asphalt_03', 'asphalt_floor'] },
    { name: 'sidewalk_paving', slugs: ['concrete_pavers', 'concrete_pavement_02', 'cobblestone_pavement'] },
    { name: 'rusty_steel_beam', slugs: ['rusty_metal', 'rust_coarse_01', 'rusty_metal_02'] },
  ],
};

const CONFIG = argOf('--config');
if (CONFIG) { const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); TEXTURE_SETS = c.textureSets ?? {}; SKIES = c.skies ?? []; }

// Poly Haven map key -> file suffix
const MAPS = { Diffuse: 'color', nor_gl: 'normal', Rough: 'rough' };

// HDRI skies: wasteland/desert sunset, overcast city, dim indoor.
let SKIES = [
  { name: 'wasteland_sunset', slugs: ['aarfontein_dusk', 'aarfontein_pan', 'aarfontein_sunrise'] },
  { name: 'overcast_city', slugs: ['abandoned_slipway', 'alte_veste_station', 'autumn_road'] },
  { name: 'dim_indoor', slugs: ['abandoned_garage', 'abandoned_workshop_02', 'abandoned_hall_01'] },
];

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise(res => setTimeout(res, 1000 * i));
    }
  }
}

async function download(url, dest, md5) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length === 0) throw new Error(`empty ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

// Pick a 1k file (falls back to 2k) for a given map/format.
function pick(files, key, fmt) {
  return files?.[key]?.[RES]?.[fmt] ?? files?.[key]?.['1k']?.[fmt] ?? files?.[key]?.['2k']?.[fmt] ?? null;
}

async function fetchTextureSet(biome, set) {
  const dir = path.join(TEX, biome);
  for (const slug of set.slugs) {
    let files;
    try {
      files = await getJson(`https://api.polyhaven.com/files/${slug}`);
    } catch (e) {
      console.error(`skip ${slug}: ${e.message}`);
      continue;
    }
    const picks = Object.entries(MAPS).map(([key, suffix]) => ({ key, suffix, f: pick(files, key, 'jpg') }));
    if (picks.some(p => !p.f)) {
      console.error(`skip ${slug}: missing map(s) ${picks.filter(p => !p.f).map(p => p.key).join(',')}`);
      continue;
    }
    const out = [];
    for (const p of picks) {
      const dest = path.join(dir, `${set.name}_${p.suffix}.jpg`);
      const size = await download(p.f.url, dest, p.f.md5);
      out.push({ file: path.relative(ROOT, dest), url: p.f.url, size });
    }
    return { name: set.name, biome, slug, source: `https://polyhaven.com/a/${slug}`, license: 'CC0', files: out };
  }
  return null;
}

async function fetchSky(sky) {
  for (const slug of sky.slugs) {
    let files;
    try {
      files = await getJson(`https://api.polyhaven.com/files/${slug}`);
    } catch (e) {
      console.error(`skip ${slug}: ${e.message}`);
      continue;
    }
    const f = files?.hdri?.[RES]?.hdr ?? files?.hdri?.['1k']?.hdr ?? files?.hdri?.['2k']?.hdr;
    if (!f) {
      console.error(`skip ${slug}: no hdr`);
      continue;
    }
    const dest = path.join(TEX, 'sky', `${sky.name}.hdr`);
    const size = await download(f.url, dest, f.md5);
    return { name: sky.name, biome: 'sky', slug, source: `https://polyhaven.com/a/${slug}`, license: 'CC0', files: [{ file: path.relative(ROOT, dest), url: f.url, size }] };
  }
  return null;
}

async function main() {
  const entries = [];
  const failed = [];

  for (const [biome, sets] of Object.entries(TEXTURE_SETS)) {
    for (const set of sets) {
      try {
        const r = await fetchTextureSet(biome, set);
        if (r) { entries.push(r); console.log(`ok   ${biome}/${set.name} <- ${r.slug}`); }
        else { failed.push(`${biome}/${set.name}`); console.error(`FAIL ${biome}/${set.name}: no candidate worked`); }
      } catch (e) {
        failed.push(`${biome}/${set.name}`);
        console.error(`FAIL ${biome}/${set.name}: ${e.message}`);
      }
    }
  }

  for (const sky of SKIES) {
    try {
      const r = await fetchSky(sky);
      if (r) { entries.push(r); console.log(`ok   sky/${sky.name} <- ${r.slug}`); }
      else { failed.push(`sky/${sky.name}`); console.error(`FAIL sky/${sky.name}: no candidate worked`); }
    } catch (e) {
      failed.push(`sky/${sky.name}`);
      console.error(`FAIL sky/${sky.name}: ${e.message}`);
    }
  }

  fs.mkdirSync(TEX, { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify({ license: 'CC0', generated_by: 'tools/fetch_textures.mjs', entries, failed }, null, 2) + '\n');

  const rows = [];
  let total = 0;
  for (const e of entries) {
    for (const f of e.files) {
      total += f.size;
      rows.push(`| ${f.file} | ${e.slug} | ${e.source} | ${e.license} | ${(f.size / 1024).toFixed(0)} KB |`);
    }
  }
  const failNote = failed.length ? `\n\nNot fetched (no candidate worked, re-run or add slugs): ${failed.join(', ')}\n` : '\n';
  fs.writeFileSync(INDEX, `# Textures and skies\n\nGenerated by \`tools/fetch_textures.mjs\`. Source: Poly Haven, CC0. Manifest: \`assets/textures/MANIFEST.json\`.\n\nTotal: ${(total / 1048576).toFixed(1)} MB across ${rows.length} files.\n\n| File | Poly Haven slug | Source | License | Size |\n|---|---|---|---|---|\n${rows.join('\n')}\n${failNote}`);

  console.log(`done: ${entries.length} entries, ${rows.length} files, ${failed.length} failed`);
  process.exitCode = 0; // failures are non-fatal by design
}

main().catch(e => { console.error(`fatal: ${e.message}`); process.exitCode = 0; });

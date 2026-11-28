// Meshy API client for meshy.generate / meshy.status. Network only on a real (dryRun:false) run.
// The API key comes ONLY from an environment variable; it is never an input, logged, written or returned.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---- UNVERIFIED constants: agent-reported from docs/research/MESHY-PIPELINE.md, check docs.meshy.ai ----
// unverified, check docs.meshy.ai (paths, request fields, result field names and credit prices all)
export const MESHY = {
  defaultBaseUrl: 'https://api.meshy.ai/openapi',
  paths: { 'text-to-3d': '/v2/text-to-3d', 'image-to-3d': '/v1/image-to-3d', rig: '/v1/rigging', animate: '/v1/animations' },
  // credits per task; text preview/image depend on ai model (meshy-6 = 20, "lite"/older = 5)
  credits: { textPreview: 20, textPreviewLite: 5, textRefine: 10, textRefine8k: 15, image: 20, imageLite: 5, rig: 5, animatePerAction: 3 },
  liteModels: ['meshy-5', 'lite'],
  // where the downloadable GLB lives in a SUCCEEDED task body
  glbFields: { 'text-to-3d': (t) => t.model_urls?.glb, 'image-to-3d': (t) => t.model_urls?.glb, rig: (t) => t.result?.rigged_character_glb_url, animate: (t) => t.result?.animation_glb_url },
};
// ---- end unverified constants ----

export const KEY_ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_DOWNLOAD = 200 * 1024 * 1024;
const lite = (m) => MESHY.liteModels.includes(m);

export function buildRequest(i) {
  const t = i.task, aiModel = i.aiModel || 'meshy-6';
  let body, credits, label;
  if (t === 'text-to-3d') {
    const mode = i.mode || 'preview';
    if (mode === 'refine') {
      if (!i.previewTaskId) throw Object.assign(new Error('refine needs previewTaskId'), { code: 'BAD_INPUT' });
      body = { mode: 'refine', preview_task_id: i.previewTaskId, ai_model: aiModel }; credits = MESHY.credits.textRefine; label = 'text refine';
    } else {
      if (!i.prompt) throw Object.assign(new Error('text-to-3d preview needs prompt'), { code: 'BAD_INPUT' });
      body = { mode: 'preview', prompt: i.prompt, ai_model: aiModel, ...(i.targetPolycount ? { target_polycount: i.targetPolycount } : {}), ...(i.topology ? { topology: i.topology } : {}) };
      credits = lite(aiModel) ? MESHY.credits.textPreviewLite : MESHY.credits.textPreview; label = 'text preview';
    }
  } else if (t === 'image-to-3d') {
    const img = i.imageUrl || i.imageDataUri;
    if (!img) throw Object.assign(new Error('image-to-3d needs imageUrl or imagePath'), { code: 'BAD_INPUT' });
    body = { image_url: img, ai_model: aiModel, ...(i.targetPolycount ? { target_polycount: i.targetPolycount } : {}), ...(i.topology ? { topology: i.topology } : {}) };
    credits = lite(aiModel) ? MESHY.credits.imageLite : MESHY.credits.image; label = 'image to 3d';
  } else if (t === 'rig') {
    if (!i.inputTaskId && !i.modelUrl) throw Object.assign(new Error('rig needs inputTaskId or modelUrl'), { code: 'BAD_INPUT' });
    body = { ...(i.inputTaskId ? { input_task_id: i.inputTaskId } : { model_url: i.modelUrl }), ...(i.heightMeters ? { height_meters: i.heightMeters } : {}), ...(i.skeletonTemplate ? { skeleton_template: i.skeletonTemplate } : {}), ...(i.includeFingers !== undefined ? { include_fingers: i.includeFingers } : {}) };
    credits = MESHY.credits.rig; label = 'rig';
  } else if (t === 'animate') {
    if (!i.rigTaskId) throw Object.assign(new Error('animate needs rigTaskId'), { code: 'BAD_INPUT' });
    const ids = i.actionIds && i.actionIds.length ? i.actionIds : null;
    if (!ids && i.actionId === undefined) throw Object.assign(new Error('animate needs actionId or actionIds'), { code: 'BAD_INPUT' });
    body = { rig_task_id: i.rigTaskId, ...(ids ? { action_ids: ids } : { action_id: i.actionId }), ...(i.fps ? { post_process: { operation_type: 'change_fps', fps: i.fps } } : {}) };
    credits = MESHY.credits.animatePerAction * (ids ? ids.length : 1); label = 'animate';
  } else throw Object.assign(new Error(`unknown task ${t}`), { code: 'BAD_INPUT' });
  return { method: 'POST', path: MESHY.paths[t], body, estimatedCredits: credits, label };
}

const redact = (s, key) => (key ? String(s).split(key).join('[REDACTED]') : String(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (code, message, details) => Object.assign(new Error(message), { code, details });

async function api(base, key, method, path, body) {
  let res;
  try {
    res = await fetch(base.replace(/\/+$/, '') + path, { method, headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw fail('TASK_FAILED', redact(`network error: ${e.message}`, key)); }
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) throw fail('TASK_FAILED', redact(`Meshy API ${res.status} on ${method} ${path}: ${(json?.message || text).slice(0, 300)}`, key), { status: res.status });
  return json || {};
}

export const keyFrom = (keyEnv) => {
  const name = keyEnv || 'MESHY_API_KEY';
  if (!KEY_ENV_RE.test(name)) throw fail('BAD_INPUT', 'keyEnv must be an environment variable name');
  const v = process.env[name];
  if (!v) throw fail('BAD_INPUT', `environment variable ${name} is not set (the API key is read only from the environment)`);
  return v;
};

export const outPublic = (t) => ({ id: t.id, status: t.status, progress: t.progress, taskError: t.task_error?.message || undefined });

async function download(url, dest, base, key) {
  const u = new URL(url), b = new URL(base);
  if (u.protocol !== 'https:' && u.host !== b.host) throw fail('BAD_INPUT', `refusing non-https download host ${u.host}`);
  const res = await fetch(url);   // result URLs are pre-signed: no auth header sent
  if (!res.ok) throw fail('TASK_FAILED', `download failed: ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_DOWNLOAD) throw fail('TASK_FAILED', 'download exceeds size cap');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw fail('TASK_FAILED', 'download exceeds size cap');
  writeFileSync(dest, buf); return buf.length;
}

export async function run(i, { outDir, key, req }) {
  const base = i.baseUrl || MESHY.defaultBaseUrl;
  const created = await api(base, key, 'POST', req.path, req.body);
  const jobId = created.result || created.id;
  if (!jobId) throw fail('TASK_FAILED', 'Meshy API returned no task id');
  const prov = { source: 'meshy', jobId, taskType: i.task, ...(i.mode ? { mode: i.mode } : {}), ...(i.prompt ? { prompt: i.prompt } : {}), ...(i.plan ? { plan: i.plan } : {}), estimatedCredits: req.estimatedCredits, submittedAt: new Date().toISOString() };
  mkdirSync(outDir, { recursive: true });
  const provPath = join(outDir, `${jobId}.meshy.json`);
  writeFileSync(provPath, JSON.stringify(prov, null, 2) + '\n');
  if (i.wait === false) return { jobId, status: 'SUBMITTED', provenance: provPath };
  const deadline = Date.now() + (i.timeoutSec ?? 600) * 1000, pollMs = i.pollMs ?? 3000, path = `${req.path}/${jobId}`;
  for (;;) {
    const t = await api(base, key, 'GET', path);
    if (t.status === 'SUCCEEDED') {
      const url = MESHY.glbFields[i.task](t);
      if (!url) throw fail('TASK_FAILED', `task ${jobId} succeeded but has no GLB url`);
      const file = join(outDir, `${jobId}.glb`);
      const bytes = await download(url, file, base, key);
      Object.assign(prov, { status: 'SUCCEEDED', finishedAt: new Date().toISOString(), glb: `${jobId}.glb`, bytes });
      writeFileSync(provPath, JSON.stringify(prov, null, 2) + '\n');
      return { jobId, status: 'SUCCEEDED', glb: file, bytes, provenance: provPath };
    }
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw fail('TASK_FAILED', `task ${jobId} ${t.status}: ${t.task_error?.message || ''}`, { jobId });
    if (Date.now() > deadline) throw fail('TASK_FAILED', `timed out waiting for task ${jobId} (last status ${t.status}); check with meshy.status`, { jobId });
    await sleep(pollMs);
  }
}

export async function status(i, key) {
  const base = i.baseUrl || MESHY.defaultBaseUrl;
  return outPublic(await api(base, key, 'GET', `${MESHY.paths[i.task]}/${i.taskId}`));
}
export { existsSync, readFileSync };

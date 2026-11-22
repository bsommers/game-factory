// meshy.generate / meshy.status: online Meshy API jobs. dryRun defaults TRUE (no network, no key needed).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, join, extname } from 'node:path';
import { ok, fail } from '../registry.mjs';
import * as G from './generate-lib.mjs';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const TASKS = ['text-to-3d', 'image-to-3d', 'rig', 'animate'];
const inside = (root, p) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const code = (e) => (['BAD_INPUT', 'TASK_FAILED', 'EXISTS', 'NOT_FOUND'].includes(e.code) ? e.code : 'TASK_FAILED');

export function registerMeshyGenerate(r) {
  r.register({ name: 'meshy.generate', summary: 'Submit ONE Meshy job (text-to-3d preview/refine, image-to-3d, rig, animate). dryRun defaults to true: returns the request and an estimated credit cost, no network. A real run needs dryRun:false, maxCredits (refused if the estimate exceeds it) and the API key in an env var (default MESHY_API_KEY; name via keyEnv; the key is never an input or output). Polls, downloads the GLB to out and writes <jobId>.meshy.json provenance. Prices/paths are unverified (see docs/MESHY-GENERATE.md).',
    inputSchema: obj({ task: { type: 'string', enum: TASKS }, mode: { type: 'string', enum: ['preview', 'refine'], description: 'text-to-3d only (default preview)' }, prompt: { type: 'string' }, previewTaskId: { type: 'string' },
      imageUrl: { type: 'string' }, imagePath: { type: 'string', description: 'local png/jpg inside the project, sent as a data URI' }, aiModel: { type: 'string' }, targetPolycount: { type: 'integer', minimum: 100 }, topology: { type: 'string', enum: ['triangle', 'quad'] },
      inputTaskId: { type: 'string' }, modelUrl: { type: 'string' }, heightMeters: { type: 'number', exclusiveMinimum: 0 }, skeletonTemplate: { type: 'string' }, includeFingers: { type: 'boolean' },
      rigTaskId: { type: 'string' }, actionId: { type: 'integer' }, actionIds: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 10 }, fps: { type: 'integer', enum: [24, 25, 30, 60] },
      plan: { type: 'string', enum: ['free', 'pro', 'studio', 'enterprise'], description: 'your Meshy plan, recorded in provenance only' },
      dryRun: { type: 'boolean', description: 'default true' }, maxCredits: { type: 'number', minimum: 0, description: 'required for a real run' }, keyEnv: { type: 'string', description: 'NAME of the env var holding the key (default MESHY_API_KEY)' },
      baseUrl: { type: 'string', description: 'API base url (tests use a 127.0.0.1 mock)' }, wait: { type: 'boolean', description: 'poll and download (default true)' }, pollMs: { type: 'integer', minimum: 1 }, timeoutSec: { type: 'number', exclusiveMinimum: 0 },
      out: { type: 'string', description: 'download dir inside the project (default assets/meshy)' }, project: { type: 'string' } }, ['task']), outputSchema: out,
    handler: async (i) => {
      try {
        const project = resolve(i.project || '.'), outDir = resolve(project, i.out || 'assets/meshy');
        if (!inside(project, outDir)) return fail('BAD_INPUT', `out must be inside the project dir (${project})`);
        const inp = { ...i };
        if (i.imagePath) {
          const p = resolve(project, i.imagePath);
          if (!inside(project, p) || !existsSync(p) || !statSync(p).isFile()) return fail('BAD_INPUT', 'imagePath must be an existing file inside the project');
          const ext = extname(p).toLowerCase(), mime = ext === '.png' ? 'image/png' : ['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg' : null;
          if (!mime) return fail('BAD_INPUT', 'imagePath must be .png/.jpg');
          inp.imageDataUri = `data:${mime};base64,${readFileSync(p).toString('base64')}`;
        }
        const req = G.buildRequest(inp), dryRun = i.dryRun !== false;
        const shown = { ...req, url: (i.baseUrl || G.MESHY.defaultBaseUrl).replace(/\/+$/, '') + req.path, body: inp.imageDataUri ? { ...req.body, image_url: `data:…(${inp.imageDataUri.length} chars)` } : req.body };
        const estimate = { estimatedCredits: req.estimatedCredits, note: 'unverified price table; check docs.meshy.ai' };
        if (dryRun) return ok({ dryRun: true, request: shown, ...estimate }, ['re-run with dryRun:false and maxCredits >= ' + req.estimatedCredits + ' (key from the env var) to spend credits']);
        if (i.maxCredits === undefined) return fail('BAD_INPUT', 'maxCredits is required for a real run', estimate);
        if (req.estimatedCredits > i.maxCredits) return fail('BAD_INPUT', `estimated ${req.estimatedCredits} credits exceeds maxCredits ${i.maxCredits}`, estimate);
        const key = G.keyFrom(i.keyEnv);
        const res = await G.run(inp, { outDir, key, req });
        return ok({ ...res, ...estimate }, res.status === 'SUCCEEDED' ? [`meshy.import {input:"${relative(project, res.glb)}"}`] : [`meshy.status {task:"${i.task}", taskId:"${res.jobId}"}`]);
      } catch (e) { return fail(code(e), e.message, e.details); }
    } });

  r.register({ name: 'meshy.status', summary: 'Read one Meshy task status (GET). Needs the API key in an env var (keyEnv, default MESHY_API_KEY); never returns the key or signed urls.',
    inputSchema: obj({ task: { type: 'string', enum: TASKS }, taskId: { type: 'string', minLength: 1 }, keyEnv: { type: 'string' }, baseUrl: { type: 'string' } }, ['task', 'taskId']), outputSchema: out,
    handler: async (i) => { try { return ok(await G.status(i, G.keyFrom(i.keyEnv))); } catch (e) { return fail(code(e), e.message, e.details); } } });
}

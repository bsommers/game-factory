// worker_threads entry: receives the compiled scene once, then renders tiles on demand.
import { parentPort, workerData } from 'node:worker_threads';
import { makeTracer } from './core.mjs';
const cache = new Map();
parentPort.on('message', (job) => {
  const key = JSON.stringify(job.opts);
  if (!cache.has(key)) cache.set(key, makeTracer(workerData.compiled, job.opts));
  const data = cache.get(key)(job.x0, job.y0, job.x1, job.y1, job.s0, job.s1);
  parentPort.postMessage({ id: job.id, data }, [data.buffer]);
});

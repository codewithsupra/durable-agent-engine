import { randomUUID } from 'crypto';
import 'dotenv/config';
import { claimStep, reapExpiredLocks, completeStep, failStep } from './queue.js';
import { resolveHandler } from './steps/registry.js';

// Note: step-transition events are published via Postgres LISTEN/NOTIFY
// (see queue.js + server.js), not in-process broadcast — the worker and
// API server are separate processes, so an in-memory event bus here
// would never reach the WebSocket clients connected to the server.

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = 500;
let shuttingDown = false;

console.log(`[${WORKER_ID}] starting`);

async function pollOnce() {
  await reapExpiredLocks();

  const step = await claimStep(WORKER_ID);
  if (!step) return;

  console.log(`[${WORKER_ID}] running step ${step.name} (attempt ${step.attempt})`);

  try {
    const handler = resolveHandler(step.name);
    const output = await handler(step.input);
    await completeStep(step.id, output);
  } catch (err) {
    const outcome = await failStep(step.id, err.message);
    console.error(`[${WORKER_ID}] step ${step.name} failed: ${err.message} -> ${outcome}`);
  }
}

async function loop() {
  while (!shuttingDown) {
    try {
      await pollOnce();
    } catch (err) {
      console.error(`[${WORKER_ID}] poll error`, err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.log(`[${WORKER_ID}] shut down cleanly`);
}

process.on('SIGTERM', () => { shuttingDown = true; });
process.on('SIGINT', () => { shuttingDown = true; });

loop();

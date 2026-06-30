import { pool } from './db.js';

// Cross-process event bus: workers run in separate OS processes from the
// API server, so step-transition events are published via Postgres
// pg_notify() (see queue.js) and consumed here via a dedicated LISTEN
// connection, then fanned out to WebSocket subscribers for that run.

const subscribers = new Map(); // runId -> Set<ws>
let listenerClient = null;

export function subscribe(runId, ws) {
  if (!subscribers.has(runId)) subscribers.set(runId, new Set());
  subscribers.get(runId).add(ws);
}

export function unsubscribe(runId, ws) {
  subscribers.get(runId)?.delete(ws);
}

function fanOut(message) {
  const subs = subscribers.get(message.runId);
  if (!subs) return;
  const payload = JSON.stringify({ ...message, ts: Date.now() });
  for (const ws of subs) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

export async function startListening() {
  listenerClient = await pool.connect();
  await listenerClient.query('LISTEN step_events');
  listenerClient.on('notification', (msg) => {
    try {
      fanOut(JSON.parse(msg.payload));
    } catch (err) {
      console.error('failed to parse step_events payload', err);
    }
  });
  listenerClient.on('error', (err) => console.error('LISTEN connection error', err));
  console.log('Listening for step_events on Postgres LISTEN/NOTIFY');
}

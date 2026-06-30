// In-memory pub/sub fan-out per run, consumed by the WebSocket layer in server.js.
const subscribers = new Map(); // runId -> Set<ws>

export function subscribe(runId, ws) {
  if (!subscribers.has(runId)) subscribers.set(runId, new Set());
  subscribers.get(runId).add(ws);
}

export function unsubscribe(runId, ws) {
  subscribers.get(runId)?.delete(ws);
}

export function broadcast(runId, message) {
  const subs = subscribers.get(runId);
  if (!subs) return;
  const payload = JSON.stringify({ ...message, runId, ts: Date.now() });
  for (const ws of subs) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

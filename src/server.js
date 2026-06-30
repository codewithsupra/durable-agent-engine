import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { URL, fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';
import { createRun, getRunStatus } from './orchestrator.js';
import { subscribe, unsubscribe, startListening } from './pubsub.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/runs', async (req, res) => {
  const { goal, steps } = req.body;
  if (!goal || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ error: 'goal and non-empty steps[] are required' });
  }
  const runId = await createRun(goal, steps);
  res.status(201).json({ runId, watch: `ws://${req.headers.host}/ws/${runId}` });
});

app.get('/runs/:id', async (req, res) => {
  const run = await getRunStatus(req.params.id);
  if (!run) return res.status(404).json({ error: 'not found' });
  res.json(run);
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const match = pathname.match(/^\/ws\/([0-9a-f-]+)$/i);
  if (!match) return socket.destroy();

  wss.handleUpgrade(req, socket, head, (ws) => {
    const runId = match[1];
    subscribe(runId, ws);
    ws.send(JSON.stringify({ type: 'subscribed', runId }));
    ws.on('close', () => unsubscribe(runId, ws));
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, async () => {
  console.log(`durable-agent-engine API listening on :${PORT}`);
  await startListening();
});

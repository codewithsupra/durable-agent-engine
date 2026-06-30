import { test } from 'node:test';
import assert from 'node:assert';
import { pool } from '../src/db.js';
import { createRun, getRunStatus } from '../src/orchestrator.js';
import { claimStep, completeStep } from '../src/queue.js';

test('no two concurrent claims return the same step', async () => {
  const runId = await createRun('concurrency test', [{ name: 'noop.a' }]);

  const [a, b, c] = await Promise.all([
    claimStep('w1'), claimStep('w2'), claimStep('w3'),
  ]);
  const claimed = [a, b, c].filter(Boolean);
  assert.strictEqual(claimed.length, 1, 'exactly one worker should claim the single ready step');
});

test('dependent step only becomes ready after dependency succeeds', async () => {
  const runId = await createRun('dag test', [
    { name: 'noop.first' },
    { name: 'noop.second', dependsOn: ['noop.first'] },
  ]);

  let status = await getRunStatus(runId);
  const second = status.steps.find((s) => s.name === 'noop.second');
  assert.strictEqual(second.status, 'pending');

  const first = await claimStep('w1');
  await completeStep(first.id, { ok: true });

  status = await getRunStatus(runId);
  const secondAfter = status.steps.find((s) => s.name === 'noop.second');
  assert.strictEqual(secondAfter.status, 'ready');
});

test.after(() => pool.end());

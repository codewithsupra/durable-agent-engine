import { pool } from './db.js';

/**
 * Creates a run from a DAG spec:
 *   [{ name, input, dependsOn: [stepName, ...] }, ...]
 * Steps with no dependencies are immediately marked 'ready'.
 * Idempotency key = `${runId}:${stepName}` so re-submitting the same
 * run definition never double-creates or double-executes a step.
 */
export async function createRun(goal, stepDefs) {
  const { rows } = await pool.query(
    `INSERT INTO runs (goal, status) VALUES ($1, 'running') RETURNING id`,
    [goal]
  );
  const runId = rows[0].id;

  const nameToId = {};
  for (const def of stepDefs) {
    const idemKey = `${runId}:${def.name}`;
    const { rows: stepRows } = await pool.query(
      `INSERT INTO steps (run_id, name, input, idempotency_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [runId, def.name, def.input || {}, idemKey]
    );
    nameToId[def.name] = stepRows[0].id;
  }

  for (const def of stepDefs) {
    const dependsOnIds = (def.dependsOn || []).map((n) => nameToId[n]);
    const status = dependsOnIds.length === 0 ? 'ready' : 'pending';
    await pool.query(
      `UPDATE steps SET depends_on = $2, status = $3 WHERE id = $1`,
      [nameToId[def.name], dependsOnIds, status]
    );
  }

  await pool.query(
    `INSERT INTO audit_log (run_id, event, detail) VALUES ($1, 'run_created', $2)`,
    [runId, { goal, stepCount: stepDefs.length }]
  );

  return runId;
}

export async function getRunStatus(runId) {
  const { rows: run } = await pool.query('SELECT * FROM runs WHERE id = $1', [runId]);
  const { rows: steps } = await pool.query(
    'SELECT id, name, status, attempt, max_attempts, output, updated_at FROM steps WHERE run_id = $1 ORDER BY created_at',
    [runId]
  );
  if (!run[0]) return null;

  const allDone = steps.every((s) => s.status === 'succeeded');
  const anyDead = steps.some((s) => s.status === 'dead_letter');
  if (allDone && run[0].status !== 'completed') {
    await pool.query(`UPDATE runs SET status = 'completed', updated_at = now() WHERE id = $1`, [runId]);
    run[0].status = 'completed';
  } else if (anyDead) {
    run[0].status = 'failed';
  }

  return { ...run[0], steps };
}

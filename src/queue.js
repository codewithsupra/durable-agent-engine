import { pool, tx } from './db.js';

const LOCK_TTL_MS = 30_000; // a worker that dies mid-step releases the lock after this

/**
 * Atomically claims one ready, due step for this worker.
 * SKIP LOCKED guarantees no two workers ever claim the same row,
 * without blocking each other's claim queries.
 */
export async function claimStep(workerId) {
  return tx(async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM steps
       WHERE status = 'ready'
         AND next_attempt_at <= now()
       ORDER BY next_attempt_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`
    );
    if (rows.length === 0) return null;

    const stepId = rows[0].id;
    const lockExpires = new Date(Date.now() + LOCK_TTL_MS);

    const { rows: updated } = await client.query(
      `UPDATE steps
       SET status = 'running',
           locked_by = $2,
           locked_at = now(),
           lock_expires_at = $3,
           attempt = attempt + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [stepId, workerId, lockExpires]
    );
    return updated[0];
  });
}

/** Reclaims steps whose worker died without releasing the lock. */
export async function reapExpiredLocks() {
  const { rows } = await pool.query(
    `UPDATE steps
     SET status = 'ready', locked_by = NULL, locked_at = NULL, lock_expires_at = NULL
     WHERE status = 'running' AND lock_expires_at < now()
     RETURNING id, run_id`
  );
  return rows;
}

export async function completeStep(stepId, output) {
  await tx(async (client) => {
    await client.query(
      `UPDATE steps SET status = 'succeeded', output = $2, updated_at = now() WHERE id = $1`,
      [stepId, output]
    );
    const { rows: step } = await client.query('SELECT run_id FROM steps WHERE id = $1', [stepId]);
    const runId = step[0].run_id;

    // promote any dependent steps whose dependencies are now all satisfied
    await client.query(
      `UPDATE steps s
       SET status = 'ready'
       WHERE s.run_id = $1
         AND s.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM unnest(s.depends_on) dep
           JOIN steps d ON d.id = dep
           WHERE d.status <> 'succeeded'
         )`,
      [runId]
    );

    await client.query(
      `INSERT INTO audit_log (run_id, step_id, event, detail) VALUES ($1, $2, 'step_succeeded', $3)`,
      [runId, stepId, output]
    );
  });
}

export async function failStep(stepId, error) {
  const { rows } = await pool.query('SELECT * FROM steps WHERE id = $1', [stepId]);
  const step = rows[0];

  if (step.attempt >= step.max_attempts) {
    await pool.query(
      `UPDATE steps SET status = 'dead_letter', updated_at = now() WHERE id = $1`,
      [stepId]
    );
    await pool.query(
      `INSERT INTO audit_log (run_id, step_id, event, detail) VALUES ($1, $2, 'dead_letter', $3)`,
      [step.run_id, stepId, { error: String(error) }]
    );
    await pool.query(`UPDATE runs SET status = 'failed', updated_at = now() WHERE id = $1`, [step.run_id]);
    return 'dead_letter';
  }

  const backoffMs = Math.min(2 ** step.attempt * 1000, 60_000); // exponential backoff, capped at 60s
  await pool.query(
    `UPDATE steps
     SET status = 'ready', next_attempt_at = now() + ($2 || ' milliseconds')::interval, updated_at = now()
     WHERE id = $1`,
    [stepId, backoffMs]
  );
  await pool.query(
    `INSERT INTO audit_log (run_id, step_id, event, detail) VALUES ($1, $2, 'retry_scheduled', $3)`,
    [step.run_id, stepId, { error: String(error), backoffMs, attempt: step.attempt }]
  );
  return 'retry_scheduled';
}

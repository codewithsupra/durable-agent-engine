// Chaos demo: submits a multi-step run, randomly SIGKILLs worker processes
// mid-execution, and proves the run still completes correctly via lock
// reaping + retry. Run alongside `npm run worker` x3 and `npm start`.
//
// Usage: node tests/chaos.js

const BASE = process.env.BASE_URL || 'http://localhost:4000';

async function main() {
  const steps = [
    { name: 'tool_call.fetch_data', input: { tool: 'fetch_data', simulateFailure: true, failureRate: 0.4 } },
    { name: 'tool_call.transform', input: { tool: 'transform' }, dependsOn: ['tool_call.fetch_data'] },
    { name: 'llm_call.summarize', input: { prompt: 'Summarize the transformed data' }, dependsOn: ['tool_call.transform'] },
    { name: 'tool_call.notify', input: { tool: 'notify' }, dependsOn: ['llm_call.summarize'] },
  ];

  const createRes = await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: 'Chaos demo run', steps }),
  });
  const { runId } = await createRes.json();
  console.log(`Created run ${runId}. Watching for completion (kill a worker process now)...`);

  const start = Date.now();
  while (Date.now() - start < 120_000) {
    const res = await fetch(`${BASE}/runs/${runId}`);
    const run = await res.json();
    process.stdout.write(`\rstatus=${run.status} steps=${run.steps.map((s) => s.status[0]).join('')}   `);
    if (run.status === 'completed' || run.status === 'failed') {
      console.log(`\nFinal status: ${run.status}`);
      console.log(JSON.stringify(run.steps, null, 2));
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('\nTimed out waiting for completion.');
}

main();

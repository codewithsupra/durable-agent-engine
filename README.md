# Durable Agent Engine

A fault-tolerant orchestration engine for multi-step LLM agent workflows — built to survive worker crashes, network failures, and duplicate execution without losing or double-running a single step.

No Redis. No BullMQ. No managed queue service. The durable queue is built directly on Postgres using `SELECT ... FOR UPDATE SKIP LOCKED`, the same primitive production systems at companies like GitHub use for job queues — because reaching for a queue library hides the part that's actually hard: atomicity, lock ownership, and exactly-once semantics under concurrent workers.

## Why this exists

Every LLM "agent" framework demo shows the happy path. None of them show what happens when:
- a worker process gets SIGKILLed mid-step
- two workers race to pick up the same step
- a tool call fails transiently and needs a retry, but *not* a re-run of the steps before it
- you need an audit trail of exactly what happened, when, for compliance

This project answers those questions with working code, not slides.

## Architecture

```
POST /runs (DAG of steps) ─▶ Postgres (runs, steps, audit_log)
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              worker-1       worker-2       worker-3
           (SKIP LOCKED claim — exactly one wins per step)
                    │
                    ▼
        step succeeds → dependents promoted to 'ready'
        step fails    → exponential backoff retry → dead_letter after max_attempts
        worker dies   → lock TTL expires → step reclaimed automatically
                    │
                    ▼
        WebSocket broadcast ──▶ live dashboard / CLI watcher
```

### Core guarantees

| Guarantee | Mechanism |
|---|---|
| Exactly-one claim per step | `FOR UPDATE SKIP LOCKED` inside a transaction |
| No lost work on worker crash | Lock TTL (30s) + reaper requeues orphaned `running` steps |
| No duplicate run creation | Idempotency key = `${runId}:${stepName}`, upserted via `ON CONFLICT` |
| Bounded retries | Exponential backoff (1s → 60s cap), dead-letter after `max_attempts` |
| Full auditability | Every state transition written to `audit_log` |
| DAG correctness | Dependent steps only promoted to `ready` once all `depends_on` succeed |

## Quickstart

```bash
docker compose up -d        # local Postgres
cp .env.example .env
npm install
npm run migrate
npm start                   # API + WebSocket server on :4000
npm run worker              # run in 2-3 separate terminals to see SKIP LOCKED in action
```

Submit a run:
```bash
curl -X POST localhost:4000/runs -H 'Content-Type: application/json' -d '{
  "goal": "Research and summarize a topic",
  "steps": [
    { "name": "tool_call.fetch_data", "input": { "tool": "fetch_data" } },
    { "name": "tool_call.transform", "input": { "tool": "transform" }, "dependsOn": ["tool_call.fetch_data"] },
    { "name": "llm_call.summarize", "input": { "prompt": "Summarize the data" }, "dependsOn": ["tool_call.transform"] }
  ]
}'
```

Watch it live: `wscat -c ws://localhost:4000/ws/<runId>`

## Chaos test — prove it, don't claim it

```bash
npm run worker   # start 3 of these in separate terminals
npm run chaos    # submits a run with simulated 40% transient failures, then kill -9 a worker mid-run
```
Expected result: the run still reaches `completed`. Killed steps get reclaimed by the lock reaper; failed steps retry with backoff; the audit log shows the full story.

## Tech

Node.js (ESM, no framework magic), Express, `pg`, `ws`. Postgres can be local (docker-compose included) or a managed instance (tested against [InsForge](https://insforge.dev) for zero-ops Postgres + auth + storage in front of this engine).

## What this demonstrates

Built as a deep dive into the kind of infrastructure problem backend teams at LLM companies solve daily: reliable multi-step agent execution, distributed locking, idempotency, and observability — not just wiring an SDK to a UI.

## License

MIT

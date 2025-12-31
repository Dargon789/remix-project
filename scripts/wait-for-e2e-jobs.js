#!/usr/bin/env node
/*
Waits for all E2E jobs in the current CircleCI workflow to reach a terminal state
(success, failed, error, or canceled). Intended to let a fan-in job run even if
some matrix shards fail.

Env requirements:
  - CIRCLECI_TOKEN
  - CIRCLE_WORKFLOW_ID
Optional:
  - E2E_JOB_PREFIX (default: remix-ide-browser)
  - WAIT_TIMEOUT_SEC (default: 3600)
  - WAIT_POLL_SEC (default: 10)
*/

const TOKEN = process.env.CIRCLECI_TOKEN || '';
const WORKFLOW_ID = process.env.CIRCLE_WORKFLOW_ID || '';
const PREFIX = process.env.E2E_JOB_PREFIX || 'remix-ide-browser';
const PREFIXES = PREFIX.split(',').map(p => p.trim());
const TIMEOUT = Number(process.env.WAIT_TIMEOUT_SEC || 3600);
const POLL = Number(process.env.WAIT_POLL_SEC || 10);

if (!TOKEN) {
  console.error('[wait-for-e2e] CIRCLECI_TOKEN missing');
  process.exit(2);
}
if (!WORKFLOW_ID) {
  console.error('[wait-for-e2e] CIRCLE_WORKFLOW_ID missing');
  process.exit(2);
}

const terminal = new Set(['success', 'failed', 'failing', 'error', 'canceled', 'cancelled']);

(async () => {
  const started = Date.now();
  let noJobsCount = 0;
  console.log(`[wait-for-e2e] Looking for jobs matching prefixes: ${PREFIXES.join(', ')}`);
  while (true) {
    const { items } = await api(`/workflow/${WORKFLOW_ID}/job`);
    const e2e = (items || []).filter(j => PREFIXES.some(prefix => (j.name || '').startsWith(prefix)));
    if (!e2e.length) {
      noJobsCount++;
      console.log('[wait-for-e2e] No E2E jobs found yet; sleeping...');
      // If we've been waiting too long for jobs to appear, list all jobs for debugging
      if (noJobsCount === 5) {
        console.log('[wait-for-e2e] DEBUG: All jobs in workflow:');
        (items || []).forEach(j => console.log(`  - ${j.name} (${j.status})`));
      }
      // After 30 attempts with no jobs, give up and proceed
      if (noJobsCount > 30) {
        console.log('[wait-for-e2e] No E2E jobs found after 30 checks; proceeding anyway');
        break;
      }
    } else {
      const done = e2e.filter(j => terminal.has(String(j.status || '').toLowerCase()));
      const pending = e2e.length - done.length;
      console.log(`[wait-for-e2e] ${done.length}/${e2e.length} E2E jobs done; pending=${pending}`);
      if (pending === 0) break;
    }
    if ((Date.now() - started) / 1000 > TIMEOUT) {
      console.error('[wait-for-e2e] Timeout waiting for E2E jobs');
      break; // continue anyway to attempt report
    }
    await sleep(POLL * 1000);
  }
  console.log('[wait-for-e2e] Proceeding to report generation');
})().catch(e => { console.error(e); process.exit(1); });

async function api(path) {
  const res = await fetch(`https://circleci.com/api/v2${path}`, {
    headers: { 'Circle-Token': TOKEN }
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`CircleCI ${res.status} ${path}: ${t}`);
  }
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

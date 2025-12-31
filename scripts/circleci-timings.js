#!/usr/bin/env node
/*
  CircleCI Timings Fetcher

  What it does
  - Queries CircleCI API v2 for recent workflow runs
  - Finds jobs within each workflow (e.g., remix-ide-browser)
  - Pulls per-test results for those jobs
  - Aggregates run_time by "file" and prints a summary + JSON

  Requirements
  - env CIRCLECI_TOKEN must be set (personal or project API token with read permissions)
  - project slug in the form: gh/<org>/<repo> (works for GitHub; use bb/ or gh/ etc. per CircleCI docs)

  Quick examples
    node scripts/circleci-timings.js --slug gh/remix-project-org/remix-project --workflow web --branch master --jobs "remix-ide-browser" --limit 10
    CIRCLECI_TOKEN=... yarn ci:timings --slug gh/remix-project-org/remix-project --workflow run_pr_tests --branch feat/my-branch --jobs "remix-ide-browser" --limit 5 --json timings.json
      # Note: use 'gh/' for GitHub (not 'github/')

  Notes
  - The endpoint /project/{project-slug}/{job-number}/tests returns JUnit-parsed tests with fields {name, file, run_time, result}
  - We aggregate by "file" and compute total, avg, count, min, max
*/

const axios = require('axios');
const { program } = require('commander');
const fs = require('fs');
const child_process = require('child_process');

const BASE = 'https://circleci.com/api/v2';

function normalizeSlug(slug) {
  if (slug.startsWith('github/')) return slug.replace(/^github\//, 'gh/');
  if (slug.startsWith('bitbucket/')) return slug.replace(/^bitbucket\//, 'bb/');
  return slug;
}

function getToken() {
  const token = process.env.CIRCLECI_TOKEN || process.env.CIRCLE_TOKEN || '';
  if (!token) {
    throw new Error('CIRCLECI_TOKEN env var is required.');
  }
  return token;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function getJson(url, token, params = {}, retries = 3) {
  const headers = { 'Circle-Token': token };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await axios.get(url, { headers, params, timeout: 20000 });
      return resp.data;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
}

async function listWorkflowRuns({ slug, workflowName, branch, limit = 10, token }) {
  // GET /insights/{project-slug}/workflows/{workflow-name}/runs
  const runs = [];
  let pageToken = undefined;
  while (runs.length < limit) {
    const params = {};
    if (branch) params.branch = branch;
    if (pageToken) params['page-token'] = pageToken;
    const url = `${BASE}/insights/${slug}/workflows/${workflowName}/runs`;
    const data = await getJson(url, token, params);
    const items = data.items || [];
    for (const it of items) {
      if (runs.length >= limit) break;
      runs.push({ id: it.id, created_at: it.created_at, status: it.status, duration: it.duration });
    }
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return runs;
}

async function listPipelines({ slug, branch, limit = 10, token }) {
  // GET /project/{project-slug}/pipeline?branch=...
  const results = [];
  let pageToken = undefined;
  while (results.length < limit) {
    const params = {};
    if (branch) params.branch = branch;
    if (pageToken) params['page-token'] = pageToken;
    const url = `${BASE}/project/${slug}/pipeline`;
    const data = await getJson(url, token, params);
    const items = data.items || [];
    for (const it of items) {
      if (results.length >= limit) break;
      results.push({ id: it.id, number: it.number, created_at: it.created_at, state: it.state, trigger: it.trigger });
    }
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return results;
}

async function listPipelineWorkflows({ pipelineId, token }) {
  // GET /pipeline/{id}/workflow
  const url = `${BASE}/pipeline/${pipelineId}/workflow`;
  const data = await getJson(url, token);
  return data.items || [];
}

async function listWorkflows({ slug, branch, token }) {
  // GET /insights/{project-slug}/workflows
  const url = `${BASE}/insights/${slug}/workflows`;
  const data = await getJson(url, token, branch ? { branch } : {});
  const items = data.items || [];
  return items.map((w) => ({ name: w.name || w.workflow_name || 'unknown', metrics: w.metrics || {} }));
}

async function whoAmI(token) {
  const url = `${BASE}/me`;
  const data = await getJson(url, token);
  return data;
}

function parseRepoUrl(url) {
  if (!url) return null;
  // Examples:
  //  - git@github.com:org/repo.git
  //  - https://github.com/org/repo.git
  //  - git+https://github.com/org/repo.git
  const httpsMatch = url.match(/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/);
  if (httpsMatch) {
    const parts = httpsMatch[0].split('/');
    const org = parts[1];
    const repo = parts[2].replace(/\.git$/, '');
    return { org, repo };
  }
  const sshMatch = url.match(/github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\.git/);
  if (sshMatch) {
    return { org: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

function getGitOriginUrlCwd() {
  try {
    const out = child_process.execSync('git config --get remote.origin.url', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out || null;
  } catch (_) {
    return null;
  }
}

function deriveSlugCandidates({ providedSlug, repoUrl, pkgRepoUrl }) {
  const cands = new Set();
  if (providedSlug) cands.add(normalizeSlug(providedSlug));
  const tryAdd = (org, repo) => {
    if (!org || !repo) return;
    cands.add(`gh/${org}/${repo}`);
    if (org.endsWith('-org')) {
      cands.add(`gh/${org.replace(/-org$/, '')}/${repo}`);
    }
  };
  const fromGit = parseRepoUrl(repoUrl || '');
  const fromPkg = parseRepoUrl(pkgRepoUrl || '');
  if (fromGit) tryAdd(fromGit.org, fromGit.repo);
  if (fromPkg) tryAdd(fromPkg.org, fromPkg.repo);
  return Array.from(cands);
}

async function listWorkflowJobs({ workflowId, token }) {
  // GET /workflow/{id}/job (returns list of jobs)
  const url = `${BASE}/workflow/${workflowId}/job`;
  const data = await getJson(url, token);
  return data.items || [];
}

async function getJobTests({ slug, jobNumber, token }) {
  // GET /project/{project-slug}/{job-number}/tests (paginated)
  const url = `${BASE}/project/${slug}/${jobNumber}/tests`;
  let items = [];
  let pageToken = undefined;
  while (true) {
    const params = pageToken ? { 'page-token': pageToken } : {};
    const data = await getJson(url, token, params);
    items = items.concat(data.items || []);
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return items;
}

// Build aggregated file stats from a map of per-file per-job maxima
function buildAggFromPerJobMax(perJobMax) {
  const results = [];
  for (const [file, jobMap] of perJobMax.entries()) {
    let total = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    let count = 0;
    for (const sec of jobMap.values()) {
      total += sec;
      count += 1;
      if (sec < min) min = sec;
      if (sec > max) max = sec;
    }
    const avg = count ? total / count : 0;
    results.push({ file, total, count, min, max, avg });
  }
  results.sort((a, b) => b.avg - a.avg);
  return results;
}

function human(sec) {
  if (sec >= 3600) return `${(sec / 3600).toFixed(2)}h`;
  if (sec >= 60) return `${(sec / 60).toFixed(2)}m`;
  return `${sec.toFixed(2)}s`;
}

function printTable(arr, top = 25) {
  const n = Math.min(top, arr.length);
  console.log(`\nTop ${n} files by avg duration:`);
  console.log('avg\tcount\tmin\tmax\tfile');
  for (let i = 0; i < n; i++) {
    const e = arr[i];
    console.log(`${human(e.avg)}\t${e.count}\t${human(e.min)}\t${human(e.max)}\t${e.file}`);
  }
}

function proposeSplits(arr, shards = 20) {
  // Greedy bin packing based on avg times
  const bins = Array.from({ length: shards }, () => ({ total: 0, files: [] }));
  for (const e of arr) {
    let best = 0;
    for (let i = 1; i < bins.length; i++) if (bins[i].total < bins[best].total) best = i;
    bins[best].files.push({ file: e.file, weight: e.avg });
    bins[best].total += e.avg;
  }
  return bins.map((b, i) => ({ shard: i, total_sec: b.total, total_h: human(b.total), count: b.files.length }));
}

async function main() {
  program
    .option('--slug <projectSlug>', 'CircleCI project slug, e.g., gh/org/repo (optional with --guess-slugs)')
    .option('--workflow <name>', 'Workflow name, e.g., web or run_pr_tests')
    .option('--branch <name>', 'Branch to filter by (optional)')
    .option('--jobs <name>', 'Only include job names matching this substring (default: remix-ide-browser)', 'remix-ide-browser')
    .option('--limit <n>', 'Max workflow runs to scan (default: 10)', (v) => parseInt(v, 10), 10)
    .option('--top <n>', 'How many rows to print (default: 25)', (v) => parseInt(v, 10), 25)
    .option('--shards <n>', 'Print a shard proposal for N shards', (v) => parseInt(v, 10), 0)
  .option('--overhead <sec>', 'Assumed per-shard overhead seconds to add to estimates', (v) => parseFloat(v), 0)
    .option('--json <path>', 'Path to write full JSON results (optional)')
    .option('--list-workflows', 'List available workflows for the given project slug and exit')
    .option('--whoami', 'Print token identity and exit')
    .option('--guess-slugs', 'Try to guess project slugs from git origin and package.json if the slug fails')
  .option('--verbose', 'Verbose logging for debugging', false)
    .parse(process.argv);

  const opts = program.opts();
  const token = getToken();

    // Normalize common mistakes in slug prefix and allow env var fallback
    if (!opts.slug && process.env.CIRCLECI_PROJECT_SLUG) {
      opts.slug = process.env.CIRCLECI_PROJECT_SLUG;
    }
    if (opts.slug) {
      opts.slug = normalizeSlug(opts.slug);
    }

  if (opts.whoami) {
    const me = await whoAmI(token);
    console.log('Token identity:', JSON.stringify(me, null, 2));
    return;
  }

  if (opts.listWorkflows) {
    console.log(`Listing workflows for slug=${opts.slug} branch=${opts.branch || 'all'}`);
    const workflows = await listWorkflows({ slug: opts.slug, branch: opts.branch, token });
    if (!workflows.length) {
      console.log('No workflows found (check slug/token).');
    } else {
      console.log('Workflows:');
      workflows.forEach((w) => console.log(` - ${w.name}`));
    }
    return;
  }

  if (!opts.workflow) {
    console.error('Missing --workflow. Use --list-workflows to discover names.');
    process.exit(2);
  }

  const candSlugs = deriveSlugCandidates({
    providedSlug: opts.slug,
    repoUrl: getGitOriginUrlCwd(),
    pkgRepoUrl: (function () { try { const p = JSON.parse(fs.readFileSync('package.json', 'utf-8')); return p?.repository?.url || null; } catch { return null; } })()
  });

  if (!candSlugs.length) {
    console.error('No candidate slugs could be derived. Provide --slug gh/<org>/<repo> or set CIRCLECI_PROJECT_SLUG, or run with --guess-slugs in a Git repo.');
    process.exit(2);
  }

  let pickedSlug = null;
  let runs = [];
  let tried = [];
  for (const slug of candSlugs) {
    try {
      console.log(`Fetching timings from CircleCI: slug=${slug} workflow=${opts.workflow} branch=${opts.branch || 'all'} limit=${opts.limit}`);
      try {
        runs = await listWorkflowRuns({ slug, workflowName: opts.workflow, branch: opts.branch, limit: opts.limit, token });
      } catch (insightsErr) {
        // Fallback via pipelines API (works even if Insights workflow runs are unavailable)
        const pipelines = await listPipelines({ slug, branch: opts.branch, limit: Math.max(50, opts.limit * 5), token });
        const wfRuns = [];
        for (const p of pipelines) {
          const wfs = await listPipelineWorkflows({ pipelineId: p.id, token });
          for (const w of wfs) {
            if (w.name === opts.workflow) {
              wfRuns.push({ id: w.id, created_at: p.created_at, status: w.status });
            }
            if (wfRuns.length >= opts.limit) break;
          }
          if (wfRuns.length >= opts.limit) break;
        }
        runs = wfRuns;
      }
      pickedSlug = slug;
      break;
    } catch (err) {
      const msg = err?.response?.data?.message || err.message;
      tried.push(`${slug} -> ${msg}`);
      if (!(opts.guessSlugs)) break; // do not continue if guessing is disabled
    }
  }

  if (!pickedSlug) {
    console.error('Unable to access workflow runs for any candidate slug.');
    console.error('Tried:');
    tried.forEach((t) => console.error(' -', t));
    console.error("Hint: run with '--whoami' to verify token, and '--list-workflows --guess-slugs' to discover valid workflow names.");
    process.exit(1);
  }

  if (!runs.length) {
    console.error('No workflow runs found.');
    process.exit(2);
  }

  // perJobMax: Map<file, Map<jobNumber, maxRuntimeSec>>
  const perJobMax = new Map();
  let scannedJobs = 0;
  for (const run of runs) {
    if (!run || !run.id) continue;
    let jobs = [];
    try {
      jobs = await listWorkflowJobs({ workflowId: run.id, token });
    } catch (e) {
      if (opts.verbose) console.warn(`Warn: could not fetch jobs for workflow ${run.id}:`, e.response?.data || e.message);
      continue;
    }
    for (const job of jobs) {
      const name = job.name || '';
      const status = job.status || '';
      const jobNumber = job.job_number || job.jobNumber || job.number;
      if (!name.includes(opts.jobs)) continue;
      if (status && status !== 'success') continue; // only successful jobs contribute timings
      if (!jobNumber) continue;
      let tests = [];
      try {
        tests = await getJobTests({ slug: pickedSlug, jobNumber, token });
      } catch (e) {
        if (opts.verbose) console.warn(`Warn: could not fetch tests for job #${jobNumber}:`, e.response?.data || e.message);
        continue;
      }
      scannedJobs++;
      for (const t of tests) {
        // t.file may be null if the reporter didn't provide it; fallback to classname
        const file = t.file || t.classname || null;
        if (!file) continue;
        const result = (t.result || '').toLowerCase();
        // Ignore non-success/skipped tests and near-zero durations (noisy/placeholder entries)
        if (result && result !== 'success' && result !== 'passed') continue;
        const rt = typeof t.run_time === 'number' ? t.run_time : (typeof t.time === 'number' ? t.time : 0);
        if (!(rt > 0.2)) continue; // drop 0 or sub-200ms to avoid dilution
        let m = perJobMax.get(file);
        if (!m) { m = new Map(); perJobMax.set(file, m); }
        const prev = m.get(jobNumber) || 0;
        if (rt > prev) m.set(jobNumber, rt);
      }
    }
  }

  const arr = buildAggFromPerJobMax(perJobMax);
  console.log(`\nAggregated ${arr.length} files from ${scannedJobs} successful job(s).`);
  if (!arr.length) {
    console.log('No test timing data found.');
  } else {
    printTable(arr, opts.top);
  }

  if (opts.shards && arr.length) {
    const shardPlan = proposeSplits(arr, opts.shards);
    console.log(`\nShard balance proposal for ${opts.shards} shards:`);
    const totals = shardPlan.map(b => b.total_sec);
    const sum = totals.reduce((a,b)=>a+b,0);
    const mean = sum / totals.length;
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const std = Math.sqrt(totals.reduce((a,b)=>a + (b-mean)*(b-mean),0) / totals.length);
    shardPlan.forEach((b) => {
      const t = b.total_sec + (opts.overhead || 0);
      const label = opts.overhead ? `${human(t)} (incl. overhead)` : human(b.total_sec);
      console.log(`#${b.shard}: ${label} across ${b.count} files`);
    });
    console.log(`Summary: mean=${human(mean)} min=${human(min)} max=${human(max)} stddev=${human(std)}`);
    if (opts.overhead) {
      console.log(`Assumed per-shard overhead: ${human(opts.overhead)}`);
    }
  }

  if (opts.json) {
    const out = {
      meta: { slug: opts.slug, workflow: opts.workflow, branch: opts.branch || null, limit: opts.limit, jobsFilter: opts.jobs },
      files: arr,
    };
    fs.writeFileSync(opts.json, JSON.stringify(out, null, 2));
    console.log(`\nWrote JSON to ${opts.json}`);
  }
}

main().catch((err) => {
  const data = err.response?.data;
  if (data?.message === 'Project not found') {
    console.error('Failed to fetch timings: Project not found.');
    console.error('Tips:');
    console.error(" - Use slug starting with 'gh/' for GitHub, e.g., gh/<org>/<repo> (not 'github/...')");
    console.error(' - Ensure CIRCLECI_TOKEN has access to this project');
    console.error(' - Slug you passed:', process.argv.join(' '));
  } else {
    console.error('Failed to fetch timings:', data || err.message || err);
  }
  process.exit(1);
});

#!/usr/bin/env node
/*
  CircleCI Failed Tests Fetcher

  Usage:
    CIRCLECI_TOKEN=... node scripts/circleci-failed-tests.js --slug gh/org/repo --workflow web --branch feat/x --jobs "remix-ide-browser" --limit 1

  Prints failing E2E test basenames (no .js) from the most recent workflow run on the given branch.
*/

const axios = require('axios');
const { program } = require('commander');
const fs = require('fs');
const child_process = require('child_process');

const BASE = 'https://circleci.com/api/v2';

function normalizeSlug(slug) {
  if (!slug) return slug;
  if (slug.startsWith('github/')) return slug.replace(/^github\//, 'gh/');
  if (slug.startsWith('bitbucket/')) return slug.replace(/^bitbucket\//, 'bb/');
  return slug;
}

function getToken() {
  const token = process.env.CIRCLECI_TOKEN || process.env.CIRCLE_TOKEN || '';
  if (!token) throw new Error('CIRCLECI_TOKEN env var is required.');
  return token;
}

async function getJson(url, token, params = {}, retries = 3) {
  const headers = { 'Circle-Token': token };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await axios.get(url, { headers, params, timeout: 20000 });
      return resp.data;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

async function listWorkflowRuns({ slug, workflowName, branch, limit = 1, token }) {
  const results = [];
  let pageToken;
  while (results.length < limit) {
    const params = {};
    if (branch) params.branch = branch;
    if (pageToken) params['page-token'] = pageToken;
    const url = `${BASE}/insights/${slug}/workflows/${workflowName}/runs`;
    const data = await getJson(url, token, params);
    const items = (data.items || []).filter(Boolean);
    for (const it of items) {
      if (results.length >= limit) break;
      results.push({ id: it.id, status: it.status, created_at: it.created_at });
    }
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return results;
}

async function listPipelines({ slug, branch, limit = 10, token }) {
  const results = [];
  let pageToken;
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
  const url = `${BASE}/pipeline/${pipelineId}/workflow`;
  const data = await getJson(url, token);
  return data.items || [];
}

function parseRepoUrl(url) {
  if (!url) return null;
  const httpsMatch = url.match(/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/);
  if (httpsMatch) {
    const parts = httpsMatch[0].split('/');
    const org = parts[1];
    const repo = parts[2].replace(/\.git$/, '');
    return { org, repo };
  }
  const sshMatch = url.match(/github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\.git/);
  if (sshMatch) return { org: sshMatch[1], repo: sshMatch[2] };
  return null;
}

function getGitOriginUrlCwd() {
  try {
    const out = child_process.execSync('git config --get remote.origin.url', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out || null;
  } catch (_) { return null; }
}

function deriveSlugCandidates({ providedSlug, repoUrl, pkgRepoUrl }) {
  const cands = new Set();
  if (providedSlug) cands.add(normalizeSlug(providedSlug));
  const add = (org, repo) => { if (org && repo) cands.add(`gh/${org}/${repo}`); };
  const fromGit = parseRepoUrl(repoUrl || '');
  const fromPkg = parseRepoUrl(pkgRepoUrl || '');
  if (fromGit) add(fromGit.org, fromGit.repo);
  if (fromPkg) add(fromPkg.org, fromPkg.repo);
  return Array.from(cands);
}

async function listWorkflowJobs({ workflowId, token }) {
  const url = `${BASE}/workflow/${workflowId}/job`;
  const data = await getJson(url, token);
  return data.items || [];
}

async function getJobTests({ slug, jobNumber, token }) {
  const url = `${BASE}/project/${slug}/${jobNumber}/tests`;
  let items = [];
  let pageToken;
  while (true) {
    const params = pageToken ? { 'page-token': pageToken } : {};
    const data = await getJson(url, token, params);
    items = items.concat(data.items || []);
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return items;
}

function baseNameNoJs(p) {
  const x = String(p || '').trim().split(/[\\/]/).pop();
  return x.replace(/\.js$/i, '');
}

async function main() {
  program
    .option('--slug <projectSlug>', 'CircleCI project slug, e.g., gh/org/repo')
    .option('--workflow <name>', 'Workflow name, e.g., web. Can be comma-separated list to check multiple workflows.')
    .option('--branch <name>', 'Branch to filter by (optional)')
    .option('--jobs <substr>', 'Include only jobs whose name contains this substring', 'remix-ide-browser')
    .option('--limit <n>', 'Number of workflow runs to check (default 1)', (v) => parseInt(v, 10), 1)
    .option('--mode <m>', "Selection mode: 'most-recent' (latest run only), 'first-failed' (first run with failures), or 'union' (across runs)", 'most-recent')
    .option('--verbose', 'Verbose logging', false)
    .parse(process.argv);

  const opts = program.opts();
  const token = getToken();
  const pkgRepoUrl = (() => { try { const p = JSON.parse(fs.readFileSync('package.json','utf-8')); return p?.repository?.url || null; } catch { return null; } })();
  const candSlugs = deriveSlugCandidates({ providedSlug: opts.slug || process.env.CIRCLECI_PROJECT_SLUG || '', repoUrl: getGitOriginUrlCwd(), pkgRepoUrl });
  if (!candSlugs.length) throw new Error('Missing --slug and unable to derive CIRCLECI project slug');
  if (!opts.workflow) throw new Error('Missing --workflow');

  // Support comma-separated workflow names
  const workflowNames = opts.workflow.split(',').map(s => s.trim()).filter(Boolean);
  if (!workflowNames.length) throw new Error('No workflow names provided');

  let slug = null;
  let allRuns = [];
  let lastErr = null;

  // For each workflow name, fetch runs and combine them
  for (const workflowName of workflowNames) {
    for (const s of candSlugs) {
      try {
        const runs = await listWorkflowRuns({ slug: s, workflowName, branch: opts.branch, limit: opts.limit, token });
        if (runs.length > 0) {
          slug = s;
          allRuns.push(...runs.map(r => ({ ...r, workflowName })));
        }
        break;
      } catch (e) {
        lastErr = e;
        // try pipelines fallback
        try {
          const pipes = await listPipelines({ slug: s, branch: opts.branch, limit: Math.max(50, opts.limit * 5), token });
          const wf = [];
          for (const p of pipes) {
            const wfs = await listPipelineWorkflows({ pipelineId: p.id, token });
            for (const w of wfs) {
              if (w.name === workflowName) wf.push({ id: w.id, status: w.status, created_at: p.created_at, workflowName });
              if (wf.length >= opts.limit) break;
            }
            if (wf.length >= opts.limit) break;
          }
          if (wf.length) { 
            allRuns.push(...wf); 
            slug = s; 
            break; 
          }
        } catch (e2) {
          lastErr = e2;
        }
      }
    }
  }

  if (!slug || !allRuns.length) {
    throw lastErr || new Error('Unable to find workflow runs via Insights or Pipelines for any candidate slug');
  }

  // Sort all runs by creation time (newest first)
  const runs = allRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (opts.verbose) {
    console.error(`\n=== Fetching failed tests from workflows: ${workflowNames.join(', ')} ===`);
    console.error(`Slug: ${slug}`);
    console.error(`Branch: ${opts.branch || '(all branches)'}`);
    console.error(`History limit: ${opts.limit} per workflow`);
    console.error(`Selection mode: ${opts.mode}`);
    console.error(`Found ${runs.length} workflow run(s) across all workflows:\n`);
    for (const run of runs) {
      console.error(`  - Workflow: ${run.workflowName || opts.workflow}`);
      console.error(`    ID: ${run.id}`);
      console.error(`    Status: ${run.status}`);
      console.error(`    Created: ${run.created_at}`);
    }
    console.error('');
  }

  const failing = new Set();
  for (const run of runs) {
    const jobs = await listWorkflowJobs({ workflowId: run.id, token });
    const targetJobs = jobs.filter((j) => (j.name || '').includes(opts.jobs));
    const failingJobs = targetJobs.filter((j) => (j.status || '') !== 'success');
    
    if (opts.verbose) {
      console.error(`\n--- Workflow ${run.id} (${run.status}) ---`);
      console.error(`  Total jobs matching "${opts.jobs}": ${targetJobs.length}`);
      console.error(`  Failing jobs: ${failingJobs.length}`);
      if (failingJobs.length > 0) {
        console.error(`  Failed job details:`);
        for (const fj of failingJobs) {
          console.error(`    - Job: ${fj.name} (#${fj.job_number || fj.number})`);
          console.error(`      Status: ${fj.status}`);
        }
      }
    }
    
    if (opts.mode === 'most-recent') {
      // Always use the most recent run, even if it passed
      if (opts.verbose) {
        if (failingJobs.length > 0) {
          console.error(`  → Most recent run has failures. Collecting failed tests...`);
        } else {
          console.error(`  → Most recent run passed. No tests to rerun.`);
        }
      }
      for (const job of failingJobs) {
        const jobNumber = job.job_number || job.number;
        if (!jobNumber) continue;
        const tests = await getJobTests({ slug, jobNumber, token });
        if (opts.verbose) {
          console.error(`    - Job #${jobNumber}: ${tests.length} test results`);
        }
        for (const t of tests) {
          const result = (t.result || '').toLowerCase();
          if (result && result !== 'success' && result !== 'passed') {
            const file = t.file || t.classname || null;
            if (!file) continue;
            const basename = baseNameNoJs(file);
            failing.add(basename);
            if (opts.verbose) {
              console.error(`      ✗ ${basename} (${result})`);
            }
          }
        }
      }
      if (opts.verbose) console.error(`\n  → Using most recent run only (most-recent mode)`);
      break; // Only check the first/most recent run
    } else if (opts.mode === 'first-failed') {
      if (!failingJobs.length) {
        if (opts.verbose) console.error(`  → No failing jobs; moving to older run.`);
        continue; // check older runs until we find failing ones
      }
      if (opts.verbose) console.error(`  → Found failures! Collecting failed tests from this run...`);
      for (const job of failingJobs) {
        const jobNumber = job.job_number || job.number;
        if (!jobNumber) continue;
        const tests = await getJobTests({ slug, jobNumber, token });
        if (opts.verbose) {
          console.error(`    - Job #${jobNumber}: ${tests.length} test results`);
        }
        for (const t of tests) {
          const result = (t.result || '').toLowerCase();
          if (result && result !== 'success' && result !== 'passed') {
            const file = t.file || t.classname || null;
            if (!file) continue;
            const basename = baseNameNoJs(file);
            failing.add(basename);
            if (opts.verbose) {
              console.error(`      ✗ ${basename} (${result})`);
            }
          }
        }
      }
      if (opts.verbose) console.error(`\n  → Stopping at first run with failures (first-failed mode)`);
      break; // stop at the first run with failures
    } else {
      // union mode: collect across up to N runs, only from failing jobs
      if (opts.verbose && failingJobs.length > 0) {
        console.error(`  → Union mode: collecting failures from this run...`);
      }
      for (const job of failingJobs) {
        const jobNumber = job.job_number || job.number;
        if (!jobNumber) continue;
        const tests = await getJobTests({ slug, jobNumber, token });
        if (opts.verbose && tests.length > 0) {
          console.error(`    - Job #${jobNumber}: ${tests.length} test results`);
        }
        for (const t of tests) {
          const result = (t.result || '').toLowerCase();
          if (result && result !== 'success' && result !== 'passed') {
            const file = t.file || t.classname || null;
            if (!file) continue;
            const basename = baseNameNoJs(file);
            failing.add(basename);
            if (opts.verbose) {
              console.error(`      ✗ ${basename} (${result})`);
            }
          }
        }
      }
    }
  }

  if (opts.verbose) {
    console.error(`\n=== Summary ===`);
    console.error(`Total unique failed tests: ${failing.size}`);
    console.error('');
  }

  for (const name of failing) {
    process.stdout.write(name + '\n');
  }
}

main().catch((e) => {
  console.error('Failed to fetch failed tests:', e.response?.data || e.message || e);
  process.exit(1);
});

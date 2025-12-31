#!/usr/bin/env node
/*
  generate-failed-report.js

  Downloads the latest CircleCI failed E2E tests (metadata + screenshots) and renders a single HTML report.

  Requirements:
    - Env CIRCLECI_TOKEN must be set (a CircleCI personal token with read permissions)

  Usage examples:
    node scripts/generate-failed-report.js \
      --slug gh/remix-project-org/remix-project \
      --workflow web \
      --branch feat/nx-cloud/setup \
      --jobs remix-ide-browser \
      --out reports/ci-latest-failed

  Options:
    --slug         CircleCI project slug (default: gh/remix-project-org/remix-project)
  --workflow     Workflow name to search (default: web). You can also pass a full workflow URL or a raw workflow UUID and it will be detected automatically.
    --workflow-id  Explicit workflow ID (UUID). If set, branch/workflow name search is skipped.
    --branch       Branch to filter pipelines (default: current git branch or env CIRCLE_BRANCH)
    --limit        Pipelines to scan back (default: 15)
    --jobs         Comma-separated job names to include (default: remix-ide-browser)
    --out          Output directory (default: reports/ci-latest-failed)
*/

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TOKEN = process.env.CIRCLECI_TOKEN || '';
if (!TOKEN) {
  console.error('CIRCLECI_TOKEN env var is required');
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const SLUG = args.slug || inferSlug() || 'gh/remix-project-org/remix-project';
const WORKFLOW = args.workflow || 'web';
const WORKFLOW_ID = args['workflow-id'] || args.workflowId || extractWorkflowId(WORKFLOW) || '';
const LIMIT = Number(args.limit || 15);
const OUTDIR = args.out || path.join('reports', 'ci-latest-failed');
const JOBS = String(args.jobs || 'remix-ide-browser')
  .split(',').map(s => s.trim()).filter(Boolean);
const BRANCH = args.branch || inferBranch();

(async () => {
  ensureDir(OUTDIR);
  const ctx = { slug: SLUG, workflowName: WORKFLOW, branch: BRANCH, limit: LIMIT, outdir: OUTDIR, jobs: JOBS };
  log(`Project: ${SLUG}`);
  log(`Workflow: ${WORKFLOW}`);
  log(`Branch: ${BRANCH || '(any)'}`);

  let pipeline, wf;
  if (WORKFLOW_ID) {
    // Direct workflow mode
    wf = await getWorkflowById(WORKFLOW_ID);
    if (!wf || !wf.id) {
      log(`Workflow ${WORKFLOW_ID} not found.`);
      await writeHtml(ctx, { title: 'Workflow not found', sections: [ { heading: 'Invalid workflow id', items: [] } ], meta: { generatedAt: new Date().toISOString() } });
      process.exit(2);
    }
    pipeline = await getPipelineById(wf.pipeline_id);
    log(`Using provided workflow ${wf.name} (${wf.id}), pipeline #${pipeline?.number ?? 'N/A'} (${wf.pipeline_id}), status=${wf.status}`);
  } else {
    const found = await findLatestPipelineWithWorkflow(SLUG, WORKFLOW, BRANCH, LIMIT);
    pipeline = found.pipeline; const workflows = found.workflows;
    if (!pipeline || !workflows.length) {
      log('No suitable pipeline/workflow found. Exiting.');
      await writeHtml(ctx, { title: 'No failures found', sections: [ { heading: 'No recent workflow found', items: [] } ], meta: { generatedAt: new Date().toISOString() } });
      process.exit(0);
    }
    wf = workflows[0]; // pick the most recent matching workflow
    log(`Using pipeline #${pipeline.number} (${pipeline.id}), workflow ${wf.name} (${wf.id}), status=${wf.status}`);
  }

  const jobs = await getJobs(wf.id);
  const targetJobs = jobs.filter(j => jobNameMatches(j.name, JOBS) && ['success', 'failed', 'failing', 'error'].includes(j.status));
  if (!targetJobs.length) {
    log('No completed target jobs in workflow.');
  }
  log(`Matched ${targetJobs.length} job(s): ${targetJobs.map(j=>j.name+`#${j.job_number}`).join(', ')}`);

  const failures = [];
  const assets = [];

  for (const job of targetJobs) {
    const jobNum = job.job_number;
    const jobOutDir = path.join(OUTDIR, `job-${jobNum}`);
    ensureDir(jobOutDir);

    const tests = await getTests(SLUG, jobNum);
    const failing = tests.filter(t => (t.result || '').toLowerCase() === 'failure');

    // Download screenshots artifacts for this job (filtered):
    // - Always include images that best-match any failing test
    // - For screenshots WITHOUT metadata (orphans), only include files whose name contains "FAILED"
    const artifacts = await getArtifacts(SLUG, jobNum);
    const shotArtifacts = artifacts.filter(a => /reports\/screenshots\//.test(a.path) && /\.(png|jpg|jpeg|gif)$/i.test(a.path));
    const selected = shotArtifacts.filter(a => imageMatchesAnyFailure(a.path, failing) || containsFailed(a.path));
    const downloaded = [];
    for (const a of selected) {
      const rel = a.path.replace(/^.*reports\/screenshots\//, 'screenshots/');
      const dest = path.join(jobOutDir, rel);
      await downloadFile(a.url, dest);
      downloaded.push({ rel: path.relative(OUTDIR, dest), abs: dest, name: path.basename(dest), url: a.url });
    }
    log(`Job #${jobNum}: ${shotArtifacts.length} screenshots found, ${downloaded.length} downloaded (filtered by failures/FAILED).`);
  assets.push({ job, images: downloaded });

    // Map failures to images by best-effort matching
    for (const f of failing) {
      const base = deriveBaseFromTest(f);
      const match = pickBestImageMatch(downloaded, base, f.name || '');
      failures.push({ job, test: f, image: match });
    }
  }

  // Build HTML report
  const items = failures.map(f => formatFailureItem(ctx, pipeline, wf, f));
  // Build secondary section for screenshots without matched failure metadata
  const used = new Set(items.map(i => {
    const m = i.html.match(/src=\"([^\"]+)/);
    return m ? m[1] : '';
  }).filter(Boolean));
  const orphanCards = [];
  for (const a of assets) {
    for (const img of a.images) {
      if (!used.has(img.rel)) {
        orphanCards.push({ html: renderImageOnlyCard(SLUG, pipeline, wf, a.job, img) });
      }
    }
  }

  const sections = [];
  sections.push({ heading: 'Failing tests', items });
  if (orphanCards.length) sections.push({ heading: 'Screenshots (no failure metadata)', items: orphanCards });
  const title = failures.length ? `E2E failures: ${failures.length} test(s)` : 'No failing tests found';

  const metaBranch = pipeline?.vcs?.branch || BRANCH;
  const meta = { generatedAt: new Date().toISOString(), pipelineNumber: pipeline?.number, pipelineId: pipeline?.id, workflowId: wf.id, branch: metaBranch, workflowStatus: wf.status };
  await writeHtml(ctx, { title, sections, meta });

  // Write summary.json for bots/PR comments
  try {
    const summary = {
      ...meta,
      workflowName: wf.name,
      failures: failures.map(f => ({
        jobNumber: f.job.job_number,
        file: f.test.file || f.test.classname || '',
        name: f.test.name || deriveBaseFromTest(f.test),
        image: f.image ? path.join(`job-${f.job.job_number}`, f.image.rel) : null
      }))
    };
    fs.writeFileSync(path.join(OUTDIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  } catch (e) {
    log('Failed to write summary.json:', e?.message || e);
  }

  log(`Report written to ${path.join(OUTDIR, 'index.html')}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});

// ------------- Helpers -------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

function inferBranch() {
  try {
    return process.env.CIRCLE_BRANCH || execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (_) {
    return '';
  }
}

function inferSlug() {
  const u = process.env.CIRCLE_PROJECT_USERNAME;
  const r = process.env.CIRCLE_PROJECT_REPONAME;
  const s = process.env.CIRCLE_PROJECT_SLUG; // e.g., gh/org/repo
  if (s && /^(gh|github)\//.test(s)) return s;
  if (u && r) return `gh/${u}/${r}`;
  return '';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function log(...args) { console.log('[failed-report]', ...args); }

async function apiGet(url) {
  const res = await fetch(url, { headers: { 'Circle-Token': TOKEN } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}: ${text}`);
  }
  return res.json();
}

async function apiGetPaged(url, key = 'items', limit = 200) {
  let next = null;
  const all = [];
  do {
    const u = new URL(url);
    if (next) u.searchParams.set('page-token', next);
    const json = await apiGet(u.toString());
    const items = Array.isArray(json[key]) ? json[key] : [];
    all.push(...items);
    next = json.next_page_token || null;
    if (all.length >= limit) break;
  } while (next);
  return all;
}

async function getPipelines(slug, branch, limit = 25) {
  let url = `https://circleci.com/api/v2/project/${slug}/pipeline?`;
  if (branch) url += `branch=${encodeURIComponent(branch)}&`;
  url += `limit=${Math.min(limit, 100)}`;
  const json = await apiGet(url);
  return json.items || [];
}

async function getWorkflowsForPipeline(pipelineId) {
  const url = `https://circleci.com/api/v2/pipeline/${pipelineId}/workflow`;
  const json = await apiGet(url);
  return json.items || [];
}

async function getJobs(workflowId) {
  const url = `https://circleci.com/api/v2/workflow/${workflowId}/job`;
  const json = await apiGet(url);
  return json.items || [];
}
async function getWorkflowById(workflowId) {
  const url = `https://circleci.com/api/v2/workflow/${workflowId}`;
  return apiGet(url);
}
async function getPipelineById(pipelineId) {
  const url = `https://circleci.com/api/v2/pipeline/${pipelineId}`;
  return apiGet(url);
}

async function getArtifacts(slug, jobNumber) {
  const url = `https://circleci.com/api/v2/project/${slug}/${jobNumber}/artifacts`;
  const json = await apiGet(url);
  return json.items || [];
}

async function getTests(slug, jobNumber) {
  // Paged endpoint
  const url = `https://circleci.com/api/v2/project/${slug}/${jobNumber}/tests`;
  const items = await apiGetPaged(url, 'items', 1000);
  return items || [];
}

async function downloadFile(fileUrl, destPath) {
  ensureDir(path.dirname(destPath));
  const res = await fetch(fileUrl, { headers: { 'Circle-Token': TOKEN } });
  if (!res.ok) throw new Error(`Failed to download ${fileUrl}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

function deriveBaseFromTest(t) {
  // Try to map to test file basename without extension
  const file = (t.file || t.source || t.classname || '').toString();
  const name = (t.name || '').toString();
  const baseFromFile = file ? path.basename(file).replace(/\.(js|ts|mjs|cjs|jsx)$/i, '') : '';
  if (baseFromFile) return baseFromFile;
  // Try extract groupX.test style
  const m = name.match(/([A-Za-z0-9_\-]+\.(test|spec))/i);
  if (m) return m[1].replace(/\.(test|spec)$/i, '');
  return name.trim().slice(0, 80);
}

function normalize(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function pickBestImageMatch(images, base, name) {
  if (!images || !images.length) return null;
  const nBase = normalize(base);
  const nName = normalize(name);
  let best = null;
  let bestScore = -1;
  for (const img of images) {
    const n = normalize(img.name);
    let s = 0;
    if (n.includes(nBase)) s += 5;
    if (n.includes(nName)) s += 3;
    if (/fail|error|assert|timeout/.test(n)) s += 1;
    if (s > bestScore) { bestScore = s; best = img; }
  }
  return best || images[0];
}

async function findLatestPipelineWithWorkflow(slug, workflowName, branch, limit) {
  const pipelines = await getPipelines(slug, branch, limit);
  for (const p of pipelines) {
    const wfs = await getWorkflowsForPipeline(p.id);
    const matches = wfs.filter(w => w.name === workflowName).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    if (matches.length) return { pipeline: p, workflows: matches };
  }
  return { pipeline: null, workflows: [] };
}

function extractWorkflowId(val) {
  if (!val) return '';
  const s = String(val).trim();
  // Full URL: .../workflows/<uuid>
  const urlMatch = s.match(/\/workflows\/([0-9a-fA-F-]{36})/);
  if (urlMatch) return urlMatch[1];
  // Raw UUID
  if (/^[0-9a-fA-F-]{36}$/.test(s)) return s;
  return '';
}

function formatFailureItem(ctx, pipeline, wf, f) {
  const job = f.job;
  const t = f.test;
  const img = f.image;
  const message = (t.message || '').toString();
  const shortMsg = message.split(/\n|\r/).slice(0, 4).join(' ').slice(0, 400);
  const base = deriveBaseFromTest(t);
  const jobLink = buildJobLink(ctx.slug, pipeline, wf, job);

  return {
    html: `
      <div class="card">
        <div class="meta">
          <div class="title">${escapeHtml(t.name || base)}</div>
          <div class="sub">File: ${escapeHtml(t.file || t.classname || '')}</div>
          <div class="sub">Job #${job.job_number} · <a href="${jobLink}" target="_blank" rel="noopener">Open in CircleCI</a></div>
          <div class="msg">${escapeHtml(shortMsg || '(no failure message)')}</div>
        </div>
        <div class="media">${img ? `<a href="${img.url ? encodeURI(img.url) : '#'}" target="_blank" rel="noopener"><img src="${encodeURI(img.rel)}" alt="screenshot" /></a>` : '<div class="placeholder">No screenshot</div>'}</div>
      </div>
    `
  };
}

function buildJobLink(slug, pipeline, wf, job) {
  // slug: gh/org/repo
  try {
    const [, vcs, org, repo] = slug.match(/^(gh|github|bb|bitbucket|gl|gitlab)\/(.*?)\/(.*?)$/) || [];
    if (!vcs || !org || !repo) return `https://app.circleci.com/pipelines/${slug}/workflows/${wf.id}/jobs/${job.job_number}`;
    return `https://app.circleci.com/pipelines/${vcs}/${org}/${repo}/${pipeline.number}/workflows/${wf.id}/jobs/${job.job_number}`;
  } catch (_) {
    return `https://app.circleci.com/pipelines/${slug}/workflows/${wf.id}/jobs/${job.job_number}`;
  }
}

async function writeHtml(ctx, data) {
  const out = ctx.outdir;
  ensureDir(out);
  const html = renderHtml(data);
  fs.writeFileSync(path.join(out, 'index.html'), html, 'utf8');
}

function renderHtml({ title, sections, meta }) {
  const secHtml = sections.map(sec => `
    <section>
      <h2>${escapeHtml(sec.heading)}</h2>
      <div class="grid">
        ${sec.items.map(i => i.html).join('\n') || '<div class="empty">No items</div>'}
      </div>
    </section>
  `).join('\n');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body{font-family: system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial,sans-serif;margin:20px;background:#0b0e14;color:#e6e6e6;}
    a{color:#7cc4ff}
    h1{font-size:20px;margin:0 0 10px}
    h2{font-size:16px;margin:20px 0 10px;color:#c7d2fe}
    .meta-bar{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:#A7B0C0;margin-bottom:10px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px}
    .card{background:#141821;border:1px solid #232a36;border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
    .card .meta{padding:12px;border-bottom:1px solid #232a36}
    .card .title{font-weight:600;margin-bottom:6px}
    .card .sub{font-size:12px;color:#a9b1c7;margin-top:2px}
    .card .msg{margin-top:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;white-space:pre-wrap;color:#e6e6e6}
    .card .media{background:#0f131b;max-height:540px;overflow:auto;text-align:center}
    .card img{max-width:100%;height:auto;display:block;margin:0 auto}
    .placeholder{padding:24px;color:#6b7280}
    .empty{opacity:0.7}
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta-bar">
    <div>Generated: ${escapeHtml(meta.generatedAt || '')}</div>
    ${meta.branch ? `<div>Branch: ${escapeHtml(meta.branch)}</div>` : ''}
    ${meta.pipelineNumber ? `<div>Pipeline: #${escapeHtml(String(meta.pipelineNumber))}</div>` : ''}
    ${meta.workflowStatus ? `<div>Workflow: ${escapeHtml(meta.workflowStatus)}</div>` : ''}
  </div>
  ${secHtml}
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function jobNameMatches(name, patterns) {
  const n = String(name || '');
  for (const p of patterns) {
    const pat = String(p || '');
    if (!pat) continue;
    // Exact or prefix match (covers CircleCI matrix children like "remix-ide-browser (0)")
    if (n === pat || n.startsWith(pat)) return true;
  }
  return false;
}

function renderImageOnlyCard(slug, pipeline, wf, job, img) {
  const jobLink = buildJobLink(slug, pipeline, wf, job);
  return `
    <div class="card">
      <div class="meta">
        <div class="title">${escapeHtml(img.name)}</div>
        <div class="sub">Job #${job.job_number} · <a href="${jobLink}" target="_blank" rel="noopener">Open in CircleCI</a></div>
        <div class="msg">No test metadata found for this image.</div>
      </div>
      <div class="media"><a href="${img.url ? encodeURI(img.url) : '#'}" target="_blank" rel="noopener"><img src="${encodeURI(img.rel)}" alt="screenshot" /></a></div>
    </div>
  `;
}

function containsFailed(s) {
  return /FAILED/i.test(String(s));
}

function imageMatchesAnyFailure(imagePath, failingTests) {
  if (!Array.isArray(failingTests) || !failingTests.length) return false;
  const base = path.basename(String(imagePath));
  const nBase = normalize(base);
  for (const t of failingTests) {
    const b = normalize(deriveBaseFromTest(t));
    const nm = normalize(t.name || '');
    if (nBase.includes(b) || nBase.includes(nm)) return true;
  }
  return false;
}

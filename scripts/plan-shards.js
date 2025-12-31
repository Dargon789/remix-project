#!/usr/bin/env node
/*
  Shard Planner for Nightwatch tests

  Usage:
    # Build a list of test basenames (without .js), then pipe into the planner
    echo -e "a.test\nb.test" | node scripts/plan-shards.js --shards 20 --index 3 --timings timings.json

  Inputs:
    - STDIN: newline-separated list of test basenames (no .js), e.g., txListener_group1.test
    - --shards: total number of shards (default 1)
    - --index: shard index [0..shards-1] (default 0)
    - --timings: optional JSON from circleci-timings.js --json; used to weight tests
    - --verbose: optional, print summary to stderr

  Output:
    - Prints the basenames that belong to the given shard index, one per line
*/

const fs = require('fs');

function parseArgs(argv) {
  const args = { shards: 1, index: 0, timings: null, verbose: false, manifestOut: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--shards') args.shards = parseInt(argv[++i], 10);
    else if (a === '--index') args.index = parseInt(argv[++i], 10);
    else if (a === '--timings') args.timings = argv[++i];
  else if (a === '--verbose') args.verbose = true;
  else if (a === '--manifest-out') args.manifestOut = argv[++i];
  }
  if (!(args.shards >= 1)) args.shards = 1;
  if (!(args.index >= 0 && args.index < args.shards)) args.index = 0;
  return args;
}

function baseNameNoJs(p) {
  // Accept either raw basename or a path; we just strip trailing .js if present
  const x = p.trim().split(/[\\/]/).pop();
  return x.replace(/\.js$/i, '');
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('error', reject);
    process.stdin.on('end', () => resolve(data));
  });
}

function median(arr) {
  if (!arr.length) return 1;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function main() {
  const args = parseArgs(process.argv);
  const stdin = (await readStdin()).trim();
  const names = stdin ? stdin.split(/\r?\n/).map(baseNameNoJs).filter(Boolean) : [];
  if (!names.length) {
    if (args.verbose) console.error('No tests received on stdin; nothing to split.');
    process.exit(0);
  }

  // Load timings if provided
  let weightByName = new Map();
  if (args.timings && fs.existsSync(args.timings)) {
    try {
      const j = JSON.parse(fs.readFileSync(args.timings, 'utf-8'));
      const files = j.files || [];
      for (const f of files) {
        if (!f || !f.file) continue;
        const key = baseNameNoJs(f.file);
        const avg = typeof f.avg === 'number' ? f.avg : (typeof f.total === 'number' && typeof f.count === 'number' && f.count ? f.total / f.count : 0);
        if (avg > 0) weightByName.set(key, avg);
      }
    } catch (e) {
      if (args.verbose) console.error('Failed to parse timings JSON:', e.message);
    }
  }

  // Default weight for unknown tests: median of known averages, fallback 15s
  const defaultW = (() => {
    const vals = Array.from(weightByName.values());
    if (vals.length) return median(vals);
    return 15; // seconds
  })();

  // Build items
  const items = names.map((n) => ({ name: n, w: weightByName.get(n) || defaultW }));
  // Sort descending by weight so bigger tests placed first
  items.sort((a, b) => b.w - a.w || a.name.localeCompare(b.name));

  // Greedy bin packing
  const bins = Array.from({ length: args.shards }, () => ({ total: 0, items: [] }));
  for (const it of items) {
    let best = 0;
    for (let i = 1; i < bins.length; i++) if (bins[i].total < bins[best].total) best = i;
    bins[best].items.push(it);
    bins[best].total += it.w;
  }

  if (args.verbose) {
    bins.forEach((b, i) => {
      console.error(`#${i}\tcount=${b.items.length}\ttotal=${b.total.toFixed(2)}s`);
    });
  }

  if (args.manifestOut) {
    try {
      const manifest = {
        shards: args.shards,
        index: args.index,
        totals: bins.map((b) => b.total),
        bins: bins.map((b) => ({ total: b.total, items: b.items })),
      };
      require('fs').mkdirSync(require('path').dirname(args.manifestOut), { recursive: true });
      require('fs').writeFileSync(args.manifestOut, JSON.stringify(manifest, null, 2));
      if (args.verbose) console.error(`Wrote manifest to ${args.manifestOut}`);
    } catch (e) {
      console.error(`Failed to write manifest to ${args.manifestOut}:`, e.message);
    }
  }

  // Emit only the selected shard's names
  const sel = bins[args.index] || { items: [] };
  const out = sel.items.map((i) => i.name).join('\n');
  process.stdout.write(out + (out ? '\n' : ''));
}

main().catch((e) => {
  console.error('Shard planner failed:', e.stack || e.message);
  process.exit(1);
});

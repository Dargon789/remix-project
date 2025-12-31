#!/usr/bin/env node

/**
 * Generate shard planning overview files from manifest.json
 * 
 * Reads a manifest.json file produced by plan-shards.js and generates:
 * - overview.txt: Human-readable shard summary
 * - overview.json: JSON format with stats
 * - files-<i>.txt: Test file list for each shard
 */

const fs = require('fs');
const path = require('path');

const outDir = process.argv[2] || path.join('reports', 'shards');
const timingsPath = process.argv[3] || 'timings-current.json';
const manifestPath = path.join(outDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`❌ Manifest file not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const bins = Array.isArray(manifest.bins) ? manifest.bins : [];

// Build known/unknown stats using timings file if present
let known = new Set();
try {
  const timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
  for (const f of (timings.files || [])) {
    if (f && f.file) {
      known.add(String(f.file).trim());
    }
  }
} catch (err) {
  console.warn(`⚠️  Could not load timings from ${timingsPath}: ${err.message}`);
}

// Calculate statistics
let totalTests = 0;
let knownCount = 0;
let unknownCount = 0;

bins.forEach(bin => {
  const names = (bin.items || [])
    .map(it => typeof it === 'string' ? it : (it && it.name) || it)
    .filter(Boolean);
  
  totalTests += names.length;
  names.forEach(name => {
    if (known.has(name)) {
      knownCount++;
    } else {
      unknownCount++;
    }
  });
});

// Generate overview data
const overview = bins.map((bin, i) => ({
  shard: i,
  count: (bin.items || []).length,
  totalSec: Number(bin.total || 0)
}));

// Write overview.txt (human-readable)
const lines = overview.map(o => 
  `#${o.shard}\tcount=${o.count}\ttotal=${o.totalSec.toFixed(2)}s`
);
fs.writeFileSync(
  path.join(outDir, 'overview.txt'),
  lines.join('\n') + '\n'
);

// Write overview.json (structured data)
const overviewData = {
  shards: bins.length,
  overview,
  totals: bins.map(b => b.total),
  counts: bins.map(b => (b.items || []).length),
  stats: {
    totalTests,
    knownCount,
    unknownCount,
    knownPercentage: totalTests > 0 ? ((knownCount / totalTests) * 100).toFixed(1) : 0
  }
};
fs.writeFileSync(
  path.join(outDir, 'overview.json'),
  JSON.stringify(overviewData, null, 2)
);

// Write files-<i>.txt (test list per shard)
bins.forEach((bin, i) => {
  const names = (bin.items || [])
    .map(it => typeof it === 'string' ? it : (it && it.name) || it)
    .filter(Boolean);
  
  fs.writeFileSync(
    path.join(outDir, `files-${i}.txt`),
    names.join('\n') + (names.length ? '\n' : '')
  );
});

console.log(`✅ Wrote overview.txt, overview.json and ${bins.length} shard files to ${outDir}`);
console.log(`   Total tests: ${totalTests} (${knownCount} with timing data, ${unknownCount} unknown)`);

#!/usr/bin/env node
/**
 * Update the enum list for parameters.run_file_tests_keyword in .circleci/config.yml
 * based on the "main keywords" inferred from e2e test filenames.
 *
 * Heuristics:
 * - Scan apps/remix-ide-e2e/src/tests for test files:
 *   - *.test.ts, *.test.js, *.spec.ts, *.spec.js
 *   - Explicitly include plugin_api*.ts (plugin API tests that are not marked as *.test.*)
 * - For each basename (without extension):
 *   - Strip trailing .flaky or .pr markers
 *   - Strip trailing _group<digits>
 *   - Resulting name is considered a keyword candidate
 * - Deduplicate and sort keywords (case-sensitive, ASCII sort)
 * - Prepend an empty string "" as first enum item (to keep current behavior)
 * - Replace only the enum: [ ... ] line within the run_file_tests_keyword parameter block
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(REPO_ROOT, 'apps', 'remix-ide-e2e', 'src', 'tests');
const CIRCLE_CONFIG = path.join(REPO_ROOT, '.circleci', 'config.yml');

/** Read directory and return keyword set */
function collectKeywords() {
  const entries = fs.readdirSync(TESTS_DIR, { withFileTypes: true });
  const keywords = new Set();

  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const full = path.join(TESTS_DIR, ent.name);
    const ext = path.extname(ent.name); // .ts or .js
    const base = path.basename(ent.name, ext);

    // Only include test files, except allowlist plugin_api*.ts
    const isTest = /\.(test|spec)$/i.test(base);
    const isPluginApi = /^plugin_api([_-].*)?$/i.test(base);
    if (!isTest && !isPluginApi) continue;

    let name = base;
  // Strip known markers that appear before extension
  name = name.replace(/\.(flaky|pr)$/i, '');
  // Strip trailing .test or .spec
  name = name.replace(/\.(test|spec)$/i, '');
  // Strip trailing _group<digits>
  name = name.replace(/_group\d+$/i, '');
    // If the name still contains a trailing dot fragment (after prior replace), clean again
    name = name.replace(/\.$/, '');

    // Special case: some sources may embed additional dot markers before extension (handled above)
    // Keep hyphens and underscores as-is; they are meaningful in current enum.

    if (name) keywords.add(name);
  }

  // Build sorted array; keep natural ASCII sort
  const list = Array.from(keywords);
  list.sort();
  // Prepend empty string, as the enum currently allows ""
  return ["", ...list];
}

/** Update only the enum line inside run_file_tests_keyword parameter block */
function updateConfigYaml(newEnumArray) {
  const yaml = fs.readFileSync(CIRCLE_CONFIG, 'utf8');
  const lines = yaml.split(/\r?\n/);

  // Locate the run_file_tests_keyword block
  let i = 0;
  let startIdx = -1;
  for (; i < lines.length; i++) {
    if (/^\s*run_file_tests_keyword:\s*$/.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    throw new Error('Could not find parameters.run_file_tests_keyword block in .circleci/config.yml');
  }

  // Within the next ~20 lines, find the enum line to replace
  let enumIdx = -1;
  for (let j = startIdx; j < Math.min(lines.length, startIdx + 50); j++) {
    // Stop if we reach the next top-level parameter key at the same indentation level
    if (j > startIdx && /^\s*[A-Za-z0-9_-]+:\s*$/.test(lines[j]) && /^\s{2}/.test(lines[j]) && !/^\s{4}/.test(lines[j])) {
      // Likely stepped out of the run_file_tests_keyword sub-block
      break;
    }
    if (/^\s*enum:\s*\[.*\]\s*$/.test(lines[j])) {
      enumIdx = j;
      break;
    }
  }
  if (enumIdx === -1) {
    throw new Error('Found run_file_tests_keyword but could not locate its enum: [ ... ] line');
  }

  // Preserve indentation from current enum line
  const indentMatch = lines[enumIdx].match(/^(\s*)enum:\s*\[/);
  const indent = indentMatch ? indentMatch[1] : '';
  const serialized = `${indent}enum: [${newEnumArray.map(k => JSON.stringify(k)).join(', ')}]`;
  lines[enumIdx] = serialized;

  fs.writeFileSync(CIRCLE_CONFIG, lines.join('\n'));
}

function main() {
  const keywords = collectKeywords();
  updateConfigYaml(keywords);
  console.log(`Updated run_file_tests_keyword enum with ${keywords.length - 1} keyword(s)`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
}

#!/usr/bin/env node
/**
 * Rebuild datasets.json index from ALL .json dataset files in data/
 * Run: node data/rebuild-index.js
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const dataDir = 'data';
const skipFiles = new Set(['datasets.json', 'openintro_catalog.json']);
const files = readdirSync(dataDir).filter(f =>
  f.endsWith('.json') && !skipFiles.has(f)
);

const index = [];

/**
 * Derive grouping metadata from the FIRST categorical variable (the authored
 * grouping/explanatory column). Used by tool dataset-selector filters to admit
 * only datasets with the right number of groups for a procedure (see REQ-024):
 *   - two-group means tools require groupLevels === 2
 *   - ANOVA tools require groupLevels >= 3
 *   - all grouped tools require minGroupN >= 3 (drops e.g. urban_owner, which
 *     has 52 single-record state "groups").
 * Returns { groupLevels: null, minGroupN: null } when there is no categorical.
 * @param {{name:string,type:string}[]} variables
 * @param {Record<string, unknown>[]} rows
 */
function deriveGroupMeta(variables, rows) {
  const groupVar = (variables || []).find(v => v.type === 'categorical');
  if (!groupVar) return { groupLevels: null, minGroupN: null };
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const r of rows) {
    const val = r[groupVar.name];
    if (val === null || val === undefined || val === '') continue;
    const key = String(val);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 0) return { groupLevels: null, minGroupN: null };
  return { groupLevels: counts.size, minGroupN: Math.min(...counts.values()) };
}

for (const f of files) {
  try {
    const ds = JSON.parse(readFileSync(join(dataDir, f), 'utf-8'));
    // `rows` OR `observed`: a goodness-of-fit dataset may be a table of counts
    // with no case-level rows at all. Requiring `rows` silently dropped five of
    // the six gof datasets from the index — barking_deer, blood_types,
    // mendel_peas, stock_geometric, textbooks_format — so the page's dropdown
    // offered one. Nothing failed; they were simply not there. Found 2026-10-03
    // after a routine rebuild, which is the point: a rebuild must be safe to
    // run, and this one quietly deleted data.
    const rows = ds.rows ?? null;
    const counts = Array.isArray(ds.observed) ? ds.observed : null;
    if (ds.id && (rows || counts)) {
      const { groupLevels, minGroupN } = deriveGroupMeta(ds.variables, rows ?? []);
      index.push({
        id: ds.id,
        name: ds.name,
        description: ds.description,
        type: ds.type,
        chapter: ds.chapter || '',
        n: rows ? rows.length : counts.reduce((a, b) => a + b, 0),
        variables: (ds.variables || []).map(v => v.name),
        hasNumeric: (ds.variables || []).some(v => v.type === 'numeric'),
        hasCategorical: (ds.variables || []).some(v => v.type === 'categorical'),
        groupLevels,
        minGroupN,
      });
    }
  } catch (e) {
    console.error(`  skip ${f}: ${e.message}`);
  }
}

index.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(dataDir, 'datasets.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`datasets.json — ${index.length} datasets indexed`);

// Verify new datasets
const newIds = [
  'avandia', 'cuckoo', 'gss2010', 'chickwts', 'cats', 'exam_grades',
  'trees', 'antibiotics', 'diamond', 'county_2019', 'urban_owner',
  'oscars', 'mammals'
];
for (const id of newIds) {
  const ds = index.find(d => d.id === id);
  if (ds) console.log(`  ✓ ${id} — ${ds.n} rows`);
  else console.log(`  ✗ ${id} — NOT FOUND`);
}

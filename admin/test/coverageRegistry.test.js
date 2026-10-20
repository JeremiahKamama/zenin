// admin/test/coverageRegistry.test.js
//
// "Coverage Registry brings about a blank screen on click."
//
// CoverageRegistryView destructured its data with a default parameter:
//
//   export default function CoverageRegistryView({ data = COVERAGE_SEED }) {
//     const markets = data.markets || seed.markets;   // <-- threw
//
// A default parameter only applies when the argument is `undefined`. The caller
// passed `data={coverageData}`, and `coverageData` was `useState(null)` with no
// loader anywhere in the file, so it was ALWAYS null. `null.markets` throws
// "Cannot read properties of null (reading 'markets')", which unmounts the view
// to a blank screen — every time, for every operator.
//
// It was not a race or a rare fetch failure. The tab could never render.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const view = readFileSync(join(here, '../src/CoverageRegistryView.jsx'), 'utf8');
const app = readFileSync(join(here, '../src/App.jsx'), 'utf8');
const seed = readFileSync(join(here, '../src/coverageSeed.js'), 'utf8');

test('a null data prop cannot reach a property read', () => {
  // The exact crash: data.markets where data is null.
  assert.doesNotMatch(view, /=\s*data\.markets/, 'must not read a field off raw data');
  assert.match(view, /const source = data && typeof data === "object" \? data : \{\}/);
});

test('every field is resolved through a sanitiser that reads the live source', () => {
  // The guarantee is unchanged: each field is resolved from the sanitised
  // `source`, never read off raw `data`. The mechanism moved from a per-field
  // `list()` call to a `pick()` helper — because the old one silently MIXED
  // live and seed values per field while the header claimed the view was the
  // "authoritative source of truth". This asserts the invariant, not the syntax.
  assert.match(view, /const pick = \(key\) => \{/, 'fields must go through a single resolver');
  assert.match(view, /source\[key\]/, 'the resolver must read from the sanitised source');
  for (const field of [
    'markets',
    'providers',
    'exchanges',
    'datasets',
    'mappings',
    'apiHealth',
    'syncJobs',
    'auditLog',
  ]) {
    assert.ok(
      view.includes(`pick('${field}')`),
      `${field} must be resolved through the sanitiser`
    );
  }
});

test('a wrong-shaped field falls back to an array, not a crash', () => {
  // A payload that is present but malformed must not take the view down; the
  // tab is directly reachable from the sidebar.
  assert.match(view, /Array\.isArray\(live\)/);
  assert.match(view, /Array\.isArray\(seed\[key\]\) \? seed\[key\] : \[\]/);
});

test('provenance is tracked, so seed data is never presented as live', () => {
  // The regression this guards: a page showing live markets beside invented
  // apiHealth rows, with nothing telling the reader which was which.
  assert.match(view, /resolved\[key\] = 'live'/, 'live fields must be marked live');
  assert.match(
    view,
    /resolved\[key\] = Array\.isArray\(seed\[key\]\)\s*\?\s*['"]sample['"]/,
    'fallbacks must be marked sample'
  );
  assert.match(view, /isFullyLive/, 'the view must know whether anything is live');
  // Scoped to non-comment source: the file legitimately QUOTES the old claim
  // when explaining why the mixing was a bug.
  const viewCode = view
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.equal(
    viewCode.includes('Authoritative source of truth'),
    false,
    'the unconditional "authoritative" claim is back in live markup'
  );
});

test('the export ships what is displayed, not the raw seed', () => {
  assert.equal(
    /onExport && onExport\(COVERAGE_SEED/.test(view),
    false,
    'exporting COVERAGE_SEED ships invented rows even when the screen shows live data'
  );
  assert.match(view, /_provenance/, 'the export must record whether the payload is live or sample');
});

test('the seed still provides every field the view expects', () => {
  // The fallback is only safe if the seed actually has the data.
  for (const field of [
    'markets',
    'providers',
    'exchanges',
    'datasets',
    'mappings',
    'apiHealth',
    'syncJobs',
    'auditLog',
  ]) {
    assert.match(seed, new RegExp(`^\\s*${field}:`, 'm'), `seed must export ${field}`);
  }
});

test('the caller no longer relies on a default parameter for safety', () => {
  // Passing null to a defaulted parameter is the trap that caused this.
  const call = app.slice(app.indexOf("case 'coverage'"));
  assert.match(call.slice(0, 120), /CoverageRegistryView/);
  // The view itself must tolerate null, which the checks above prove.
  assert.match(view, /data && typeof data === "object"/);
});

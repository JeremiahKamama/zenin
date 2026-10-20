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

test('every destructured field reads from the sanitised source', () => {
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
      view.includes(`source.${field}`),
      `${field} must be read from the sanitised source`
    );
  }
});

test('a wrong-shaped field falls back to an array, not a crash', () => {
  // A payload that is present but malformed must not take the view down; the
  // tab is directly reachable from the sidebar.
  assert.match(view, /const list = \(value, fallback\)/);
  assert.match(view, /Array\.isArray\(value\) \? value : Array\.isArray\(fallback\) \? fallback : \[\]/);
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

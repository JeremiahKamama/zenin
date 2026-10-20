// admin/test/nativeDialogs.test.js
//
// "Ensure all buttons in the admin app are working as expected."
//
// The console had 20 native browser dialogs: `window.prompt` for reasons and
// names, `window.confirm` for destructive actions. None of them are acceptable
// in a product surface:
//
//  1. They BLOCK. window.prompt freezes the JS thread, so an in-flight request,
//     websocket message or poll timer stalls behind it.
//  2. They are unstylable and render the origin URL, which looks like a
//     browser warning rather than the product.
//  3. They show NO CONTEXT. "Reason for retrying Snowflake:" is the whole
//     prompt — the operator cannot see the integration's last error, so the
//     audit reason they type is uninformed. That defeats the audit trail.
//  4. Safari and Firefox let users suppress further dialogs. After that these
//     calls return null, the action silently does nothing, and the button
//     looks broken — which is exactly the symptom reported.
//
// This pins the elimination and the properties that replaced them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, '../src/App.jsx'), 'utf8');
const promptModal = readFileSync(join(here, '../src/components/ActionPromptModal.jsx'), 'utf8');
const shell = readFileSync(join(here, '../src/components/ModalShell.jsx'), 'utf8');

/** Strip comments so prose about the old behaviour is not counted as code. */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

const appCode = stripComments(app);

test('no native prompt or confirm remains anywhere in the console', () => {
  const remaining = appCode.match(/window\.(prompt|confirm)\s*\(/g) || [];
  assert.equal(remaining.length, 0, `native dialogs still present: ${remaining.join(', ')}`);
});

test('no placeholder toast claims an action that did not happen', () => {
  // A toast reading "Recipient manager opened." that opens nothing is worse
  // than a disabled control — the operator believes work was done.
  const fake = appCode.match(/showPlaceholder\(/g) || [];
  assert.equal(fake.length, 0, `${fake.length} showPlaceholder call(s) remain`);
});

test('the imperative dialog host is mounted once at the root', () => {
  assert.match(app, /<ActionPromptModal/);
  assert.match(app, /open=\{Boolean\(promptSpec\)\}/);
});

test('promptAction resolves a promise so callers can await it', () => {
  // The native prompt returns synchronously, which is why migrating required
  // the call sites to become async. The contract has to stay promise-based.
  assert.match(app, /const promptAction = useCallback\(\(spec\) => \{/);
  assert.match(app, /return new Promise\(\(resolve\) => \{/);
});

test('dismissing resolves null rather than rejecting', () => {
  // Callers guard with `if (!reason) return;`. A rejection would surface as an
  // unhandled error every time someone pressed Escape.
  assert.match(app, /const closePrompt = useCallback\(\(result = null\) => \{/);
  assert.match(app, /if \(resolve\) resolve\(result\)/);
});

test('every migrated reason prompt requires a usable minimum length', () => {
  // A one-character reason is not audit data.
  assert.match(promptModal, /export const REASON_MIN_LENGTH = 10/);
  assert.match(promptModal, /minLength/);
});

test('destructive actions require typed confirmation, not one click', () => {
  assert.match(promptModal, /validateLiteral/);
  // User deletion must not be a single reflexive click.
  assert.match(app, /validateLiteral: 'DELETE'/);
});

test('a reason prompt shows the target it applies to', () => {
  // The core complaint about window.prompt: no context.
  assert.match(shell, /export function ModalContext/);
  assert.match(promptModal, /import \{ ModalShell, ModalContext, ModalActions \}/);
  const contextUses = appCode.match(/context: \[/g) || [];
  assert.ok(contextUses.length >= 8, `only ${contextUses.length} prompts pass context`);
});

test('checkbox fields stay boolean instead of becoming the string "true"', () => {
  // String(true) === "true", which the server would read as truthy text.
  assert.match(promptModal, /if \(field\.type === 'checkbox'\) \{/);
  assert.match(promptModal, /Boolean\(values\[field\.name\]\)/);
});

test('the dialog traps focus and restores it on close', () => {
  assert.match(shell, /if \(event\.key !== 'Tab'\) return/);
  assert.match(shell, /restoreFocusRef/);
});

test('Escape does not cancel a write in flight', () => {
  assert.match(shell, /event\.key === 'Escape' && !busy/);
});

test('only a press that began on the overlay dismisses the dialog', () => {
  // A drag from inside the dialog to outside would otherwise discard typed
  // input, which is a real way to lose a long incident write-up.
  assert.match(shell, /pressedOverlayRef/);
  assert.match(shell, /onPointerDown/);
  assert.match(shell, /onPointerUp/);
});

test('every prompt list is labelled for assistive tech', () => {
  assert.match(shell, /aria-modal="true"/);
  assert.match(shell, /aria-labelledby=\{labelledBy\}/);
  assert.match(promptModal, /role="alert"/);
});

// admin/test/recipientManager.test.js
//
// The "Manage Notification Recipients" button called showPlaceholder, which
// showed a toast reading "Recipient manager opened." and opened nothing. There
// was no recipient concept anywhere: the seven notification toggles had no
// addresses to deliver to, so even with transport wired nothing would be sent.
//
// The manager is the missing half of the feature: who gets notified, for which
// categories, and a real test send so delivery is proven rather than assumed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const modal = readFileSync(join(here, '../src/components/RecipientManagerModal.jsx'), 'utf8');
const app = readFileSync(join(here, '../src/App.jsx'), 'utf8');
const css = readFileSync(join(here, '../src/index.css'), 'utf8');

test('the Settings button opens the real manager', () => {
  assert.match(app, /setRecipientsOpen\(true\)/);
  assert.match(app, /<RecipientManagerModal/);
});

test('the manager is reachable and announced as a dialog', () => {
  assert.match(modal, /labelledBy="recipients-heading"/);
  assert.match(modal, /id="recipients-heading"/);
});

test('an invalid address is rejected before it reaches the API', () => {
  // A bad address would otherwise be stored and silently fail on every send.
  assert.match(modal, /const EMAIL_PATTERN = /);
  assert.match(modal, /if \(!EMAIL_PATTERN\.test\(trimmed\)\)/);
});

test('a recipient must have at least one category', () => {
  // Adding someone with no categories means they never receive anything, which
  // looks like a broken notification system rather than a config mistake.
  assert.match(modal, /if \(!categories\.length\)/);
});

test('emails are normalised to lower case', () => {
  // Otherwise Ops@ and ops@ become two recipients of the same inbox.
  assert.match(modal, /email: trimmed\.toLowerCase\(\)/);
});

test('categories can be toggled per recipient', () => {
  assert.match(modal, /aria-pressed=\{Boolean\(on\)\}/);
  for (const id of ['system', 'security', 'billing', 'summary']) {
    assert.ok(modal.includes(`id: '${id}'`), `${id} must be a real category`);
  }
});

test('recipients can be paused without being deleted', () => {
  assert.match(modal, /onUpdate\?\.\(recipient\.id, \{ isActive: !recipient\.isActive \}\)/);
});

test('the empty state explains the consequence, not just "no data"', () => {
  assert.match(modal, /admin notifications will only be recorded in the/);
});

test('a real test send exists so delivery can be proven', () => {
  assert.match(modal, /onSendTest/);
  assert.match(app, /adminFetch\('\/admin\/notification-recipients\/test'/);
});

test('the test result distinguishes success from total failure', () => {
  assert.match(modal, /Test delivered to \$\{testResult\.sent\} of/);
  assert.match(modal, /Test failed for all/);
});

test('the delivery log is present so past sends are inspectable', () => {
  assert.match(modal, /Recent deliveries/);
  assert.match(modal, /delivery-status--\$\{row\.status\}/);
});

test('a failed delivery surfaces its error rather than hiding it', () => {
  assert.match(modal, /delivery-error/);
  assert.match(modal, /\{row\.error\}/);
});

test('the modal styles exist so it does not render unstyled', () => {
  for (const className of [
    '.recipient-form',
    '.recipient-categories',
    '.recipient-items',
    '.recipient-item',
    '.recipient-chip',
    '.delivery-items',
    '.delivery-status',
    '.delivery-test-result'
  ]) {
    assert.ok(css.includes(className), `${className} must be styled`);
  }
});

// backend/test/unit/adminNotifications.test.js
//
// "Are all notifications wired to deliver emails to admin emails?"
//
// The answer was no, in three separate ways:
//
//   1. The 7 Settings toggles were local React state. Nothing persisted them,
//      nothing read them, and they controlled no delivery.
//   2. `sendAlertEmail` was implemented and exported from email.js, but never
//      imported into index.js — so NO code path could send an admin email.
//   3. Even with transport available, nothing routed an event (incident, failed
//      sign-in) to a recipient, because there was no recipient concept at all
//      and no record of what was delivered.
//
// These tests pin the wiring for each of the three.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, '../..');
const index = readFileSync(join(backendRoot, 'index.js'), 'utf8');
const database = readFileSync(join(backendRoot, 'database.js'), 'utf8');
const email = readFileSync(join(backendRoot, 'email.js'), 'utf8');

test('the alert email transport is actually imported by the server', () => {
  // It was exported and never imported. That single omission made admin
  // notification email impossible regardless of settings.
  assert.match(email, /^\s*sendAlertEmail,?$/m, 'email.js must export it');
  assert.match(index, /sendAlertEmail\s*\n?\} = require\("\.\/email"\)|sendAlertEmail,?\s*\n\s*\}/,
    'index.js must import it');
});

test('settings have real storage instead of React state', () => {
  assert.match(database, /CREATE TABLE IF NOT EXISTS admin_settings/);
  assert.match(database, /getAdminSettings: async/);
  assert.match(database, /saveAdminSettings: async/);
  assert.match(index, /app\.get\("\/api\/admin\/settings", requireAdmin/);
  assert.match(index, /app\.patch\("\/api\/admin\/settings", requireAdmin, requireRecentAdminReauth/);
});

test('recipients are a stored concept, not a placeholder toast', () => {
  assert.match(database, /CREATE TABLE IF NOT EXISTS admin_notification_recipients/);
  assert.match(database, /listAdminNotificationRecipientsForCategory: async/);
  assert.match(index, /app\.post\("\/api\/admin\/notification-recipients", requireAdmin/);
  assert.match(index, /app\.delete\("\/api\/admin\/notification-recipients\/:id", requireAdmin/);
});

test('every delivery is recorded so "did it send?" is answerable', () => {
  // Without this, a silent provider failure is indistinguishable from a
  // notification that was never attempted.
  assert.match(database, /CREATE TABLE IF NOT EXISTS admin_notification_deliveries/);
  assert.match(database, /recordAdminNotificationDelivery: async/);
  assert.match(index, /await admin\.recordAdminNotificationDelivery\(\{/);
});

test('a disabled category actually suppresses delivery', () => {
  // The setting has to gate the send, or the toggle is decorative again.
  assert.match(index, /ADMIN_NOTIFICATION_CATEGORY_KEYS/);
  assert.match(index, /if \(!settings\.emailAlerts\) \{/);
  assert.match(index, /if \(gateKey && settings\[gateKey\] === false\)/);
});

test('an incident raises a notification', () => {
  assert.match(index, /eventType: "incident_created"/);
  assert.match(index, /void dispatchAdminNotification\(\{/);
});

test('repeated failed admin sign-ins alert the operators', () => {
  // The highest-value security signal the console produces.
  assert.match(index, /eventType: "admin_login_locked"/);
  assert.match(index, /ADMIN_LOGIN_MAX_ATTEMPTS/);
});

test('a notification failure never fails the request that triggered it', () => {
  // The incident is already recorded; email is best-effort.
  assert.match(index, /void dispatchAdminNotification\([\s\S]{0,600}?\.catch\(/);
});

test('the master switch beats the per-category switch', () => {
  // Turning off emailAlerts must silence everything without the admin having
  // to remember which categories were individually enabled.
  const masterAt = index.indexOf('if (!settings.emailAlerts)');
  const gateAt = index.indexOf('if (gateKey && settings[gateKey] === false)');
  assert.ok(masterAt > -1 && gateAt > -1 && masterAt < gateAt,
    'the master switch must be evaluated first');
});

test('a test send reports the gate state so success is not misleading', () => {
  // A passing test proves transport works, not that notifications are on.
  assert.match(index, /emailAlertsEnabled: settings\.emailAlerts !== false/);
  assert.match(index, /deliveryConfigured: isEmailDeliveryProductionReady\(\)/);
});

test('settings changes are audited like any other admin action', () => {
  // Turning off failed-login alerts changes what operators will notice.
  assert.match(index, /action: "UPDATE_ADMIN_SETTINGS"/);
  assert.match(index, /action: "ADD_NOTIFICATION_RECIPIENT"/);
  assert.match(index, /action: "REMOVE_NOTIFICATION_RECIPIENT"/);
});

test('a settings read failure cannot break the notifying path', () => {
  // An incident must still be created even if settings are unreadable.
  assert.match(index, /async function readAdminNotificationSettings\(\) \{[\s\S]{0,400}?catch \(error\)/);
  assert.match(index, /return \{ \.\.\.ADMIN_SETTINGS_DEFAULTS \};/);
});

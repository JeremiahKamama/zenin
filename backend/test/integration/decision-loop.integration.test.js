const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '4110';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
process.env.EXPECTED_ORIGIN = process.env.EXPECTED_ORIGIN || process.env.FRONTEND_URL;

const BASE_URL = `http://127.0.0.1:${process.env.PORT}`;
const { startServer, stopServer } = require('../../index');

let serverReady = false;
let serverStartError = null;

async function requestJson(path, { method = 'GET', token = null, body = null } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body != null) headers['content-type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { res, data };
}

function uniqueEmail(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}.${Date.now()}.${rand}@zenin.test`;
}

test.before(async () => {
  try {
    await startServer();
    serverReady = true;
  } catch (error) {
    serverStartError = error;
  }
});

test.after(async () => {
  if (serverReady) {
    await stopServer();
  }
});

test('decision thread lifecycle: create -> link research -> mark reviewed -> outcomes', async (t) => {
  if (!serverReady) {
    t.skip(`Server did not start for integration tests: ${serverStartError?.message || 'unknown error'}`);
    return;
  }

  const user = await requestJson('/api/auth/signup', {
    method: 'POST',
    body: { email: uniqueEmail('decision'), password: 'Decision#Pass123', displayName: 'Decision User' }
  });
  assert.equal(user.res.status, 201);
  const token = user.data.token;

  const create = await requestJson('/api/decision-threads', {
    method: 'POST',
    token,
    body: { title: 'Integration test decision', symbol: 'TST', priority: 'high', sourceType: 'manual' }
  });
  assert.equal(create.res.status, 201);
  assert.ok(create.data.thread?.id);
  const threadId = create.data.thread.id;

  const link = await requestJson(`/api/decision-threads/${threadId}/link-research`, {
    method: 'POST',
    token,
    body: { researchId: 'research-doc-123' }
  });
  assert.equal(link.res.status, 200);
  assert.equal(link.data.thread?.linkedResearchId, 'research-doc-123');
  assert.equal(link.data.thread?.status, 'researching');

  const review = await requestJson(`/api/decision-threads/${threadId}/mark-reviewed`, {
    method: 'POST',
    token,
    body: { result: 'win', pnl: 1234.56, lesson: 'Test lesson', mistakeTag: 'entry timing' }
  });
  assert.equal(review.res.status, 200);
  assert.equal(review.data.thread?.status, 'reviewed');
  assert.equal(review.data.thread?.outcome?.result, 'win');
  assert.equal(review.data.thread?.outcome?.pnl, 1234.56);

  const outcomes = await requestJson('/api/decision-threads/outcomes?result=win', { token });
  assert.equal(outcomes.res.status, 200);
  assert.ok(Array.isArray(outcomes.data.items));
  assert.ok(outcomes.data.items.some((item) => String(item.id) === String(threadId)));
  assert.equal(outcomes.data.aggregated?.winCount >= 1, true);
});

test('daily briefing generate returns sections and metrics', async (t) => {
  if (!serverReady) {
    t.skip(`Server did not start for integration tests: ${serverStartError?.message || 'unknown error'}`);
    return;
  }

  const user = await requestJson('/api/auth/signup', {
    method: 'POST',
    body: { email: uniqueEmail('briefing'), password: 'Briefing#Pass123', displayName: 'Briefing User' }
  });
  assert.equal(user.res.status, 201);
  const token = user.data.token;

  const generate = await requestJson('/api/daily-briefing/generate', {
    method: 'POST',
    token
  });
  assert.equal(generate.res.status, 200);
  assert.ok(generate.data.briefing?.id);
  assert.ok(Array.isArray(generate.data.briefing?.sections));
  assert.ok(generate.data.briefing?.metrics);
  assert.ok(typeof generate.data.briefing?.summary === 'string');

  const get = await requestJson('/api/daily-briefing', { token });
  assert.equal(get.res.status, 200);
  assert.equal(get.data.briefing?.id, generate.data.briefing.id);
});

test('provider trust build returns nested structure for exchange key lifecycle', async (t) => {
  if (!serverReady) {
    t.skip(`Server did not start for integration tests: ${serverStartError?.message || 'unknown error'}`);
    return;
  }

  const user = await requestJson('/api/auth/signup', {
    method: 'POST',
    body: { email: uniqueEmail('provider'), password: 'Provider#Pass123', displayName: 'Provider User' }
  });
  assert.equal(user.res.status, 201);
  const token = user.data.token;

  const create = await requestJson('/api/db/exchange-keys', {
    method: 'POST',
    token,
    body: {
      exchange: 'hyperliquid',
      apiKey: '0xTestAddress',
      apiSecret: '',
      label: 'Test read-only'
    }
  });
  assert.equal(create.res.status, 201);
  assert.ok(create.data.key?.id);
  assert.ok(create.data.key?.providerTrust);
  assert.equal(create.data.key.providerTrust?.status, 'verified_watch_only');
  assert.equal(create.data.key.providerTrust?.canTrade, false);

  const list = await requestJson('/api/db/exchange-keys', { token });
  assert.equal(list.res.status, 200);
  assert.ok(Array.isArray(list.data.keys));
  const found = (list.data.keys || []).find((k) => String(k.id) === String(create.data.key.id));
  assert.ok(found);
  assert.ok(found.providerTrust);
});

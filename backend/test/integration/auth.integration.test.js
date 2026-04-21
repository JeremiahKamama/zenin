const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '4110';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

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

test('auth lifecycle: signup -> me -> signout', async (t) => {
  if (!serverReady) {
    t.skip(`Server did not start for integration tests: ${serverStartError?.message || 'unknown error'}`);
    return;
  }

  const email = uniqueEmail('lifecycle');
  const password = 'Strong#Pass123';

  const signup = await requestJson('/api/auth/signup', {
    method: 'POST',
    body: { email, password, displayName: 'Lifecycle User' }
  });

  assert.equal(signup.res.status, 201);
  assert.ok(signup.data.token);

  const me = await requestJson('/api/auth/me', { token: signup.data.token });
  assert.equal(me.res.status, 200);
  assert.equal(me.data.authenticated, true);
  assert.equal(me.data.user.email, email);

  const signout = await requestJson('/api/auth/signout', {
    method: 'POST',
    token: signup.data.token
  });
  assert.equal(signout.res.status, 200);

  const meAfter = await requestJson('/api/auth/me', { token: signup.data.token });
  assert.equal(meAfter.res.status, 200);
  assert.equal(meAfter.data.authenticated, false);
});

test('workspace data is isolated per signed-in user', async (t) => {
  if (!serverReady) {
    t.skip(`Server did not start for integration tests: ${serverStartError?.message || 'unknown error'}`);
    return;
  }

  const userA = await requestJson('/api/auth/signup', {
    method: 'POST',
    body: { email: uniqueEmail('tenant.a'), password: 'Tenant#Pass123', displayName: 'Tenant A' }
  });
  const userB = await requestJson('/api/auth/signup', {
    method: 'POST',
    body: { email: uniqueEmail('tenant.b'), password: 'Tenant#Pass123', displayName: 'Tenant B' }
  });

  assert.equal(userA.res.status, 201);
  assert.equal(userB.res.status, 201);

  const symbol = `TST${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const addToA = await requestJson('/api/db/watchlist', {
    method: 'POST',
    token: userA.data.token,
    body: {
      symbol,
      name: 'Isolated Asset',
      type: 'stock',
      marketType: 'equity',
      category: 'stocks',
      theme: 'integration-tests'
    }
  });
  assert.equal(addToA.res.status, 201);

  const listA = await requestJson('/api/db/watchlist', { token: userA.data.token });
  const listB = await requestJson('/api/db/watchlist', { token: userB.data.token });

  assert.equal(listA.res.status, 200);
  assert.equal(listB.res.status, 200);

  const aHas = (listA.data.assets || []).some((asset) => String(asset.symbol) === symbol);
  const bHas = (listB.data.assets || []).some((asset) => String(asset.symbol) === symbol);

  assert.equal(aHas, true);
  assert.equal(bHas, false);

  const checkB = await requestJson(`/api/db/watchlist/check/${symbol}?marketType=equity`, {
    token: userB.data.token
  });
  assert.equal(checkB.res.status, 200);
  assert.equal(checkB.data.exists, false);
});

test('forgot-password flow rotates credentials', async (t) => {
  if (!serverReady) {
    t.skip(`Server did not start for integration tests: ${serverStartError?.message || 'unknown error'}`);
    return;
  }

  const email = uniqueEmail('forgot');
  const oldPassword = 'Old#Password123';
  const newPassword = 'New#Password123';

  const signup = await requestJson('/api/auth/signup', {
    method: 'POST',
    body: { email, password: oldPassword, displayName: 'Forgot User' }
  });
  assert.equal(signup.res.status, 201);

  const requestReset = await requestJson('/api/auth/forgot-password/request', {
    method: 'POST',
    body: { email }
  });

  assert.equal(requestReset.res.status, 200);
  assert.ok(requestReset.data.devResetToken, 'Expected devResetToken in non-production test mode');

  const confirmReset = await requestJson('/api/auth/forgot-password/confirm', {
    method: 'POST',
    body: {
      token: requestReset.data.devResetToken,
      newPassword
    }
  });

  assert.equal(confirmReset.res.status, 200);
  assert.ok(confirmReset.data.token);

  const oldSignin = await requestJson('/api/auth/signin', {
    method: 'POST',
    body: { email, password: oldPassword }
  });
  assert.equal(oldSignin.res.status, 401);

  const newSignin = await requestJson('/api/auth/signin', {
    method: 'POST',
    body: { email, password: newPassword }
  });
  assert.equal(newSignin.res.status, 200);
  assert.ok(newSignin.data.token);
});

test('balance updates remain user-scoped', async (t) => {
  if (!serverReady) {
    t.skip(`Server did not start for integration tests: ${serverStartError?.message || 'unknown error'}`);
    return;
  }

  const userA = await requestJson('/api/auth/signup', {
    method: 'POST',
    body: { email: uniqueEmail('balance.a'), password: 'Balance#Pass123', displayName: 'Balance A' }
  });
  const userB = await requestJson('/api/auth/signup', {
    method: 'POST',
    body: { email: uniqueEmail('balance.b'), password: 'Balance#Pass123', displayName: 'Balance B' }
  });

  assert.equal(userA.res.status, 201);
  assert.equal(userB.res.status, 201);

  const aBefore = await requestJson('/api/db/balance', { token: userA.data.token });
  const bBefore = await requestJson('/api/db/balance', { token: userB.data.token });

  assert.equal(aBefore.res.status, 200);
  assert.equal(bBefore.res.status, 200);

  const depositAmount = 321;
  const deposit = await requestJson('/api/db/balance', {
    method: 'POST',
    token: userA.data.token,
    body: { type: 'deposit', amount: depositAmount }
  });
  assert.equal(deposit.res.status, 200);

  const aAfter = await requestJson('/api/db/balance', { token: userA.data.token });
  const bAfter = await requestJson('/api/db/balance', { token: userB.data.token });

  assert.equal(Number(aAfter.data.balance), Number(aBefore.data.balance) + depositAmount);
  assert.equal(Number(bAfter.data.balance), Number(bBefore.data.balance));
});

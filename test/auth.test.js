import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import handler from '../api/index.js';
import { loginSession, session } from '../lib/auth.js';
import { createRequest, saveAnalysis } from '../lib/storage.js';

process.env.AUTH_SECRET = 'test-secret-with-at-least-32-characters';
process.env.ADMIN_LOGIN = 'test-admin';
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.USER_LOGIN = `test-user-${crypto.randomUUID()}`;
process.env.USER_PASSWORD = 'test-user-password';
process.env.USER_NAME = 'Олена Коваленко';
const credentials = role => ({ role, login: process.env[`${role.toUpperCase()}_LOGIN`], password: process.env[`${role.toUpperCase()}_PASSWORD`] });
const cookie = token => `support_session=${token}`;

test('admin Gemini analysis is routed and persisted without exposing keys', async () => {
  const originalFetch = globalThis.fetch, originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'gemini-private-test-key';
  const { token } = loginSession(credentials('admin'));
  const item = await createRequest(crypto.randomUUID(), 'User', 'Help');
  const analysis = { priority: 'низький', category: 'інше', summary: 'Потрібна допомога.', draftReply: 'Уточніть запит.' };
  try {
    const health = await call('/api/health', 'GET', undefined, token);
    assert.ok(health.body.providers.find(p => p.id === 'gemini').configured);
    assert.ok(!JSON.stringify(health).includes(process.env.GEMINI_API_KEY));
    globalThis.fetch = async url => {
      assert.ok(url.startsWith('https://generativelanguage.googleapis.com/'));
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }] }) };
    };
    const response = await call(`/api/requests/${item.id}/analyze`, 'POST', { provider: 'gemini' }, token);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.request.analysis, analysis);
    const list = await call('/api/requests', 'GET', undefined, token);
    assert.deepEqual(list.body.requests.find(r => r.id === item.id).analysis, analysis);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  }
});
async function call(url, method = 'GET', data, token, extraHeaders = {}) {
  const req = Readable.from(data === undefined ? [] : [JSON.stringify(data)]);
  Object.assign(req, { url, method, headers: { cookie: token ? cookie(token) : '', ...extraHeaders } });
  const result = { headers: {} };
  const res = { setHeader(name, value) { result.headers[name] = value; }, writeHead(status, headers) { result.status = status; Object.assign(result.headers, headers); }, end(value) { result.body = JSON.parse(value); } };
  await handler(req, res);
  return result;
}

test('author comes from the session; spoofed names and malformed requests cannot create records', async () => {
  const { token, user } = loginSession(credentials('user'));
  assert.equal(user.name, 'Олена Коваленко');
  assert.equal((await call('/api/auth/me', 'GET', undefined, token)).body.user.name, user.name);
  for (const customerName of ['Петро Миколаєнко', 'admin', '', ' ', null, 123, {}, [], `${user.name} `]) {
    const before = (await call('/api/requests', 'GET', undefined, token)).body.requests.length;
    const response = await call('/api/requests', 'POST', { customerName, message: 'Help' }, token);
    assert.equal(response.status, 403, JSON.stringify(customerName));
    assert.equal((await call('/api/requests', 'GET', undefined, token)).body.requests.length, before);
  }
  for (const input of [null, [], 'text', 42, {}, { message: '' }, { message: '   ' }, { message: 42 }, { message: 'x'.repeat(5001) }]) {
    assert.equal((await call('/api/requests', 'POST', input, token)).status, 400);
  }
  for (const input of [{ message: '  Моє звернення  ' }, { customerName: user.name, message: 'Help' }, { message: 'Help', role: 'admin', name: 'Fake', user: { name: 'Fake' }, workspaceId: crypto.randomUUID() }]) {
    const response = await call('/api/requests', 'POST', input, token);
    assert.equal(response.status, 201);
    assert.equal(response.body.request.customerName, user.name);
    assert.equal(response.body.request.workspaceId, user.workspaceId);
    assert.equal(response.body.request.message, input.message.trim());
    const list = await call('/api/requests', 'GET', undefined, token);
    assert.equal(list.body.requests.find(item => item.id === response.body.request.id).customerName, user.name);
  }
});

test('server name changes apply to existing sessions; missing name falls back to login', async () => {
  const original = process.env.USER_NAME;
  const { token, user } = loginSession(credentials('user'));
  try {
    process.env.USER_NAME = 'Нове ім’я';
    assert.equal((await call('/api/requests', 'POST', { customerName: user.name, message: 'Old tab' }, token)).status, 403);
    const updated = await call('/api/requests', 'POST', { message: 'Help' }, token);
    assert.equal(updated.body.request.customerName, 'Нове ім’я');
    assert.equal(updated.body.request.workspaceId, user.workspaceId);
    delete process.env.USER_NAME;
    assert.equal((await call('/api/requests', 'POST', { message: 'Help' }, token)).body.request.customerName, user.login);
    for (const invalid of ['   ', 'x'.repeat(121)]) {
      process.env.USER_NAME = invalid;
      assert.throws(() => loginSession(credentials('user')), { status: 503 });
      assert.equal((await call('/api/requests', 'POST', { message: 'Help' }, token)).status, 401);
    }
  } finally { process.env.USER_NAME = original; }
});

test('administrator cannot create requests, even by spoofing the role or workspace', async () => {
  const { token } = loginSession(credentials('admin'));
  const before = (await call('/api/requests', 'GET', undefined, token)).body.requests;
  for (const input of [{ customerName: 'Петро', message: 'Help' }, { message: 'Help' }, { role: 'user', workspaceId: crypto.randomUUID(), customerName: 'Петро', message: 'Help' }, null]) {
    assert.equal((await call('/api/requests', 'POST', input, token, { 'x-workspace-id': crypto.randomUUID() })).status, 403);
  }
  assert.deepEqual((await call('/api/requests', 'GET', undefined, token)).body.requests, before);
});

test('separate login validates credentials and sets a protected cookie; logout clears it', async () => {
  assert.equal((await call('/api/auth/login', 'POST', { ...credentials('user'), role: 'admin' })).status, 401);
  assert.equal((await call('/api/auth/login', 'POST', null)).status, 401);
  for (const role of ['admin', 'user']) {
    const result = await call('/api/auth/login', 'POST', credentials(role));
    assert.equal(result.status, 200);
    assert.equal(result.body.user.role, role);
    assert.match(result.headers['Set-Cookie'], /HttpOnly; SameSite=Strict/);
  }
  assert.match((await call('/api/auth/logout', 'POST')).headers['Set-Cookie'], /Max-Age=0/);
});

test('tampered and expired sessions are rejected', () => {
  const { token } = loginSession(credentials('user'));
  assert.equal(session({ headers: { cookie: cookie(token) } }).role, 'user');
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), role: 'admin' })).toString('base64url');
  assert.equal(session({ headers: { cookie: cookie(`${forged}.${signature}`) } }), null);
  const expired = Buffer.from(JSON.stringify({ role: 'user', login: process.env.USER_LOGIN, expires: Date.now() - 1 })).toString('base64url');
  const signed = createHmac('sha256', process.env.AUTH_SECRET + process.env.USER_PASSWORD).update(expired).digest('base64url');
  assert.equal(session({ headers: { cookie: cookie(`${expired}.${signed}`) } }), null);
});

test('API enforces ownership and admin-only analysis, including forged workspace headers', async () => {
  const user = loginSession(credentials('user')), admin = loginSession(credentials('admin'));
  assert.equal((await call('/api/requests')).status, 401);
  assert.equal((await call('/api/requests', 'POST', { customerName: 'Test', message: 'Test' })).status, 401);
  const otherWorkspace = crypto.randomUUID();
  const other = await createRequest(otherWorkspace, 'Other', 'Private');
  const created = await call('/api/requests', 'POST', { message: 'Help' }, user.token, { 'x-workspace-id': otherWorkspace });
  assert.equal(created.status, 201);
  assert.equal(created.body.request.workspaceId, user.user.workspaceId);
  await saveAnalysis(user.user.workspaceId, created.body.request.id, { draftReply: 'Internal draft' });
  const own = await call('/api/requests', 'GET', undefined, user.token, { 'x-workspace-id': otherWorkspace });
  assert.ok(own.body.requests.every(item => item.workspaceId === user.user.workspaceId && item.analysis === null));
  assert.equal((await call(`/api/requests/${other.id}/analyze`, 'POST', {}, user.token)).status, 403);
  const all = await call('/api/requests', 'GET', undefined, admin.token);
  assert.ok(all.body.requests.some(item => item.id === other.id));
  assert.ok(all.body.requests.some(item => item.id === created.body.request.id && item.analysis.draftReply === 'Internal draft'));
  assert.equal((await call(`/api/requests/${crypto.randomUUID()}/analyze`, 'POST', {}, admin.token)).status, 404);
  assert.equal((await call('/api/auth/logout', 'POST', {}, user.token, { 'sec-fetch-site': 'cross-site' })).status, 403);
});

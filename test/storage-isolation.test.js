import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequest, getRequest, listRequests, saveAnalysis } from '../lib/storage.js';

test('test storage never touches the working database or Supabase, even with deployment settings', async () => {
  const path = new URL('../.data/support.sqlite', import.meta.url);
  const before = existsSync(path) ? readFileSync(path) : null;
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'];
  const previous = keys.map(key => process.env[key]);
  const originalFetch = globalThis.fetch;
  try {
    process.env.SUPABASE_URL = 'https://test.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
    process.env.VERCEL = '1';
    globalThis.fetch = () => { assert.fail('Tests must not access remote storage'); };
    assert.deepEqual(await listRequests(null), []);
    const workspace = crypto.randomUUID();
    const item = await createRequest(workspace, 'Isolation test', 'Memory only');
    await saveAnalysis(workspace, item.id, { summary: 'Test' });
    assert.equal((await getRequest(workspace, item.id)).analysis.summary, 'Test');
    assert.equal((await listRequests(null)).length, 1);
    assert.deepEqual(existsSync(path) ? readFileSync(path) : null, before);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});

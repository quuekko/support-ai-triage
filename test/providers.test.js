import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRequest, aiConfig } from '../lib/analysis.js';

const sample = { priority: 'низький', category: 'інше', summary: 'Клієнт просить допомоги.', draftReply: 'Уточніть ваш запит.' };
test('provider selection, Gemini schema and responses, and failure handling', async () => {
  const keys = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_PROVIDER', 'GEMINI_MODEL'];
  const previous = keys.map(key => process.env[key]);
  const originalFetch = globalThis.fetch;
  try {
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.OPENAI_API_KEY = 'openai-test';
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_MODEL = 'gemini-3.1-flash-lite';
    assert.equal(aiConfig().defaultProvider, 'gemini');
    assert.ok(aiConfig().providers.every(p => p.configured));
    for (const provider of ['gemini', 'openai', 'anthropic']) {
      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        if (provider === 'gemini') {
          assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent');
          assert.equal(options.headers['x-goog-api-key'], 'gemini-test');
          assert.equal(options.headers.Authorization, undefined);
          assert.equal(body.generationConfig.responseMimeType, 'application/json');
          assert.equal(body.generationConfig.maxOutputTokens, 1024);
          assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
          assert.ok(body.generationConfig.responseSchema.required.includes('draftReply'));
          assert.equal(JSON.parse(body.contents[0].parts[0].text).customerName, 'User');
        } else {
          assert.ok(url.includes(provider === 'openai' ? 'api.openai.com' : 'api.anthropic.com'));
        }
        const content = JSON.stringify(sample);
        return { ok: true, json: async () => provider === 'gemini' ? { candidates: [{ content: { parts: [{ thought: true, text: 'Not output' }, { text: content.slice(0, 20) }, { text: content.slice(20) }] } }] } : provider === 'openai' ? { choices: [{ message: { content } }] } : { content: [{ type: 'text', text: content }] } };
      };
      assert.deepEqual(await analyzeRequest('User', 'Help', undefined, provider), sample);
    }
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return calls < 3 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(sample) }] } }] }) };
    };
    assert.deepEqual(await analyzeRequest('User', 'Help'), sample);
    assert.equal(calls, 3);
    calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: false, status: 503 }; };
    await assert.rejects(analyzeRequest('User', 'Help'), { status: 503, message: /Gemini тимчасово перевантажений/ });
    assert.equal(calls, 3);
    calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded' } }) }; };
    await assert.rejects(analyzeRequest('User', 'Help'), { status: 502 });
    assert.equal(calls, 1);
    for (const data of [{}, { candidates: [{ content: { parts: [{ text: 'invalid JSON' }] } }] }, { candidates: [{ content: { parts: [{ text: JSON.stringify({ ...sample, priority: 'invalid' }) }] } }] }]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => data });
      await assert.rejects(analyzeRequest('User', 'Help'), { status: 502 });
    }
    globalThis.fetch = async () => assert.fail('Must not call a provider');
    await assert.rejects(analyzeRequest('User', 'Help', undefined, 'unknown'), { status: 400 });
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(analyzeRequest('User', 'Help', 'sk-openai-override', 'gemini'), { status: 503 });
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});

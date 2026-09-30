import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysis } from '../lib/analysis.js';
import { createRequest, getRequest, listRequests, saveAnalysis } from '../lib/storage.js';

const sample = { priority: 'високий', category: 'оплата', summary: 'Клієнт повідомляє про подвійне списання.', draftReply: 'Вітаємо! Уточніть, будь ласка, дату та суму списання.' };

test('structured analysis accepts valid fields and rejects invalid fields', () => {
  assert.deepEqual(validateAnalysis(sample), sample);
  assert.throws(() => validateAnalysis({ ...sample, priority: 'критичний' }));
  assert.throws(() => validateAnalysis({ ...sample, summary: 'Два\nречення' }));
});

test('requests persist, remain isolated by workspace, and retain analysis', async () => {
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const item = await createRequest(first, 'Олена', 'Двічі списали кошти');
  assert.equal((await listRequests(first)).length, 1);
  assert.equal((await listRequests(second)).length, 0);
  assert.equal(await getRequest(second, item.id), null);
  const updated = await saveAnalysis(first, item.id, sample);
  assert.deepEqual(updated.analysis, sample);
  assert.deepEqual((await getRequest(first, item.id)).analysis, sample);
});

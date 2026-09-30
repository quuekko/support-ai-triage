import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/<script type="module">([\s\S]*?)<\/script>/)[1];

// Exercise the page's real handlers with a small DOM substitute, without a browser dependency.
for (const role of ['user', 'admin']) {
  test(`${role} form submits the correct author and remains usable after reset`, async () => {
    const nodes = new Map();
    const node = key => {
      if (!nodes.has(key)) nodes.set(key, {
        value: '', defaultValue: '', readOnly: false, handlers: {}, style: {},
        addEventListener(type, handler) { this.handlers[type] = handler; },
        append() {}, closest() { return node('details'); }, remove() {},
        reset() { node('customer').value = node('customer').defaultValue; node('message').value = ''; }
      });
      return nodes.get(key);
    };
    const user = { role, name: 'Олена Коваленко', login: 'olena' };
    const posted = [];
    const context = {
      document: { getElementById: node, querySelector: node, createElement: () => node(Symbol()), head: node('head'), body: node('body') },
      location: { pathname: role === 'admin' ? '/admin' : '/', replace() { assert.fail('Unexpected redirect'); } },
      setTimeout() {},
      async fetch(path, options) {
        let data;
        if (path === '/api/auth/me') data = { user };
        else if (path === '/api/health') data = { aiConfigured: true };
        else if (options.method === 'POST') {
          const input = JSON.parse(options.body); posted.push(input);
          data = { request: { id: String(posted.length), customerName: input.customerName || user.name, message: input.message, createdAt: new Date().toISOString(), analysis: null } };
        } else data = { requests: [] };
        return { ok: true, status: 200, json: async () => data };
      }
    };
    await new vm.Script(script).runInNewContext(context);
    if (role === 'user') {
      assert.equal(node('customer').readOnly, true);
      assert.equal(node('customer').value, user.name);
      assert.equal(node('label[for="customer"]').textContent, 'Ваше ім’я');
    } else {
      assert.equal(node('.form-card').hidden, true);
      assert.equal(node('aside').hidden, true);
      assert.equal(node('.layout').style.gridTemplateColumns, '1fr');
      node('message').value = 'Help';
      await node('new-form').handlers.submit({ preventDefault() {} });
      assert.equal(posted.length, 0);
      node('ai-provider').value = 'gemini';
      node('api-key').value = 'sk-must-not-send-to-gemini';
      const button = { dataset: { id: 'example' } };
      await node('items').handlers.click({ target: { closest: () => button } });
      assert.equal(posted[0].provider, 'gemini');
      assert.equal(Object.hasOwn(posted[0], 'apiKey'), false);
      return;
    }
    for (let i = 0; i < 2; i++) {
      node('customer').value = 'Підставлене ім’я';
      node('message').value = 'Допоможіть';
      await node('new-form').handlers.submit({ preventDefault() {} });
      assert.equal(posted.length, i + 1);
      assert.equal(posted[i].message, 'Допоможіть');
      if (role === 'user') {
        assert.equal(Object.hasOwn(posted[i], 'customerName'), false);
        assert.equal(node('customer').value, user.name);
      } else assert.equal(posted[i].customerName, 'Підставлене ім’я');
      assert.equal(node('message').value, '');
      assert.equal(node('add-button').disabled, false);
    }
  });
}

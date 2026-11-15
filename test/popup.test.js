import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../extension/popup/index.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup({ installed = true, send } = {}) {
  const elements = new Map();
  const timers = new Map();
  const messages = [];
  let sequence = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, disabled: false,
      textContent: '', handlers: {}, setAttribute() {},
      addEventListener(type, callback) { this.handlers[type] = callback; } });
    return elements.get(id);
  };
  element('start');
  element('enable');
  const browser = {
    runtime: { sendMessage: async message => {
      messages.push(message);
      return send ? send(message) : { party: null, connection: 'idle', error: '' };
    } },
    storage: { local: { get: async () => ({ server: 'ws://localhost:8787' }) } },
    tabs: { query: async () => [{ id: 7 }] },
  };
  vm.runInContext(source, vm.createContext({ ...(installed ? { browser } : {}),
    document: { getElementById: element, querySelectorAll: () => [element('start'), element('enable')] },
    setInterval() {},
    setTimeout(callback, ms) { const id = ++sequence; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  }));
  return { element, timers, messages };
}

test('opening the popup as a webpage shows instructions instead of crashing', () => {
  const app = setup({ installed: false });
  assert.equal(app.element('error').hidden, false);
  assert.match(app.element('error').textContent, /installed browser extension/);
  assert.equal(app.element('start').disabled, true);
});

test('Safari popup sends Join using browser APIs and surfaces relay errors', async () => {
  const app = setup({ send: message => message.type === 'ui-start'
    ? { error: 'Party not found. Check the code and relay address.' }
    : { party: null, connection: 'idle', error: '' } });
  await flush();
  app.element('join-tab').handlers.click();
  app.element('code').value = 'ABCD2345';
  await app.element('party-form').handlers.submit({ preventDefault() {} });
  const request = app.messages.find(message => message.type === 'ui-start');
  assert.equal(request.action, 'join');
  assert.equal(request.code, 'ABCD2345');
  assert.equal(request.tabId, 7);
  assert.match(app.element('error').textContent, /Party not found/);
  assert.equal(app.element('start').disabled, false);
});

test('missing background replies show an actionable error', async () => {
  const app = setup({ send: () => undefined });
  await flush();
  assert.equal(app.element('error').hidden, false);
  assert.match(app.element('error').textContent, /could not respond/);
});

test('Join times out visibly and releases its button if the background stalls', async () => {
  const app = setup({ send: message => message.type === 'ui-start'
    ? new Promise(() => {}) : { party: null, connection: 'idle', error: '' } });
  await flush();
  app.element('join-tab').handlers.click();
  app.element('code').value = 'ABCD2345';
  const submitted = app.element('party-form').handlers.submit({ preventDefault() {} });
  await flush();
  assert.equal(app.element('start').disabled, true);
  const timeout = [...app.timers.values()].find(timer => timer.ms === 15000);
  assert.ok(timeout);
  timeout.callback();
  await submitted;
  assert.equal(app.element('error').hidden, false);
  assert.match(app.element('error').textContent, /not responding/);
  assert.equal(app.element('start').disabled, false);
});

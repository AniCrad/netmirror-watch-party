import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackground } from '../extension/background/controller.js';
const extensionUrl = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
async function setup(saved = null, { sessionStorage = true, origin = extensionUrl, navigationFrames = [] } = {}) {
  const listeners = {};
  const deliveries = [];
  const injections = [];
  const persisted = { party: saved };
  const timers = new Map();
  let sequence = 0;
  class Socket {
    static OPEN = 1;
    static instances = [];
    readyState = 0;
    messages = [];
    constructor(url) { this.url = url; Socket.instances.push(this); }
    send(raw) { this.messages.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen(); }
    async receive(value) { await this.onmessage({ data: JSON.stringify(value) }); }
  }
  const chrome = {
    storage: {
      session: { get: async () => ({ party: persisted.party }),
        set: async value => { Object.assign(persisted, value); },
        remove: async key => { delete persisted[key]; } },
      local: { set: async () => {} },
    },
    runtime: { getURL: path => origin + path, onMessage: { addListener: callback => { listeners.message = callback; } } },
    tabs: {
      get: async id => ({ id, url: 'https://net77.cc/watch/test' }),
      sendMessage: async (tabId, message, target) => { deliveries.push({ tabId, message, ...target }); },
      onRemoved: { addListener: callback => { listeners.removed = callback; } },
    },
    webNavigation: { getAllFrames: async () => navigationFrames, onCommitted: { addListener() {} }, onCompleted: { addListener() {} } },
    permissions: { contains: async () => true }, scripting: { executeScript: async request => { injections.push(request); } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
  };
  if (!sessionStorage) delete chrome.storage.session;
  createBackground(chrome, { WebSocket: Socket,
    setTimeout: (callback, ms) => { const id = ++sequence; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const call = (message, sender = { url: origin + 'popup/index.html' }) =>
    new Promise(resolve => listeners.message(message, sender, resolve));
  await call({ type: 'ui-status' });
  return { call, Socket, persisted, deliveries, timers, listeners, injections };
}
const initial = { type: 'ui-start', tabId: 7, action: 'create', server: 'ws://localhost:8787' };
const welcome = { type: 'welcome', code: 'ABCD2345', token: 'secret-token', role: 'host', state: null, serverTime: Date.now() };

test('background creates a room, persists credentials and only forwards the selected host frame', async () => {
  const app = await setup();
  assert.equal((await app.call(initial)).ok, true);
  const ws = app.Socket.instances[0];
  ws.open();
  assert.equal(ws.messages[0].type, 'create');
  await ws.receive(welcome);
  assert.equal(app.persisted.party.token, 'secret-token');
  assert.equal((await app.call({ type: 'ui-status' })).connection, 'connected');
  const sender = { tab: { id: 7 }, frameId: 2 };
  await app.call({ type: 'video-report', score: 1000, video: { duration: 100 } }, sender);
  const state = { position: 20, paused: false, rate: 1, duration: 100 };
  await app.call({ type: 'video-state', state }, { tab: { id: 99 }, frameId: 2 });
  await app.call({ type: 'video-state', state }, { tab: { id: 7 }, frameId: 3 });
  assert.equal(ws.messages.filter(message => message.type === 'state').length, 0);
  await app.call({ type: 'video-state', state }, sender);
  assert.equal(ws.messages.filter(message => message.type === 'state').length, 1);
  await app.call({ type: 'ui-leave' });
  assert.equal(ws.messages.at(-1).type, 'leave');
  assert.equal(app.persisted.party, undefined);
  assert.ok(app.deliveries.some(entry => entry.frameId === 2 && entry.message.active === false));
});

test('guest receives cached state when a player appears and never forwards controls', async () => {
  const app = await setup();
  await app.call({ ...initial, action: 'join', code: 'ABCD2345' });
  const ws = app.Socket.instances[0];
  ws.open();
  const state = { position: 80, paused: true, rate: 1, duration: 100, updatedAt: Date.now() };
  await ws.receive({ ...welcome, role: 'guest', state });
  const sender = { tab: { id: 7 }, frameId: 4 };
  await app.call({ type: 'video-report', score: 100, video: { duration: 100 } }, sender);
  assert.ok(app.deliveries.some(entry => entry.frameId === 4 && entry.message.type === 'party-state' && entry.message.state.position === 80));
  await app.call({ type: 'video-state', state }, sender);
  assert.equal(ws.messages.filter(message => message.type === 'state').length, 0);
});

test('worker restoration resumes with token and heartbeat timeout starts reconnect', async () => {
  const app = await setup({ tabId: 7, code: 'ABCD2345', token: 'secret-token', role: 'host', server: initial.server });
  const ws = app.Socket.instances[0];
  ws.open();
  assert.equal(ws.messages[0].type, 'resume');
  assert.equal(ws.messages[0].token, 'secret-token');
  await ws.receive(welcome);
  const heartbeat = [...app.timers.values()].find(timer => timer.ms === 35000);
  assert.ok(heartbeat);
  heartbeat.callback();
  assert.equal((await app.call({ type: 'ui-status' })).connection, 'reconnecting');
  const retry = [...app.timers.values()].find(timer => timer.ms === 1000);
  retry.callback();
  const reconnected = app.Socket.instances[1];
  reconnected.open();
  assert.equal(reconnected.messages[0].type, 'resume');
});

test('content scripts cannot run popup operations and malformed relay addresses are rejected', async () => {
  const app = await setup();
  await app.call(initial, { tab: { id: 7 }, frameId: 0, url: 'https://net77.cc/' });
  assert.equal(app.Socket.instances.length, 0);
  const result = await app.call({ ...initial, server: 'https://example.com' });
  assert.match(result.error, /relay address/);
  assert.equal(app.Socket.instances.length, 0);
});


test('background joins without session storage and reconnects in memory', async () => {
  const app = await setup(null, { sessionStorage: false,
    origin: 'safari-web-extension://abcdef01-2345-6789-abcd-ef0123456789/' });
  assert.equal((await app.call({ ...initial, action: 'join', code: 'ABCD2345' })).ok, true);
  const ws = app.Socket.instances[0];
  ws.open();
  assert.equal(ws.messages[0].type, 'join');
  await ws.receive({ ...welcome, role: 'guest' });
  assert.equal((await app.call({ type: 'ui-status' })).connection, 'connected');
  assert.equal(app.persisted.party, null);
  ws.close();
  [...app.timers.values()].find(timer => timer.ms === 1000).callback();
  const resumed = app.Socket.instances[1];
  resumed.open();
  assert.equal(resumed.messages[0].type, 'resume');
  assert.equal(resumed.messages[0].token, welcome.token);
  await app.call({ type: 'ui-leave' });
  assert.equal((await app.call({ type: 'ui-status' })).party, null);
});


test('joining injects the reorganized player entrypoint into permitted frames', async () => {
  const app = await setup(null, { navigationFrames: [{ frameId: 2, url: 'https://net77.cc/player' }] });
  assert.equal((await app.call(initial)).ok, true);
  assert.deepEqual(app.injections[0], { target: { tabId: 7, frameIds: [2] }, files: ['content/index.js'] });
});

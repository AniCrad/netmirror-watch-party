import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRelay } from '../server/relay.js';
import { projectedPosition } from '../server/protocol.js';

async function fixture(t, options) {
  const relay = createRelay(options);
  t.after(() => relay.close());
  relay.server.listen(0, '127.0.0.1');
  await once(relay.server, 'listening');
  const address = `ws://127.0.0.1:${relay.server.address().port}`;
  async function client(origin) {
    const ws = new WebSocket(address, origin ? { origin } : {});
    const queue = [];
    const pending = [];
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      const index = pending.findIndex(waiter => waiter.type === message.type);
      if (index < 0) queue.push(message);
      else pending.splice(index, 1)[0].resolve(message);
    });
    await once(ws, 'open');
    return { ws,
      send: value => ws.send(JSON.stringify(value)),
      wait(type) {
        const index = queue.findIndex(message => message.type === type);
        if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2000);
          pending.push({ type, resolve(value) { clearTimeout(timer); resolve(value); } });
        });
      },
    };
  }
  return { relay, client, address };
}
const playback = { position: 120, paused: false, rate: 1.25, duration: 3600 };

test('projects playback using rate, pause state, and duration bounds', () => {
  assert.equal(projectedPosition({ ...playback, updatedAt: 1000 }, 3000), 122.5);
  assert.equal(projectedPosition({ ...playback, paused: true, updatedAt: 1000 }, 3000), 120);
  assert.equal(projectedPosition({ ...playback, position: 3599, updatedAt: 1000 }, 9000), 3600);
});

test('host updates reach guests; late guests receive the latest state', async t => {
  const { client } = await fixture(t);
  const host = await client();
  host.send({ type: 'create' });
  const welcome = await host.wait('welcome');
  assert.match(welcome.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(welcome.role, 'host');
  host.send({ type: 'state', state: playback });
  const state = (await host.wait('state')).state;
  assert.equal(state.position, 120);
  assert.ok(state.updatedAt > 0);
  const guest = await client();
  guest.send({ type: 'join', code: welcome.code });
  const joined = await guest.wait('welcome');
  assert.equal(joined.role, 'guest');
  assert.deepEqual(joined.state, state);
  assert.equal((await guest.wait('presence')).members, 2);
  host.send({ type: 'state', state: { ...playback, position: 740, paused: true, rate: 2 } });
  const updated = (await guest.wait('state')).state;
  assert.equal(updated.position, 740);
  assert.equal(updated.paused, true);
  assert.equal(updated.rate, 2);
});

test('guests cannot publish; invalid states and unknown rooms are rejected', async t => {
  const { client, relay } = await fixture(t);
  const host = await client();
  host.send({ type: 'create' });
  const { code } = await host.wait('welcome');
  const guest = await client();
  guest.send({ type: 'join', code });
  await guest.wait('welcome');
  guest.send({ type: 'state', state: playback });
  assert.match((await guest.wait('error')).message, /Only the host/);
  host.send({ type: 'state', state: { ...playback, rate: -2 } });
  assert.match((await host.wait('error')).message, /Invalid playback/);
  assert.equal(relay.rooms.get(code).state, null);
  const stranger = await client();
  stranger.send({ type: 'join', code: 'ZZZZZZZZ' });
  assert.match((await stranger.wait('error')).message, /not found/);
  stranger.ws.send('{bad');
  assert.match((await stranger.wait('error')).message, /Invalid JSON/);
});

test('host disconnect pauses guests and a token resumes the same room', async t => {
  const { client } = await fixture(t);
  const host = await client();
  host.send({ type: 'create' });
  const welcome = await host.wait('welcome');
  const guest = await client();
  guest.send({ type: 'join', code: welcome.code });
  await guest.wait('welcome');
  await guest.wait('presence');
  host.send({ type: 'state', state: playback });
  await guest.wait('state');
  host.ws.close();
  const paused = (await guest.wait('state')).state;
  assert.equal(paused.paused, true);
  assert.ok(paused.position >= playback.position);
  assert.equal((await guest.wait('presence')).hostOnline, false);
  const resumed = await client();
  resumed.send({ type: 'resume', code: welcome.code, token: welcome.token });
  assert.equal((await resumed.wait('welcome')).role, 'host');
  assert.equal((await guest.wait('presence')).hostOnline, true);
  resumed.send({ type: 'state', state: playback });
  assert.equal((await guest.wait('state')).state.paused, false);
  const duplicate = await client();
  duplicate.send({ type: 'resume', code: welcome.code, token: welcome.token });
  assert.match((await duplicate.wait('error')).message, /already connected/);
});

test('leaving as host ends the room for everyone', async t => {
  const { client, relay } = await fixture(t);
  const host = await client();
  host.send({ type: 'create' });
  const { code } = await host.wait('welcome');
  const guest = await client();
  guest.send({ type: 'join', code });
  await guest.wait('welcome');
  host.send({ type: 'leave' });
  assert.match((await guest.wait('ended')).message, /host ended/);
  assert.equal(relay.rooms.size, 0);
});

test('host reconnect grace expires and frees room resources', async t => {
  const { client, relay } = await fixture(t, { graceMs: 30 });
  const host = await client();
  host.send({ type: 'create' });
  const { code } = await host.wait('welcome');
  const guest = await client();
  guest.send({ type: 'join', code });
  await guest.wait('welcome');
  host.ws.close();
  assert.match((await guest.wait('ended')).message, /host disconnected/);
  assert.equal(relay.rooms.size, 0);
});

test('health endpoint works and website WebSocket origins are refused', async t => {
  const { address } = await fixture(t);
  const response = await fetch(address.replace('ws:', 'http:') + '/health');
  assert.deepEqual(await response.json(), { status: 'ok', rooms: 0 });
  const ws = new WebSocket(address, { origin: 'https://unrelated.example' });
  const error = await new Promise(resolve => ws.on('error', resolve));
  assert.match(error.message, /403/);
});


test('Safari extension guests join Chromium hosts and receive playback', async t => {
  const { client } = await fixture(t);
  const host = await client('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  host.send({ type: 'create' });
  const { code } = await host.wait('welcome');
  const guest = await client('safari-web-extension://ABCDEF01-2345-6789-ABCD-EF0123456789');
  guest.send({ type: 'join', code });
  assert.equal((await guest.wait('welcome')).role, 'guest');
  host.send({ type: 'state', state: playback });
  assert.equal((await guest.wait('state')).state.position, playback.position);
});

test('lookalike extension origins and opaque origins remain refused', async t => {
  const { address } = await fixture(t);
  for (const origin of [
    'null',
    'safari-web-extension://not-an-extension-id',
    'https://safari-web-extension.example',
    'safari-web-extension://abcdef01-2345-6789-abcd-ef0123456789.evil.example',
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.evil.example',
  ]) {
    const ws = new WebSocket(address, { origin });
    const error = await new Promise(resolve => ws.on('error', resolve));
    assert.match(error.message, /403/, origin);
  }
});


test('configured room and member limits reject excess admissions and free capacity on leave', async t => {
  const { client } = await fixture(t, { maxRooms: 1, maxMembers: 2 });
  const host = await client();
  host.send({ type: 'create' });
  const { code } = await host.wait('welcome');
  const guest = await client();
  guest.send({ type: 'join', code });
  await guest.wait('welcome');
  const extra = await client();
  extra.send({ type: 'create' });
  assert.match((await extra.wait('error')).message, /Relay is full/);
  extra.send({ type: 'join', code });
  assert.match((await extra.wait('error')).message, /2 people maximum/);
  const left = once(guest.ws, 'close');
  guest.send({ type: 'leave' });
  await left;
  extra.send({ type: 'join', code });
  assert.equal((await extra.wait('welcome')).role, 'guest');
});

test('HTTP routes support health probes and reject unknown paths and methods', async t => {
  const { address } = await fixture(t);
  const base = address.replace('ws:', 'http:');
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(base + '/missing')).status, 404);
  const head = await fetch(base + '/health', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await fetch(base + '/health', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('shutdown closes active sockets, clears rooms, and can be called repeatedly', async t => {
  const { relay, client } = await fixture(t);
  const host = await client();
  host.send({ type: 'create' });
  await host.wait('welcome');
  const closed = once(host.ws, 'close');
  const first = relay.close();
  assert.equal(first, relay.close());
  await first;
  await closed;
  assert.equal(relay.server.listening, false);
  assert.equal(relay.rooms.size, 0);
  await relay.close();
});


test('malformed room codes and resume tokens cannot crash the relay', async t => {
  const { client, address } = await fixture(t);
  const attacker = await client();
  for (const code of [{ toString: null }, { toString: 'broken' }, null, [], 123, false, 'bad', '__proto__']) {
    for (const type of ['join', 'resume']) {
      attacker.send({ type, code, token: 'a'.repeat(32) });
      assert.match((await attacker.wait('error')).message, /Invalid/);
    }
  }
  for (const token of [null, {}, [], 123, 'short']) {
    attacker.send({ type: 'resume', code: 'ABCD2345', token });
    assert.match((await attacker.wait('error')).message, /Invalid session/);
  }
  attacker.send({ type: 'ping', sentAt: { nested: 'payload' } });
  assert.match((await attacker.wait('error')).message, /Invalid ping/);
  const host = await client();
  host.send({ type: 'create' });
  const { code } = await host.wait('welcome');
  attacker.send({ type: 'resume', code, token: 'a'.repeat(32) });
  assert.match((await attacker.wait('error')).message, /expired/);
  const guest = await client();
  guest.send({ type: 'join', code });
  assert.equal((await guest.wait('welcome')).role, 'guest');
  assert.equal((await fetch(address.replace('ws:', 'http:') + '/health')).status, 200);
});

test('connection cap rejects excess sockets while health checks remain available', async t => {
  const { client, address } = await fixture(t, { maxConnections: 1 });
  const first = await client();
  const extra = new WebSocket(address);
  const error = await new Promise(resolve => extra.on('error', resolve));
  assert.match(error.message, /503/);
  assert.equal((await fetch(address.replace('ws:', 'http:') + '/health')).status, 200);
  const closed = once(first.ws, 'close');
  first.ws.close();
  await closed;
  const replacement = await client();
  replacement.send({ type: 'create' });
  assert.equal((await replacement.wait('welcome')).role, 'host');
});

test('oversized messages and excessive message rates close only the offending connection', async t => {
  const { client } = await fixture(t);
  const oversized = await client();
  const oversizedClosed = once(oversized.ws, 'close');
  oversized.ws.send('x'.repeat(9000));
  assert.equal((await oversizedClosed)[0], 1009);
  const flooding = await client();
  const floodClosed = once(flooding.ws, 'close');
  for (let i = 0; i < 101; i++) flooding.send({ type: 'ping', sentAt: Date.now() });
  assert.equal((await floodClosed)[0], 1008);
  const host = await client();
  host.send({ type: 'create' });
  assert.equal((await host.wait('welcome')).role, 'host');
});

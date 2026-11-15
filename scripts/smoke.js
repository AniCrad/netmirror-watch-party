import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

// Exercise a running deployment using real host/guest WebSocket connections.
const address = process.argv[2] || 'ws://127.0.0.1:8787';
const sockets = [];
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(address, {
      origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      handshakeTimeout: 5000,
    });
    sockets.push(ws);
    ws.once('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
function waitFor(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${type}`)), 5000);
    const onMessage = raw => {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch (error) { finish(error); return; }
      if (message.type === 'error') finish(new Error(message.message));
      else if (message.type === type) finish(null, message);
    };
    const onClose = () => finish(new Error(`Connection closed while waiting for ${type}`));
    function finish(error, value) {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('close', onClose);
      if (error) reject(error); else resolve(value);
    }
    ws.on('message', onMessage);
    ws.once('close', onClose);
  });
}
try {
  const health = new URL(address);
  health.protocol = health.protocol === 'wss:' ? 'https:' : 'http:';
  health.pathname = '/health';
  const response = await fetch(health, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  const host = await connect();
  const created = waitFor(host, 'welcome');
  host.send(JSON.stringify({ type: 'create' }));
  const { code } = await created;
  const guest = await connect();
  const joined = waitFor(guest, 'welcome');
  guest.send(JSON.stringify({ type: 'join', code }));
  assert.equal((await joined).role, 'guest');
  const received = waitFor(guest, 'state');
  host.send(JSON.stringify({ type: 'state', state: { position: 42, paused: true, rate: 1, duration: 100 } }));
  assert.equal((await received).state.position, 42);
  const ended = waitFor(guest, 'ended');
  host.send(JSON.stringify({ type: 'leave' }));
  await ended;
  console.log('Health, room creation, joining, playback sync, and room cleanup passed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const ws of sockets) ws.terminate();
}

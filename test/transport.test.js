import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { send, MAX_BUFFERED_BYTES } from '../server/transport.js';

function peer(bufferedAmount = 0) {
  return { readyState: WebSocket.OPEN, bufferedAmount, messages: [], terminated: false,
    send(data, callback) { this.messages.push(JSON.parse(data)); callback(); },
    terminate() { this.terminated = true; this.readyState = WebSocket.CLOSED; },
  };
}

test('backpressure disconnects slow peers without queueing more broadcasts', () => {
  const slow = peer(MAX_BUFFERED_BYTES);
  const healthy = peer();
  send(slow, { type: 'heartbeat' });
  send(healthy, { type: 'heartbeat' });
  assert.equal(slow.terminated, true);
  assert.equal(slow.messages.length, 0);
  assert.deepEqual(healthy.messages, [{ type: 'heartbeat' }]);
  assert.equal(healthy.terminated, false);
});

test('closed sockets are ignored and failed writes terminate their peer', () => {
  const closed = peer();
  closed.readyState = WebSocket.CLOSED;
  send(closed, { type: 'heartbeat' });
  assert.equal(closed.messages.length, 0);
  const broken = peer();
  broken.send = (_data, callback) => callback(new Error('Connection lost'));
  send(broken, { type: 'heartbeat' });
  assert.equal(broken.terminated, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../server/config.js';

test('native defaults bind locally and deployment settings override them', () => {
  assert.deepEqual(readConfig({}), { host: '127.0.0.1', port: 8787, maxRooms: 1000, maxMembers: 16, maxConnections: 2000 });
  assert.deepEqual(readConfig({ HOST: '0.0.0.0', PORT: '9090', MAX_ROOMS: '25', MAX_MEMBERS: '4', MAX_CONNECTIONS: '50' }),
    { host: '0.0.0.0', port: 9090, maxRooms: 25, maxMembers: 4, maxConnections: 50 });
});

test('invalid deployment values fail before opening a listener', () => {
  for (const port of ['0', '-1', '65536', '1.5', 'abc', ' ', '1e3', '0x10']) {
    assert.throws(() => readConfig({ PORT: port }), /PORT must be an integer/, port);
  }
  for (const [name, value] of [['MAX_ROOMS', '0'], ['MAX_ROOMS', '100001'], ['MAX_MEMBERS', '101'], ['MAX_CONNECTIONS', '0'], ['MAX_CONNECTIONS', '100001']]) {
    assert.throws(() => readConfig({ [name]: value }), new RegExp(name));
  }
});

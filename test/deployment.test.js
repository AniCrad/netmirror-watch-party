import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRelay } from '../server/relay.js';
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('deployment health and smoke commands exercise a running relay and clean up their room', async t => {
  const relay = createRelay();
  t.after(() => relay.close());
  relay.server.listen(0, '127.0.0.1');
  await once(relay.server, 'listening');
  const port = relay.server.address().port;
  await execute(process.execPath, ['scripts/healthcheck.js'], {
    cwd: root, env: { ...process.env, PORT: String(port) }, timeout: 10000,
  });
  const result = await execute(process.execPath, ['scripts/smoke.js', `ws://127.0.0.1:${port}`], {
    cwd: root, timeout: 15000,
  });
  assert.match(result.stdout, /playback sync, and room cleanup passed/);
  assert.equal(relay.rooms.size, 0);
  await relay.close();
  await assert.rejects(execute(process.execPath, ['scripts/healthcheck.js'], {
    cwd: root, env: { ...process.env, PORT: String(port) }, timeout: 10000,
  }), error => error.code === 1);
});

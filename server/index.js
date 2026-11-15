import { createRelay } from './relay.js';
import { readConfig } from './config.js';

try {
  const { host, port, ...limits } = readConfig();
  const relay = createRelay(limits);
  let stopping = false;
  async function shutdown(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    process.exitCode = exitCode;
    await relay.close();
  }
  relay.server.on('error', error => {
    console.error(error.message);
    void shutdown(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { void shutdown(); });
  }
  relay.server.listen(port, host, () => console.log(`NetMirror relay listening on ${host}:${port}`));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

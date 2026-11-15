import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) check(path);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const directory of ['server', 'extension', 'scripts', 'test']) check(join(root, directory));
const manifest = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'));
for (const path of [manifest.background.service_worker, manifest.action.default_popup,
  ...manifest.content_scripts.flatMap(script => script.js)]) {
  if (!existsSync(join(root, 'extension', path))) throw new Error(`Missing extension entrypoint: ${path}`);
}
const popupPath = join(root, 'extension', manifest.action.default_popup);
const popupHtml = readFileSync(popupPath, 'utf8');
for (const [, asset] of popupHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (!existsSync(resolve(dirname(popupPath), asset))) throw new Error(`Missing popup asset: ${asset}`);
}
console.log('JavaScript syntax and extension entrypoints checked.');

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronVersion = require('electron/package.json').version;
const npmCliPath = process.env.npm_execpath;

if (!npmCliPath) {
  console.error('npm_execpath is unavailable; run this command through npm.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  npmCliPath,
  'rebuild',
  'better-sqlite3',
  '--runtime=electron',
  `--target=${electronVersion}`,
  '--dist-url=https://electronjs.org/headers',
], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);

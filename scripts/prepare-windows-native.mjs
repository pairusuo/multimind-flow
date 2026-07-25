import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertWindowsX64Pe } from './native-binary-format.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronVersion = require('electron/package.json').version;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const result = spawnSync(
  npmCommand,
  [
    'rebuild',
    'better-sqlite3',
    '--runtime=electron',
    `--target=${electronVersion}`,
    '--dist-url=https://electronjs.org/headers',
    '--platform=win32',
    '--arch=x64',
  ],
  {
    cwd: root,
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const binaryPath = path.join(
  root,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);
assertWindowsX64Pe(binaryPath, 'Prepared better-sqlite3 module');
console.log('Prepared Windows x64 better-sqlite3 module.');

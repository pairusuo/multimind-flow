import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertWindowsX64Pe } from './native-binary-format.mjs';

const require = createRequire(import.meta.url);
const { listPackage } = require('@electron/asar');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resourcesDir = path.join(root, 'release', 'win-unpacked', 'resources');
const nativeModulePath = path.join(
  resourcesDir,
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);

assertWindowsX64Pe(nativeModulePath, 'Packaged better-sqlite3 module');

const asarPath = path.join(resourcesDir, 'app.asar');
const packagedFiles = new Set(listPackage(asarPath));
for (const requiredFile of ['/dist/main/index.js', '/dist/renderer/index.html']) {
  if (!packagedFiles.has(requiredFile)) {
    throw new Error(`Windows app.asar is missing required startup file: ${requiredFile}`);
  }
}

const installerPrefix = 'MultiMind-Flow-Setup-';
const installerExists = fs
  .readdirSync(path.join(root, 'release'))
  .some((name) => name.startsWith(installerPrefix) && name.endsWith('.exe'));
if (!installerExists) {
  throw new Error('Windows NSIS installer was not generated.');
}

console.log('Windows package startup artifacts verified.');

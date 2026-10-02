import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const builderConfig = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const windowsPackageScript = fs.readFileSync(path.join(root, 'scripts', 'package-windows.mjs'), 'utf8');

const workflowRules = [
  'workflow_dispatch:',
  'contents: write',
  'npm audit --registry=https://registry.npmjs.org --audit-level=high',
  'npm test',
  'npm run package:mac',
  'npm run package:win',
  'gh release create',
  'gh release upload',
  'GH_REPO: ${{ github.repository }}',
  '--verify-tag',
  'SHA256SUMS.txt',
  'retention-days: 1',
];

for (const rule of workflowRules) {
  assert.ok(workflow.includes(rule), `Missing release workflow rule: ${rule}`);
}

assert.ok(!/^  push:/m.test(workflow), 'Tag pushes must not rebuild locally verified release packages.');

assert.equal(
  workflow.match(/retention-days: 1/g)?.length,
  2,
  'Both platform build artifacts must expire after one day.',
);

assert.ok(
  builderConfig.includes('artifactName: MultiMind-Flow-${version}-${arch}.${ext}'),
  'macOS release artifact must have a stable upload-safe name.',
);
assert.ok(
  builderConfig.includes('artifactName: MultiMind-Flow-Setup-${version}.${ext}'),
  'Windows release artifact must have a stable upload-safe name.',
);
assert.ok(
  builderConfig.includes('!node_modules/better-sqlite3/build/Release/test_extension.node'),
  'The unused better-sqlite3 native test fixture must not enter Universal builds.',
);
assert.ok(
  packageJson.scripts['package:mac'].includes('--publish never'),
  'macOS packaging must finish local validation before publishing.',
);
assert.ok(
  windowsPackageScript.includes("'--publish', 'never'"),
  'Windows packaging must finish local validation before publishing.',
);

console.log('GitHub Actions release workflow policy test passed.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const builderConfig = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');

const workflowRules = [
  'tags:',
  "- 'v*.*.*'",
  'workflow_dispatch:',
  'contents: write',
  'npm audit --registry=https://registry.npmjs.org --audit-level=high',
  'npm test',
  'npm run package:mac',
  'npm run package:win',
  'gh release create',
  'gh release upload',
  '--verify-tag',
  'SHA256SUMS.txt',
];

for (const rule of workflowRules) {
  assert.ok(workflow.includes(rule), `Missing release workflow rule: ${rule}`);
}

assert.ok(
  builderConfig.includes('artifactName: MultiMind-Flow-${version}-${arch}.${ext}'),
  'macOS release artifact must have a stable upload-safe name.',
);
assert.ok(
  builderConfig.includes('artifactName: MultiMind-Flow-Setup-${version}.${ext}'),
  'Windows release artifact must have a stable upload-safe name.',
);

console.log('GitHub Actions release workflow policy test passed.');

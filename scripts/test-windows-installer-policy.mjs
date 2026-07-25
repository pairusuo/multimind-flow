import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builderConfig = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const installerScript = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const requiredConfigRules = [
  'appId: com.multimind.browser',
  'signAndEditExecutable: true',
  'oneClick: false',
  'perMachine: false',
  'allowElevation: true',
  'allowToChangeInstallationDirectory: true',
  'include: build/installer.nsh',
  'deleteAppDataOnUninstall: false',
  'createDesktopShortcut: always',
];

for (const rule of requiredConfigRules) {
  assert.ok(builderConfig.includes(rule), `Missing Windows installer rule: ${rule}`);
}

const requiredInstallerRules = [
  '!macro customInstallMode',
  '$hasPerMachineInstallation == "1"',
  '!macro customCheckAppRunning',
  '"MultiMind.exe"',
  '"MultiMind Browser.exe"',
  '!macro customUnInstallCheck',
  '!macro customUnInstallCheckCurrentUser',
  '"$multimindLegacyInstallDir\\resources\\app.asar"',
  'DeleteRegKey ${REGISTRY_ROOT} "${UNINSTALL_REGISTRY_KEY}"',
  'RMDir /r /REBOOTOK "$INSTDIR"',
];

for (const rule of requiredInstallerRules) {
  assert.ok(installerScript.includes(rule), `Missing Windows uninstall safeguard: ${rule}`);
}

assert.equal(
  packageJson.scripts['package:win'],
  'node scripts/package-windows.mjs',
  'Windows packaging must prepare and verify the platform-specific native module.',
);

console.log('Windows installer policy test passed.');

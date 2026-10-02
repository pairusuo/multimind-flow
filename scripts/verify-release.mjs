import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { extractFile } = require('@electron/asar');
const yaml = require('js-yaml');
const plist = require('plist');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = yaml.load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, config.directories.output);
const macApp = path.join(release, 'mac-universal', `${config.productName}.app`, 'Contents');
const macInfo = plist.parse(fs.readFileSync(path.join(macApp, 'Info.plist'), 'utf8'));
assert.equal(macInfo.CFBundleShortVersionString, version, 'Mac bundle version differs from release version');

for (const [platform, archive] of [
  ['Mac', path.join(macApp, 'Resources', 'app.asar')],
  ['Windows', path.join(release, 'win-unpacked', 'resources', 'app.asar')],
]) {
  const pkg = JSON.parse(extractFile(archive, 'package.json').toString());
  assert.equal(pkg.version, version, `${platform} packaged application version differs from release version`);
}

for (const [platform, arch, ext, metadataName] of [
  ['mac', 'universal', 'dmg', 'latest-mac.yml'],
  ['win', 'x64', 'exe', 'latest.yml'],
]) {
  const name = config[platform].artifactName.replaceAll('${version}', version).replaceAll('${arch}', arch).replaceAll('${ext}', ext);
  const binary = path.join(release, name);
  const metadata = yaml.load(fs.readFileSync(path.join(release, metadataName), 'utf8'));
  assert.equal(metadata.version, version, `${platform} update metadata version differs from release version`);
  assert.equal(metadata.path, name, `${platform} update metadata points to a different installer`);
  const entry = metadata.files.find(file => file.url === name);
  assert.ok(entry, `${platform} installer is missing from update metadata`);
  assert.equal(fs.statSync(binary).size, entry.size, `${platform} installer size differs from update metadata`);
  const hash = createHash('sha512');
  for await (const chunk of fs.createReadStream(binary)) hash.update(chunk);
  const digest = hash.digest('base64');
  assert.equal(entry.sha512, digest, `${platform} installer hash differs from update metadata`);
  assert.equal(metadata.sha512, digest, `${platform} legacy update hash differs from installer`);
  assert.ok(fs.statSync(`${binary}.blockmap`).size > 0, `${platform} blockmap is missing`);
}

console.log(`Mac and Windows ${version}: packaged versions, installer names, sizes and update checksums verified.`);

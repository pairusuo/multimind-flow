import fs from 'node:fs';
import path from 'node:path';

const buildTarget = process.env.BUILD_TARGET === 'win' ? 'win' : 'mac';
const userAgents = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const builderConfig = fs.readFileSync('electron-builder.yml', 'utf8');
const owner = builderConfig.match(/^  owner: (.+)$/m)?.[1]?.trim();
const repo = builderConfig.match(/^  repo: (.+)$/m)?.[1]?.trim();
if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new Error('Missing GitHub publish configuration');
const outputPath = path.join(process.cwd(), 'dist/main/constants.js');
const output = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHROME_USER_AGENT = exports.BUILD_TARGET = void 0;
exports.BUILD_TARGET = ${JSON.stringify(buildTarget)};
exports.UPDATE_REPOSITORY = ${JSON.stringify(`${owner}/${repo}`)};
exports.CHROME_USER_AGENT = ${JSON.stringify(userAgents[buildTarget])};
`;

fs.writeFileSync(outputPath, output);

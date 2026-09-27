import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCliPath = process.env.npm_execpath;
const electronBuilderCliPath = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
const buildEnvironment = { ...process.env, BUILD_TARGET: 'win' };
let exitCode = 0;

if (!npmCliPath) {
  console.error('npm_execpath is unavailable; run this command through npm.');
  process.exit(1);
}

try {
  run(process.execPath, [npmCliPath, 'run', 'generate-icons'], buildEnvironment);
  run(process.execPath, [npmCliPath, 'run', 'build'], buildEnvironment);
  run(process.execPath, ['scripts/prepare-windows-native.mjs'], buildEnvironment);
  run(
    process.execPath,
    [electronBuilderCliPath, '--win', '--x64', '--config.npmRebuild=false', '--publish', 'never'],
    buildEnvironment,
  );
  run(process.execPath, ['scripts/verify-windows-package.mjs'], buildEnvironment);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  if (process.platform !== 'win32') {
    const restore = spawnSync(process.execPath, [npmCliPath, 'run', 'rebuild:native'], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    if (restore.error || restore.status !== 0) {
      console.error('Failed to restore the host better-sqlite3 module after Windows packaging.');
      exitCode = 1;
    }
  }
}

process.exit(exitCode);

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}

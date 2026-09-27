import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(join(tmpdir(), 'multimind-view-test-'));
try {
  await build({ entryPoints: ['scripts/fixtures/conversation-view.jsx'], bundle: true, loader: { '.svg': 'dataurl', '.png': 'dataurl' }, jsx: 'automatic', outfile: join(scratch, 'fixture.js'), define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
  await writeFile(join(scratch, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  await writeFile(join(scratch, 'runner.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(scratch, 'profile'))});
app.whenReady().then(async () => {
  const window = new BrowserWindow({show: Boolean(process.env.CONVERSATION_SCREENSHOT), width: 1100, height: 800, webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true}});
  const timeout = setTimeout(() => { console.error('Renderer test timeout'); app.exit(1); }, 20000);
  try {
    await window.loadFile(${JSON.stringify(join(scratch, 'index.html'))});
    console.log(await window.webContents.executeJavaScript('window.runConversationViewTests().catch(error => { throw new Error(error.stack || error.message); })'));
    window.setSize(390, 844);
    console.log(await window.webContents.executeJavaScript('window.runBotLayoutTests()'));
    if (process.env.CONVERSATION_SCREENSHOT) { window.setSize(1280, 850); await window.webContents.executeJavaScript('window.showGroupPreview()'); }
    if (process.env.CONVERSATION_SCREENSHOT) await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    if (process.env.CONVERSATION_SCREENSHOT) require('node:fs').writeFileSync(process.env.CONVERSATION_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});
`);
  const env = { ...process.env };
  if (process.argv[2]) env.CONVERSATION_SCREENSHOT = resolve(process.argv[2]);
  delete env.ELECTRON_RUN_AS_NODE;
  const status = await new Promise((resolveStatus, reject) => {
    const child = spawn(require('electron'), [join(scratch, 'runner.cjs')], { cwd: resolve('.'), env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolveStatus(code ?? 1));
  });
  process.exitCode = status;
} finally { await rm(scratch, { recursive: true, force: true }); }

import { app, BrowserWindow, nativeImage } from 'electron';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ApiConversationService } from './apiConversationService';
import { registerIpcHandlers } from './ipcHandlers';
import { MemoryStore } from './memoryStore';
import { createBrowserStore, WindowManager } from './windowManager';

let mainWindow: BrowserWindow | null = null;
let windowManager: WindowManager | null = null;
let memoryStore: MemoryStore | null = null;
let apiConversationService: ApiConversationService | null = null;

configureAppIdentity();
bindProcessExceptionHandlers();

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: 'MultiMind Flow',
    icon: getWindowIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  bindRendererDiagnostics(mainWindow);

  const store = await createBrowserStore();
  memoryStore = memoryStore ?? new MemoryStore(path.join(app.getPath('userData'), 'memory.sqlite'));
  apiConversationService = apiConversationService ?? new ApiConversationService(store);
  windowManager = new WindowManager(mainWindow, store);
  registerIpcHandlers(windowManager, memoryStore, apiConversationService);

  mainWindow.on('resize', () => windowManager?.layout());
  mainWindow.on('close', () => {
    windowManager?.dispose();
  });
  mainWindow.on('closed', () => {
    windowManager?.dispose();
    windowManager = null;
    mainWindow = null;
  });
  if (!app.isPackaged) {
    await loadDevRenderer(mainWindow);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  windowManager.createInitialView();
  scheduleDevCapture(mainWindow);
}

function bindRendererDiagnostics(window: BrowserWindow): void {
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('Renderer failed to load:', { errorCode, errorDescription, url: validatedURL });
  });

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.warn('Renderer console:', { level, message, line, sourceId });
    }
  });
}

app.whenReady().then(() => {
  startWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      startWindow();
    }
  });
});

function startWindow(): void {
  void createWindow().catch((error) => {
    console.error('Failed to start MultiMind Flow:', error);
    void showStartupFailure(mainWindow, error);
  });
}

async function showStartupFailure(window: BrowserWindow | null, error: unknown): Promise<void> {
  if (!window || window.isDestroyed()) {
    return;
  }

  const detail = escapeHtml(error instanceof Error ? error.message : String(error));
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MultiMind Flow 启动失败</title>
    <style>
      body { margin: 0; background: #f8fafc; color: #0f172a; font: 16px/1.6 system-ui, sans-serif; }
      main { max-width: 680px; margin: 12vh auto; padding: 32px; }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 8px 0; color: #475569; }
      details { margin-top: 24px; padding: 12px 16px; border: 1px solid #cbd5e1; border-radius: 8px; }
      code { overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <main>
      <h1>MultiMind Flow 未能正常启动</h1>
      <p>请关闭应用后重新打开。如果问题持续存在，请重新安装最新版本。</p>
      <p>MultiMind Flow could not start. Close the app and try again, or reinstall the latest version.</p>
      <details>
        <summary>错误详情 / Error details</summary>
        <code>${detail}</code>
      </details>
    </main>
  </body>
</html>`;

  try {
    await window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
  } catch (loadError) {
    console.error('Failed to show startup error page:', loadError);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.on('before-quit', () => {
  windowManager?.dispose();
  memoryStore?.close();
  memoryStore = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function configureAppIdentity(): void {
  app.setName('MultiMind Flow');
  configureUserDataPath();

  if (process.platform !== 'darwin' || app.isPackaged) {
    return;
  }

  const dockIconPath = path.join(__dirname, '../../build/icon.png');
  const dockIcon = nativeImage.createFromPath(dockIconPath);
  if (!dockIcon.isEmpty()) {
    app.dock.setIcon(dockIcon);
  }
}

function getWindowIconPath(): string | undefined {
  if (process.platform === 'darwin') {
    return undefined;
  }

  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../../build/icon.ico');
}

function configureUserDataPath(): void {
  const userDataPath = path.join(app.getPath('appData'), 'MultiMind Flow');
  const legacyUserDataPath = path.join(app.getPath('appData'), 'MultiMind Browser');

  migrateLegacyUserDataPath(legacyUserDataPath, userDataPath);
  app.setPath('userData', userDataPath);
}

function migrateLegacyUserDataPath(legacyUserDataPath: string, userDataPath: string): void {
  if (!fsSync.existsSync(legacyUserDataPath) || fsSync.existsSync(userDataPath)) {
    return;
  }

  try {
    fsSync.renameSync(legacyUserDataPath, userDataPath);
  } catch (error) {
    console.error('Failed to migrate legacy user data path:', error);
  }
}

async function loadDevRenderer(window: BrowserWindow): Promise<void> {
  const screenshotMode = process.env.MULTIMIND_SCREENSHOT_MODE;
  const devServerUrl = `http://localhost:5173${
    screenshotMode ? `?screenshotMode=${encodeURIComponent(screenshotMode)}` : ''
  }`;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (window.isDestroyed()) {
      return;
    }

    try {
      await window.loadURL(devServerUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (window.isDestroyed()) {
    return;
  }

  await window.loadURL(devServerUrl);
}

function scheduleDevCapture(window: BrowserWindow): void {
  const capturePath = process.env.MULTIMIND_CAPTURE_PATH;
  if (!capturePath || app.isPackaged) {
    return;
  }

  setTimeout(() => {
    if (window.isDestroyed()) {
      return;
    }

    void window.capturePage().then((image) => fs.writeFile(capturePath, image.toPNG())).catch((error) => {
      if (!isDestroyedObjectError(error)) {
        console.error('Failed to capture page:', error);
      }
    });
  }, 5000);
}

function bindProcessExceptionHandlers(): void {
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
  });
}

function isDestroyedObjectError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Object has been destroyed');
}

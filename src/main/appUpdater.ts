import { app, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { AppUpdateAction, AppUpdateState } from '../shared/types';
import { UPDATE_REPOSITORY } from './constants';

export function isNewerRelease(latest: string, current: string): boolean {
  const parse = (value: string) => /^v?\d+\.\d+\.\d+$/.test(value) ? value.replace(/^v/, '').split('.').map(Number) : null;
  const a = parse(latest), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export class AppUpdater {
  private state: Omit<AppUpdateState, 'autoCheck'> = { status: 'idle', canInstall: false };
  private checking = false;
  constructor(private readonly isBusy: () => boolean, private readonly preferences: { get: () => boolean; set: (enabled: boolean) => void }) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('error', () => { this.state = { ...this.state, status: 'error', error: 'network' }; });
    autoUpdater.on('download-progress', progress => { this.state = { ...this.state, status: 'downloading', progress: Math.round(progress.percent) }; });
    autoUpdater.on('update-downloaded', () => { this.state = { ...this.state, status: 'ready', progress: 100 }; });
  }
  async checkOnStartup(): Promise<void> {
    if (app.isPackaged && this.preferences.get()) await this.action('check');
  }
  async action(action: AppUpdateAction): Promise<AppUpdateState> {
    if (action === 'enable-auto-check' || action === 'disable-auto-check') {
      this.preferences.set(action === 'enable-auto-check');
      return { ...this.state, autoCheck: this.preferences.get() };
    }
    if (action === 'state') return { ...this.state, autoCheck: this.preferences.get() };
    if (action === 'releases') {
      await shell.openExternal(`https://github.com/${UPDATE_REPOSITORY}/releases`);
      return { ...this.state, autoCheck: this.preferences.get() };
    }
    if (!app.isPackaged) return { ...this.state, autoCheck: this.preferences.get(), error: 'development' };
    if (action === 'install') {
      if (this.state.status !== 'ready' || !this.state.canInstall) return { ...this.state, autoCheck: this.preferences.get() };
      if (this.isBusy()) return { ...this.state, autoCheck: this.preferences.get(), error: 'busy' };
      autoUpdater.quitAndInstall(false, true);
    } else if (action === 'download') {
      if (this.state.status !== 'available' || !this.state.canInstall) return { ...this.state, autoCheck: this.preferences.get() };
      this.state = { ...this.state, status: 'downloading', progress: 0, error: undefined };
      void autoUpdater.downloadUpdate().catch(() => { this.state = { ...this.state, status: 'error', error: 'network' }; });
    } else if (action === 'check') {
      if (this.checking || ['downloading', 'ready'].includes(this.state.status)) return { ...this.state, autoCheck: this.preferences.get() };
      this.checking = true;
      this.state = { status: 'checking', canInstall: false };
      try {
        const response = await net.fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github+json' } });
        if (!response.ok) throw new Error('Release check failed');
        const release = await response.json() as { tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: { name: string }[] };
        if (!release.tag_name || release.draft || release.prerelease) throw new Error('Invalid release');
        const newer = isNewerRelease(release.tag_name, app.getVersion());
        this.state = { status: newer ? 'available' : 'current', version: release.tag_name.replace(/^v/, ''), canInstall: false };
        // Unsigned macOS builds use the official download page. NSIS requires published metadata.
        if (newer && process.platform === 'win32' && release.assets?.some(asset => asset.name === 'latest.yml')) {
          const result = await autoUpdater.checkForUpdates();
          this.state = { ...this.state, canInstall: !!result && isNewerRelease(result.updateInfo.version, app.getVersion()) };
        }
      } catch {
        this.state = { ...this.state, status: 'error', error: 'network' };
      } finally { this.checking = false; }
    }
    return { ...this.state, autoCheck: this.preferences.get() };
  }
}

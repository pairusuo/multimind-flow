import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LOCAL_AGENTS, localAgent, type LocalAgentId } from '../shared/botCatalog';
import type { LocalAgentStatus } from '../shared/types';
import { detectLocalAgent } from './localAgentRuntime';

type Entry = { status: LocalAgentStatus; checkedAt: number };
type Detector = (agent: LocalAgentId, executable?: string) => Promise<LocalAgentStatus>;

export class LocalAgentDetectionCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<LocalAgentStatus>>();
  constructor(private file: string, private detector: Detector = detectLocalAgent, private now = Date.now) {
    try {
      const saved: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(saved)) return;
      for (const row of saved) {
        if (!row || typeof row.key !== 'string' || !Number.isFinite(row.checkedAt) || typeof row.installed !== 'boolean') continue;
        this.entries.set(row.key, { checkedAt: row.checkedAt, status: {
          installed: row.installed, executable: typeof row.executable === 'string' ? row.executable : undefined,
          usable: typeof row.usable === 'boolean' ? row.usable : undefined,
          authenticated: false, authChecked: false, authMethod: 'unknown',
        } });
      }
    } catch { /* A missing or invalid cache is rebuilt by normal detection. */ }
  }
  private key(agent: LocalAgentId, executable?: string) { localAgent(agent); return JSON.stringify([agent, executable?.trim() || '']); }
  snapshot(agent: LocalAgentId, executable?: string): LocalAgentStatus | undefined {
    return this.entries.get(this.key(agent, executable))?.status;
  }
  async detect(agent: LocalAgentId, executable?: string, force = false): Promise<LocalAgentStatus> {
    const key = this.key(agent, executable);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const entry = this.entries.get(key);
    if (!force && entry) return entry.status;
    const task = this.detector(agent, executable).then((status) => {
      const updated = new Map(this.entries);
      updated.set(key, { status, checkedAt: this.now() });
      // Only installation metadata is persisted. Never credentials or login state.
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(`${this.file}.tmp`, JSON.stringify([...updated].map(([key, entry]) => ({ key, checkedAt: entry.checkedAt,
          installed: entry.status.installed, executable: entry.status.executable, usable: entry.status.usable }))), { mode: 0o600 });
        renameSync(`${this.file}.tmp`, this.file);
      } catch (cause) {
        throw Object.assign(new Error('Unable to save local Agent detection results.'), { cause });
      }
      this.entries = updated;
      return status;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}
let cache: LocalAgentDetectionCache | undefined;
function detectionCache() { return cache ??= new LocalAgentDetectionCache(join(app.getPath('userData'), 'local-agent-detection.json')); }
export function cachedAgentDetection(agent: LocalAgentId, executable?: string, force = false) { return detectionCache().detect(agent, executable, force); }
export function localAgentDetectionSnapshot(agent: LocalAgentId, executable?: string): Partial<Record<LocalAgentId, LocalAgentStatus>> {
  localAgent(agent);
  return Object.fromEntries(LOCAL_AGENTS.flatMap((item) => {
    const status = detectionCache().snapshot(item.id, item.id === agent ? executable : undefined);
    return status ? [[item.id, status]] : [];
  }));
}

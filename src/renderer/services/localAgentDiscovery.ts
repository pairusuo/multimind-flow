import { LOCAL_AGENTS, type LocalAgentId } from '../../shared/botCatalog';
import type { LocalAgentStatus } from '../../shared/types';

type Statuses = Partial<Record<LocalAgentId, LocalAgentStatus>>;
type Discovery = { statuses: Statuses; failed: boolean; cacheReadFailed?: boolean; failedAgents?: LocalAgentId[]; restartRequired?: boolean };
let saved: Statuses = {};
let initialization: Promise<Discovery> | undefined;
let scanning: Promise<Discovery> | undefined;

export function localAgentSnapshot(): Statuses { return saved; }

// Owned by the renderer session, not a dialog mount. Closing a dialog never
// discards results or starts a second scan while the first is still running.
export async function discoverLocalAgents(
  agent: LocalAgentId, executable: string | undefined, force: boolean,
  onScanning: () => void,
): Promise<Discovery> {
  const scan = () => {
    onScanning();
    if (scanning) return scanning;
    scanning = Promise.allSettled(LOCAL_AGENTS.map(async (item) => {
      const status = await window.electronAPI.detectLocalAgent(item.id, item.id === agent ? executable : undefined, force);
      saved = { ...saved, [item.id]: status };
    })).then((results) => ({
      statuses: saved, failed: results.some((result) => result.status === 'rejected'),
      failedAgents: results.flatMap((result, index) => result.status === 'rejected' ? [LOCAL_AGENTS[index].id] : []),
      restartRequired: results.some((result) => result.status === 'rejected' && /Unknown local agent|No handler registered/i.test(String(result.reason))),
    }))
      .finally(() => { scanning = undefined; });
    return scanning;
  };
  if (force) {
    // An explicit refresh must not race the initial cache read/scan.
    if (initialization) await initialization;
    const result = await scan();
    initialization = Promise.resolve(result);
    return result;
  }
  if (!initialization) {
    initialization = (async () => {
      try {
        const cached = await window.electronAPI.getLocalAgentCache(agent, executable);
        if (cached && Object.keys(cached).length) {
          saved = cached;
          return { statuses: saved, failed: false };
        }
      } catch { return { statuses: saved, failed: true, cacheReadFailed: true }; }
      return scan();
    })();
  }
  const result = await initialization;
  return { ...result, statuses: saved };
}

import { safeStorage } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';

type CredentialFailure = 'read' | 'unavailable' | 'decrypt' | 'missing';

export class BotCredentialError extends Error {
  constructor(readonly reason: CredentialFailure) {
    super(`BOT_CREDENTIAL_${reason.toUpperCase()}`);
  }
}

/** Retry only local reads, before any model request. Never log native errors or credential data. */
export async function readBotApiKey(
  readEncrypted: () => string | null,
  signal?: AbortSignal,
  onRetry?: () => void,
): Promise<string> {
  const retryDelays = [250, 750];
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    let reason: CredentialFailure = 'read';
    try {
      const encrypted = readEncrypted();
      reason = 'missing';
      if (!encrypted) throw new BotCredentialError(reason);
      reason = 'unavailable';
      if (!safeStorage.isEncryptionAvailable()) throw new BotCredentialError(reason);
      reason = 'decrypt';
      const apiKey = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      if (!apiKey.trim()) throw new BotCredentialError(reason);
      return apiKey;
    } catch {
      console.warn('Bot credential read failed', { reason, attempt: attempt + 1, platform: process.platform });
      if (reason === 'missing' || attempt === retryDelays.length) throw new BotCredentialError(reason);
      onRetry?.();
      await delay(retryDelays[attempt], undefined, { signal });
    }
  }
}

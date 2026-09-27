import type { SiteAdapter } from './index';

// ChatGPT accounts created with Google sign-in should be guided to add a password in
// ChatGPT settings, then use email + password in Electron to avoid Google OAuth limits.
export const chatgptAdapter: SiteAdapter = {
  urlPattern: /https:\/\/chatgpt\.com/i,
  injectScript: (text: string) => `
    (async () => {
      let input = document.querySelector('#prompt-textarea[contenteditable="true"]');
      if (!input) {
        input = document.querySelector('textarea#prompt-textarea');
      }
      if (!input) return false;

      input.focus();

      if (input instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setter) return false;
        setter.call(input, ${JSON.stringify(text)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(text)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const getInputText = () => input instanceof HTMLTextAreaElement
        ? input.value.trim()
        : (input.innerText || input.textContent || '').trim();
      const isEnabledButton = (button) => button
        && button.getAttribute('aria-disabled') !== 'true'
        && !button.disabled;
      const getSendButton = () => document.querySelector('button[data-testid="send-button"]')
        || document.querySelector('button[aria-label="Send prompt"]');
      const waitForEnabledButton = async (timeout = 3000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const button = getSendButton();
          if (isEnabledButton(button)) return button;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
      };
      const waitForInputToClear = async (timeout = 1200) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          if (!getInputText()) return true;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return false;
      };

      const button = await waitForEnabledButton();
      if (button) {
        button.click();
        if (await waitForInputToClear()) return true;
      }

      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true
      }));
      return waitForInputToClear();
    })();
  `,
  nativeInjection: {
    prepareScript: () => buildChatGptNativeInputScript(),
    usesNativeTextInsertion: true,
    clickTargetScript: (text: string) => buildChatGptNativeSendTargetScript(text),
    acceptedScript: buildChatGptNativeAcceptedScript(),
    enterFallbackScript: buildChatGptNativeInputScript(),
  },
  readyCheckScript: `
    Boolean(document.querySelector('#prompt-textarea[contenteditable="true"]')
      || document.querySelector('textarea#prompt-textarea'));
  `,
  extractLatestResponse: () => `
    (() => {
      const getText = (element) => (element?.innerText || element?.textContent || '').trim();
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')]
        .filter((message) => isVisible(message));
      const latest = messages.at(-1);
      if (!latest) return null;

      const content = latest.querySelector('.markdown')
        || latest.querySelector('[data-message-id]')
        || latest;
      const text = getText(content);
      if (!text || /^(正在思考|已停止思考)$/.test(text)) return null;
      return text;
    })();
  `,
  extractConversation: () => buildChatGPTConversationScript(),
  isResponseComplete: () => `
    (() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const stopButton = document.querySelector('button[data-testid="stop-button"]')
        || [...document.querySelectorAll('button')].find((button) => {
          const label = [
            button.getAttribute('aria-label'),
            button.getAttribute('title'),
            button.getAttribute('data-testid')
          ].filter(Boolean).join(' ').toLowerCase();
          return isVisible(button) && /(stop-button|stop streaming|stop generating|停止生成|停止回答|停止响应|cancel response)/.test(label);
        });
      return !stopButton;
    })();
  `,
};

function buildChatGptNativeInputScript(): string {
  return `
    (() => {
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const input = [
        ...document.querySelectorAll('#prompt-textarea[contenteditable="true"], textarea#prompt-textarea, [data-testid="composer-text-input"][contenteditable="true"]')
      ].filter(isVisible).at(-1);
      if (!input) return false;
      input.focus();
      if (input instanceof HTMLTextAreaElement) {
        input.select();
        input.setSelectionRange(0, input.value.length);
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return document.activeElement === input || input.contains(document.activeElement);
    })();
  `;
}

function buildChatGptNativeSendTargetScript(text: string): string {
  return `
    (async () => {
      const expected = ${JSON.stringify(text)}.replace(/\\s+/g, ' ').trim();
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const input = [...document.querySelectorAll('#prompt-textarea[contenteditable="true"], textarea#prompt-textarea, [data-testid="composer-text-input"][contenteditable="true"]')]
          .filter(isVisible).at(-1);
        const current = (input instanceof HTMLTextAreaElement ? input.value : input?.innerText || input?.textContent || '').replace(/\\s+/g, ' ').trim();
        const button = [...document.querySelectorAll('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label*="发送"], button[aria-label*="send" i]')]
          .find((candidate) => isVisible(candidate) && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true');
        if (input && button && current === expected) {
          const rect = button.getBoundingClientRect();
          return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        }
        await delay(100);
      }
      return null;
    })();
  `;
}

function buildChatGptNativeAcceptedScript(): string {
  return `
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const input = document.querySelector('#prompt-textarea[contenteditable="true"], textarea#prompt-textarea, [data-testid="composer-text-input"][contenteditable="true"]');
        const text = (input instanceof HTMLTextAreaElement ? input.value : input?.innerText || input?.textContent || '').trim();
        const generating = document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]');
        if (!text || generating) return true;
        await delay(100);
      }
      return false;
    })();
  `;
}

function buildChatGPTConversationScript(): string {
  return `
    (() => {
      const getText = (element) => (element?.innerText || element?.textContent || '').trim();
      const normalize = (text) => text.replace(/\\n{3,}/g, '\\n\\n').trim();
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const isUiText = (text) => /ChatGPT 也可能会犯错|Message ChatGPT|发送消息|新聊天|搜索聊天记录|ChatGPT can make mistakes|Regenerate|Share|Copy|Read aloud|Good response|Bad response/i.test(text);
      const cleanMessageText = (element) => {
        const clone = element.cloneNode(true);
        clone.querySelectorAll?.([
          'button',
          'nav',
          'aside',
          'header',
          'footer',
          'textarea',
          'input',
          '[contenteditable="true"]',
          '[role="button"]',
          '[aria-hidden="true"]',
          '[data-testid*="copy"]',
          '[data-testid*="share"]',
          '[data-testid*="feedback"]',
          '[class*="toolbar"]',
          '[class*="actions"]'
        ].join(',')).forEach((child) => child.remove());
        return normalize(getText(clone));
      };
      const nearestTurn = (element) => {
        return element.closest('article')
          || element.closest('[data-testid^="conversation-turn"]')
          || element.closest('[class*="group"]')
          || element;
      };
      const getOrder = (element, fallback) => {
        const turn = element.closest('[data-testid^="conversation-turn"]');
        const match = /conversation-turn-(\\d+)/.exec(turn?.getAttribute('data-testid') || '');
        if (match) {
          const value = Number.parseInt(match[1], 10);
          if (Number.isFinite(value)) return value;
        }
        const rect = element.getBoundingClientRect();
        return Number.isFinite(rect.top) ? rect.top : fallback;
      };
      const roleNodes = [...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')]
        .filter(isVisible);
      const entries = [];
      const seen = new Set();

      roleNodes.forEach((node, index) => {
        const role = node.getAttribute('data-message-author-role');
        if (role !== 'user' && role !== 'assistant') return;
        const turn = nearestTurn(node);
        const contentRoot = role === 'assistant'
          ? (node.querySelector('.markdown') || node.querySelector('[data-message-id]') || node)
          : (node.querySelector('[data-message-id]') || node);
        const content = cleanMessageText(contentRoot);
        if (!content || content.length < 2 || content.length > 12000 || isUiText(content)) return;

        const key = role + '|' + content;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({
          role,
          content,
          domId: node.getAttribute('data-message-id') || turn?.getAttribute?.('data-testid') || undefined,
          order: getOrder(turn, index)
        });
      });

      if (!entries.length) {
        return null;
      }

      const deduped = [];
      for (const entry of entries.sort((a, b) => a.order - b.order)) {
        if (deduped.some((item) => item.role === entry.role && item.content === entry.content)) continue;
        if (deduped.some((item) => item.role === entry.role && item.content.includes(entry.content) && item.content.length > entry.content.length)) continue;
        for (let i = deduped.length - 1; i >= 0; i -= 1) {
          if (
            deduped[i].role === entry.role
            && entry.content.includes(deduped[i].content)
            && entry.content.length > deduped[i].content.length
          ) {
            deduped.splice(i, 1);
          }
        }
        deduped.push(entry);
      }

      return {
        entries: deduped.map((entry) => ({
          role: entry.role,
          content: entry.content,
          ...(entry.domId ? { domId: entry.domId } : {}),
          order: entry.order
        }))
      };
    })();
  `;
}

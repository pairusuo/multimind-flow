import type { SiteAdapter } from './index';

const extractDoubaoLatestResponseScript = `
  (() => {
    const getText = (element) => (element?.innerText || element?.textContent || '').trim();
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const isChrome = (element) => element.closest(
      'button, a, nav, aside, header, footer, textarea, input, [contenteditable="true"], [role="textbox"]'
    );
    const suggestionSelector = '[class*="suggest-message-list-wrapper"], [class~="suggest-list-item"]';
    const getConversationText = (element) => {
      const clone = element.cloneNode(true);
      clone.querySelectorAll?.(suggestionSelector).forEach((node) => node.remove());
      return getText(clone);
    };
    const isUiText = (text) => /给豆包发送消息|内容由 AI 生成|内容由AI生成|深度思考|联网搜索|按 Enter|Shift\\+Enter|新建对话|历史记录/.test(text);
    const selectors = [
      '[data-testid*="message"]',
      '[class*="message"]',
      '[class*="markdown"]',
      '[class*="answer"]',
      '[class*="chat"] [class*="content"]',
      'main p',
      'main li',
      'main [dir="auto"]'
    ];
    const seen = new Set();
    const candidates = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((element) => {
        if (seen.has(element)) return false;
        seen.add(element);
        if (!isVisible(element) || isChrome(element)) return false;
        if (element.closest(suggestionSelector)) return false;
        const text = getConversationText(element);
        if (text.length < 20 || text.length > 8000 || isUiText(text)) return false;
        return !element.querySelector('textarea, input, [contenteditable="true"], [role="textbox"]');
      })
      .map((element) => {
        let best = element;
        let current = element;
        for (let i = 0; i < 5 && current.parentElement; i += 1) {
          const parent = current.parentElement;
          if (parent === document.body || parent.tagName === 'MAIN') break;
          const text = getConversationText(parent);
          const bestText = getConversationText(best);
          const blockCount = parent.querySelectorAll('p, li, [dir="auto"], [class*="markdown"]').length;
          if (text.length >= bestText.length && text.length <= 8000 && blockCount <= 30 && !isUiText(text) && !isChrome(parent)) {
            best = parent;
          }
          current = parent;
        }
        return best;
      });

    const unique = [];
    const uniqueTexts = new Set();
    for (const candidate of candidates) {
      const text = getConversationText(candidate);
      if (!uniqueTexts.has(text)) {
        uniqueTexts.add(text);
        unique.push({ element: candidate, text });
      }
    }

    return unique.at(-1)?.text || null;
  })();
`;

const extractDoubaoConversationScript = `
  (async () => {
    const getText = (element) => (element?.innerText || element?.textContent || '').trim();
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const isChrome = (element) => element.closest(
      'button, a, nav, aside, header, footer, textarea, input, [contenteditable="true"], [role="textbox"]'
    );
    const suggestionSelector = '[class*="suggest-message-list-wrapper"], [class~="suggest-list-item"]';
    const getConversationText = (element) => {
      const clone = element.cloneNode(true);
      clone.querySelectorAll?.(suggestionSelector).forEach((node) => node.remove());
      return getText(clone);
    };
    const isUiText = (text) => /给豆包发送消息|内容由 AI 生成|内容由AI生成|深度思考|联网搜索|按 Enter|Shift\\+Enter|新建对话|历史记录|搜索\\.\\.\\.|AI 创作|云盘|更多/.test(text);
    const normalize = (text) => text.replace(/\\n{3,}/g, '\\n\\n').trim();
    const isUserRow = (element) => {
      const rowText = normalize(getConversationText(element));
      const rightAlignedText = [...element.querySelectorAll('[class*="justify-end"]')]
        .map((node) => ({ text: normalize(getConversationText(node)), rect: node.getBoundingClientRect() }))
        .find(({ text, rect }) => text && rowText.includes(text) && text.length >= rowText.length * 0.8 && rect.left > window.innerWidth * 0.25);
      if (rightAlignedText) return true;
      const bubble = [...element.querySelectorAll('div')]
        .map((node) => ({ text: normalize(getConversationText(node)), rect: node.getBoundingClientRect() }))
        .filter(({ text, rect }) => text && rowText.includes(text) && text.length >= rowText.length * 0.8 && rect.width > 0 && rect.height > 0)
        .sort((a, b) => b.rect.right - a.rect.right)[0];
      return Boolean(bubble && bubble.rect.left > window.innerWidth * 0.35);
    };
    const classifyRole = (element, index) => {
      if (element.className?.toString().includes('v_list_row')) {
        return isUserRow(element) ? 'user' : 'assistant';
      }
      const descriptor = [
        element.getAttribute('data-testid'),
        element.getAttribute('data-role'),
        element.getAttribute('role'),
        element.className?.toString(),
        element.getAttribute('aria-label')
      ].filter(Boolean).join(' ').toLowerCase();
      if (/user|human|question|query|bubble.*right|right.*bubble|mine|self/.test(descriptor)) return 'user';
      if (/assistant|bot|answer|ai|doubao|message|markdown/.test(descriptor)) return 'assistant';
      const rect = element.getBoundingClientRect();
      if (rect.left > window.innerWidth * 0.45) return 'user';
      return index % 2 === 0 ? 'user' : 'assistant';
    };
    const isConversationText = (text) => {
      if (text.length < 2 || text.length > 12000 || isUiText(text)) return false;
      if (/^快速\\s*编程\\s*图像生成\\s*帮我写作\\s*更多$/.test(text.replace(/\\n/g, ' '))) return false;
      return true;
    };
    const findScroller = () => {
      const explicit = document.querySelector('[class*="v_list_scroller"], .scroller');
      if (explicit && explicit.scrollHeight > explicit.clientHeight) return explicit;
      return [...document.querySelectorAll('main, div')]
        .filter((element) => element.scrollHeight > element.clientHeight + 100 && element.clientHeight > 100)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null;
    };
    const getRowPosition = (element, fallback) => {
      const inline = element.getAttribute('style') || '';
      const marker = '--vlist-row-transform-y:';
      const start = inline.indexOf(marker);
      if (start >= 0) {
        const value = Number.parseFloat(inline.slice(start + marker.length));
        if (Number.isFinite(value)) return value;
      }
      return fallback;
    };
    const collectRows = (messages) => {
      const rows = [...document.querySelectorAll('.v_list_row')]
        .filter((element) => isVisible(element) || element.getBoundingClientRect().height > 0)
        .map((element, index) => {
          const text = normalize(getConversationText(element));
          if (!isConversationText(text)) return null;
          if (element.querySelector('textarea, input, [contenteditable="true"], [role="textbox"]')) return null;
          const domId = element.getAttribute('data-observe-row') || undefined;
          return { element, role: classifyRole(element, messages.size), text, domId, position: getRowPosition(element, messages.size + index) };
        })
        .filter(Boolean);

      for (const row of rows) {
        const key = row.role + '|' + (row.domId || row.text);
        const existing = messages.get(key);
        if (!existing || row.text.length > existing.text.length) {
          messages.set(key, existing ? { ...row, position: existing.position } : row);
        }
      }
    };
    const collectFallback = (messages) => {
      const selectors = [
      '[data-testid*="message"]',
      '[data-testid*="chat"]',
      '[class*="message"]',
      '[class*="bubble"]',
      '[class*="markdown"]',
      '[class*="answer"]',
      '[class*="content"]',
      'main [dir="auto"]',
      'main p',
      'main li'
      ];
      const rawCandidates = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((element) => {
        if (!isVisible(element) || isChrome(element)) return false;
        if (element.closest(suggestionSelector)) return false;
        const text = normalize(getConversationText(element));
        if (!isConversationText(text)) return false;
        return !element.querySelector('textarea, input, [contenteditable="true"], [role="textbox"]');
      })
      .map((element) => {
        let best = element;
        let current = element;
        for (let i = 0; i < 6 && current.parentElement; i += 1) {
          const parent = current.parentElement;
          if (parent === document.body || parent.tagName === 'MAIN') break;
          if (isChrome(parent)) break;
          const text = normalize(getConversationText(parent));
          const currentText = normalize(getConversationText(best));
          const blockCount = parent.querySelectorAll('p, li, [dir="auto"], [class*="markdown"]').length;
          if (text.length >= currentText.length && text.length <= 12000 && blockCount <= 30 && !isUiText(text)) {
            best = parent;
          }
          current = parent;
        }
        return best;
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

      for (const element of rawCandidates) {
        const text = normalize(getConversationText(element));
        if (!text) continue;
        const role = classifyRole(element, messages.size);
        const key = role + '|' + text;
        if (!messages.has(key)) {
          messages.set(key, { role, text, position: messages.size });
        }
      }
    };

    const messages = new Map();
    const scroller = findScroller();
    const originalTop = scroller?.scrollTop || 0;

    if (scroller) {
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const step = Math.max(120, Math.floor(scroller.clientHeight * 0.8));
      for (let top = 0; top <= maxTop; top += step) {
        scroller.scrollTop = top;
        await new Promise((resolve) => setTimeout(resolve, 80));
        collectRows(messages);
      }
      scroller.scrollTop = maxTop;
      await new Promise((resolve) => setTimeout(resolve, 80));
      collectRows(messages);
      scroller.scrollTop = originalTop;
    } else {
      collectRows(messages);
    }

    if (!messages.size) {
      collectFallback(messages);
    }

    const unique = [];
    for (const message of [...messages.values()].sort((a, b) => a.position - b.position)) {
      if (unique.some((item) => item.role === message.role && item.text === message.text)) continue;
      if (unique.some((item) => item.text.includes(message.text) && item.text.length > message.text.length)) continue;
      for (let i = unique.length - 1; i >= 0; i -= 1) {
        if (message.text.includes(unique[i].text) && message.text.length > unique[i].text.length) {
          unique.splice(i, 1);
        }
      }
      unique.push(message);
    }

    if (!unique.length) return null;
    return {
      entries: unique.map((message) => ({
        role: message.role,
        content: message.text,
        ...(message.domId ? { domId: message.domId } : {}),
        order: message.position
      }))
    };
  })();
`;

export const doubaoAdapter: SiteAdapter = {
  urlPattern: /https:\/\/(?:www\.)?doubao\.com/i,
  injectScript: (text: string) => `
    (async () => {
      const input = document.querySelector('textarea')
        || document.querySelector('[contenteditable="true"][role="textbox"]')
        || document.querySelector('[contenteditable="true"]');
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
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const visibleEnabledButtons = (root) => [...root.querySelectorAll('button')]
        .filter((button) => {
          const rect = button.getBoundingClientRect();
          const style = window.getComputedStyle(button);
          return rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && !button.disabled
            && button.getAttribute('aria-disabled') !== 'true';
        });
      const getInputText = () => input instanceof HTMLTextAreaElement
        ? input.value.trim()
        : (input.innerText || input.textContent || '').trim();
      const waitForInputToClear = async (timeout = 1200) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          if (!getInputText()) return true;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return false;
      };
      const findSendButton = () => {
        let root = input;
        let buttons = [];
        for (let depth = 0; root && depth < 8; depth += 1) {
          buttons = visibleEnabledButtons(root);
          if (buttons.length >= 2) break;
          root = root.parentElement;
        }

        if (!buttons.length) {
          buttons = visibleEnabledButtons(document);
        }

        const inputRect = input.getBoundingClientRect();
        return buttons
          .map((candidate) => ({ candidate, rect: candidate.getBoundingClientRect() }))
          .filter(({ rect }) => rect.bottom >= inputRect.top - 80)
          .sort((a, b) => (b.rect.bottom - a.rect.bottom) || (b.rect.right - a.rect.right))[0]?.candidate || null;
      };
      const waitForEnabledButton = async (timeout = 3000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const button = findSendButton();
          if (button) return button;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
      };

      const button = await waitForEnabledButton();
      if (button) {
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        button.click();
        button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        if (await waitForInputToClear()) return true;
      }

      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
        composed: true
      }));
      return waitForInputToClear();
    })();
  `,
  nativeInjection: {
    prepareScript: () => buildDoubaoNativeInputScript(),
    usesNativeTextInsertion: true,
    clickTargetScript: (text: string) => buildDoubaoNativeSendTargetScript(text),
    acceptedScript: buildDoubaoNativeAcceptedScript(),
    enterFallbackScript: buildDoubaoNativeInputScript(),
  },
  readyCheckScript: `
    Boolean(document.querySelector('textarea')
      || document.querySelector('[contenteditable="true"][role="textbox"]')
      || document.querySelector('[contenteditable="true"]'));
  `,
  extractLatestResponse: () => extractDoubaoLatestResponseScript,
  extractConversation: () => extractDoubaoConversationScript,
  isResponseComplete: () => `
    (() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const stopControl = [...document.querySelectorAll('button, [role="button"]')].find((element) => {
        const label = [
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
          element.textContent
        ].filter(Boolean).join(' ').toLowerCase();
        return isVisible(element) && /(stop|停止|取消生成|停止生成|停止回答)/.test(label);
      });
      if (stopControl) return false;

      const text = ${extractDoubaoLatestResponseScript};
      const now = Date.now();
      const state = window.__multimindDoubaoReadState || { text: '', changedAt: now };
      if (text !== state.text) {
        window.__multimindDoubaoReadState = { text, changedAt: now };
        return false;
      }
      window.__multimindDoubaoReadState = state;
      return Boolean(text) && now - state.changedAt > 1500;
    })();
  `,
};

function buildDoubaoNativeInputScript(): string {
  return `
    (() => {
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const input = [...document.querySelectorAll('textarea:not([disabled]), [contenteditable="true"][role="textbox"], [contenteditable="true"]')]
        .filter(isVisible).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).at(-1);
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

function buildDoubaoNativeSendTargetScript(text: string): string {
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
        const input = [...document.querySelectorAll('textarea:not([disabled]), [contenteditable="true"][role="textbox"], [contenteditable="true"]')]
          .filter(isVisible).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).at(-1);
        const current = (input instanceof HTMLTextAreaElement ? input.value : input?.innerText || input?.textContent || '').replace(/\\s+/g, ' ').trim();
        if (input && current === expected) {
          const inputRect = input.getBoundingClientRect();
          const explicit = [...document.querySelectorAll('button[aria-label*="发送"], [role="button"][aria-label*="发送"], button[aria-label*="send" i], [role="button"][aria-label*="send" i], [data-testid*="send" i], [class*="send-button" i], [class*="send-btn" i], [class*="submit" i]')]
            .find((candidate) => isVisible(candidate) && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true');
          const nearby = [...document.querySelectorAll('button, [role="button"]')]
            .filter((candidate) => {
              if (!isVisible(candidate) || candidate.disabled || candidate.getAttribute('aria-disabled') === 'true') return false;
              const rect = candidate.getBoundingClientRect();
              return rect.left >= inputRect.left + inputRect.width * 0.65 && rect.top >= inputRect.top - 20 && rect.bottom <= inputRect.bottom + 35;
            })
            .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
          const button = explicit || nearby;
          if (button) {
            const rect = button.getBoundingClientRect();
            return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
          }
        }
        await delay(100);
      }
      return null;
    })();
  `;
}

function buildDoubaoNativeAcceptedScript(): string {
  return `
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const inputs = [...document.querySelectorAll('textarea:not([disabled]), [contenteditable="true"][role="textbox"], [contenteditable="true"]')];
        const input = inputs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).at(-1);
        const text = (input instanceof HTMLTextAreaElement ? input.value : input?.innerText || input?.textContent || '').trim();
        const generating = [...document.querySelectorAll('button, [role="button"], [aria-label], [title]')].some((candidate) => {
          const label = [candidate.getAttribute?.('aria-label'), candidate.getAttribute?.('title'), candidate.className?.toString(), candidate.textContent].filter(Boolean).join(' ');
          return /stop|cancel|停止|暂停|取消|生成中|思考中/i.test(label);
        });
        if (!text || generating) return true;
        await delay(100);
      }
      return false;
    })();
  `;
}

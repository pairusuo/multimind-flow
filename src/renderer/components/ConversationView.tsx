import AgentAuthHelp from './AgentAuthHelp';
import GroupAvatar from './GroupAvatar';
import GroupDetails from './GroupDetails';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { mentionLabel, mentionRecipients } from '../../shared/botCoordination';
import BotAvatar from './BotAvatar';
import { botErrorKind } from '../../shared/botErrors';
import BotManagerPage from './BotManagerPage';
import BotEditorPage from './BotEditorPage';
import { botConnectionLabel } from '../../shared/botCatalog';
import { KeyboardEvent, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkspaceIcon } from './WorkspaceIcon';
import {
  AppLanguage,
  Bot,
  Conversation,
  ConversationMember,
  ConversationMessage,
  ConversationMessageStatus,
  ConversationRoundStatusPayload,
  ConversationState,
  ConversationSummary,
} from '../../shared/types';

interface ConversationViewProps {
  language: AppLanguage;
}

type Recipients = 'all' | Set<string>;

interface QuoteRef {
  messageId: string;
  botName: string;
  content: string;
}

interface RoundStatusMap {
  [conversationId: string]: ConversationRoundStatusPayload | undefined;
}


export default function ConversationView({ language }: ConversationViewProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<ConversationState | null>(null);
  const [activeId, selectActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const viewRevision = useRef(0);
  const mounted = useRef(true);
  const [conversation, updateConversation] = useState<Conversation | null>(null);
  const setActiveId = useCallback((id: string | null) => {
    if (activeIdRef.current === id) return;
    activeIdRef.current = id;
    viewRevision.current++;
    updateConversation(null);
    selectActiveId(id);
  }, []);
  const setConversation = useCallback((next: SetStateAction<Conversation | null>) => {
    if (!mounted.current) return;
    updateConversation((previous) => {
      const value = typeof next === 'function' ? next(previous) : next;
      return value?.id === activeIdRef.current ? value : previous;
    });
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; viewRevision.current++; };
  }, []);
  const [previews, setPreviews] = useState<Record<string, ConversationSummary['lastMessage']>>({});
  useEffect(() => {
    if (!conversation) return;
    const latest = [...conversation.messages].reverse().find(message => message.content.trim());
    const preview = latest ? { name: latest.botSnapshotName, content: latest.content.replace(/\s+/g, ' ').slice(0, 160) } : null;
    setPreviews(previous => ({ ...previous, [conversation.id]: preview }));
  }, [conversation]);
  const [roundStatuses, setRoundStatuses] = useState<RoundStatusMap>({});
  const [drafts, setDrafts] = useState<Record<string, {
    input: string; recipients: Recipients; quote: QuoteRef | null; error: string | null; sending: boolean;
  }>>({});
  const draft = drafts[activeId ?? ''] ?? { input: '', recipients: 'all' as Recipients, quote: null, error: null, sending: false };
  const { input, recipients, quote, error, sending } = draft;
  // Each async handler retains the conversation it started in.
  function patchDraft(patch: Partial<typeof draft>) {
    if (!activeId || !mounted.current) return;
    setDrafts((previous) => ({ ...previous, [activeId]: { ...draft, ...previous[activeId], ...patch } }));
  }
  const setInput = (value: string) => patchDraft({ input: value });
  const setQuote = (value: QuoteRef | null) => patchDraft({ quote: value });
  const setError = (value: string | null) => patchDraft({ error: value });
  const setSending = (value: boolean) => patchDraft({ sending: value });
  function setRecipients(value: SetStateAction<Recipients>) {
    if (!activeId) return;
    setDrafts((previous) => ({ ...previous, [activeId]: {
      ...draft, ...previous[activeId],
      recipients: typeof value === 'function' ? value(previous[activeId]?.recipients ?? 'all') : value,
    } }));
  }
  const [botEditor, setBotEditor] = useState<{ bot?: Bot; returnTo: 'manage' | 'conversation' | 'members' } | null>(null);
  function closeBotEditor() {
    if (botEditor?.returnTo === 'manage') setShowBotManager(true);
    if (botEditor?.returnTo === 'members') setShowMemberManager(true);
    setBotEditor(null);
  }
  const [showBotManager, setShowBotManager] = useState(false);
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [showMemberManager, setShowMemberManager] = useState(false);
  const [selectingMembers, setSelectingMembers] = useState(false);
  const [showReviewConfirm, setShowReviewConfirm] = useState(false);
  const [showGroupDetails, setShowGroupDetails] = useState(() => window.innerWidth > 900);
  const [showSummaryPicker, setShowSummaryPicker] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [mentionCursor, setMentionCursor] = useState<number | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const hasContentPage = Boolean(botEditor || showBotManager || showNewConversation || showMemberManager || showReviewConfirm || showSummaryPicker);
  function closeContentPages() {
    setBotEditor(null);
    setShowBotManager(false);
    setShowNewConversation(false);
    setShowMemberManager(false);
    setSelectingMembers(false);
    setShowReviewConfirm(false);
    setShowSummaryPicker(false);
  }


  const reloadState = useCallback(async () => {
    const next = await window.electronAPI.getConversationState();
    setState(next);
    return next;
  }, []);

  const reloadConversation = useCallback(async (id: string) => {
    const revision = ++viewRevision.current;
    const next = await window.electronAPI.getConversation(id);
    if (next && mounted.current && activeIdRef.current === id && revision === viewRevision.current) {
      setConversation((previous) => {
        if (previous?.id !== id) return next;
        const latest = new Map(previous.messages.map((message) => [message.id, message]));
        return { ...next, messages: next.messages.map((message) => latest.get(message.id) ?? message) };
      });
    }
    return next;
  }, [setConversation]);

  useEffect(() => {
    void reloadState().then((next) => {
      if (!mounted.current || activeIdRef.current) return;
      if (next.conversations.length) {
        setActiveId(next.conversations[0].id);
      } else if (next.bots.length) {
        setShowNewConversation(true);
      } else {
        setBotEditor({ returnTo: 'conversation' });
      }
    });
  }, [reloadState, setActiveId]);

  useEffect(() => {
    if (!activeId) {
      setConversation(null);
      return;
    }
    void reloadConversation(activeId);
  }, [activeId, reloadConversation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [conversation?.messages.length]);

  useEffect(() => {
    const removeDelta = window.electronAPI.onConversationMessageDelta((payload) => {
      setConversation((prev) => {
        if (!prev || prev.id !== payload.conversationId) {
          return prev;
        }
        const index = prev.messages.findIndex((message) => message.id === payload.messageId);
        if (index < 0) {
          return prev;
        }
        const messages = [...prev.messages];
        const existing = messages[index];
        messages[index] = {
          ...existing,
          content: payload.content || existing.content,
          activity: payload.done ? undefined : payload.activity ?? existing.activity,
          status: payload.done ? (payload.status ?? 'completed') : 'streaming',
          error: payload.error,
          elapsedMs: payload.elapsedMs ?? existing.elapsedMs,
        };
        return { ...prev, messages };
      });
    });

    const removeRoundStatus = window.electronAPI.onConversationRoundStatus((payload) => {
      setRoundStatuses((prev) => ({ ...prev, [payload.conversationId]: payload }));
      if (payload.conversationId === activeIdRef.current) {
        viewRevision.current++;
        if (payload.conversation) setConversation(payload.conversation);
      }
      if (payload.status !== 'running') void reloadState();
    });

    return () => {
      removeDelta();
      removeRoundStatus();
    };
  }, [reloadState, setConversation]);

  const runningRoundId = conversation?.runningRoundId ?? null;
  const roundStatus = activeId ? roundStatuses[activeId] : undefined;
  const isRoundRunning = Boolean(runningRoundId) || roundStatus?.status === 'running' || sending;

  const members = conversation?.members ?? [];
  let mentionedIds: string[] | null = null;
  let invalidMention = false;
  try { mentionedIds = mentionRecipients(input, members); } catch { invalidMention = true; }
  const effectiveRecipients: Recipients = mentionedIds ? new Set(mentionedIds) : recipients;
  const activeRecipientCount = effectiveRecipients === 'all' ? members.length : effectiveRecipients.size;
  const beforeCursor = mentionCursor === null ? '' : input.slice(0, mentionCursor);
  const mentionMatch = beforeCursor.match(/(?:^|[\s，,])@([^@\n]*)$/u);
  const mentionStart = mentionMatch ? beforeCursor.lastIndexOf('@') : -1;
  const mentionOptions = mentionMatch ? [
    { id: 'all', label: language === 'zh' ? '全体' : 'everyone' },
    ...members.map(member => ({ id: member.botId, label: mentionLabel(member, members) })),
  ].filter(option => option.label.toLowerCase().includes(mentionMatch[1].toLowerCase())) : [];
  function insertMention(label: string) {
    if (mentionCursor === null || mentionStart < 0) return;
    const prefix = `${input.slice(0, mentionStart)}@${label} `;
    setInput(prefix + input.slice(mentionCursor)); setMentionCursor(null);
    requestAnimationFrame(() => { composerRef.current?.focus(); composerRef.current?.setSelectionRange(prefix.length, prefix.length); });
  }

  const completedAnswerMembers = useMemo(
    () =>
      new Set(
        (conversation?.messages ?? [])
          .filter((message) => message.role === 'assistant' && message.status === 'completed')
          .map((message) => message.botId),
      ).size,
    [conversation],
  );
  const canReview = completedAnswerMembers >= 2 && !isRoundRunning && members.length > 0;
  const canSummarize = completedAnswerMembers >= 1 && !isRoundRunning;

  const rounds = useMemo(() => groupMessagesByRound(conversation?.messages ?? []), [conversation]);

  async function handleSend() {
    if (!activeId || !conversation || conversation.id !== activeId || isRoundRunning) {
      return;
    }
    const content = input.trim();
    if (!content) {
      return;
    }
    if (invalidMention) { setError(t('botChat.coordination.invalidMention')); return; }
    setMentionCursor(null);
    setError(null);
    setSending(true);
    patchDraft({ input: '', quote: null, recipients: 'all' });
    try {
      if (!conversation.title) {
        await window.electronAPI.updateConversation({
          id: conversation.id,
          title: content.slice(0, 30),
        });
      }
      await window.electronAPI.sendConversationMessage({
        conversationId: conversation.id,
        content,
        botIds: effectiveRecipients === 'all' ? undefined : [...effectiveRecipients],
        quotedMessageId: quote?.messageId,
      });
      void reloadState();
    } catch (sendError) {
      setDrafts((previous) => previous[activeId]?.input === '' ? {
        ...previous, [activeId]: { ...previous[activeId], input, quote, recipients },
      } : previous);
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setSending(false);
    }
  }

  async function handleStopRound() {
    if (!activeId) {
      return;
    }
    await window.electronAPI.stopConversationRound({ conversationId: activeId });
  }

  async function handleStopMember(botId: string) {
    if (!activeId) {
      return;
    }
    await window.electronAPI.stopConversationMember({ conversationId: activeId, botId });
  }

  async function handleRetry(botId: string, messageId: string) {
    if (!activeId || isRoundRunning) {
      return;
    }
    setError(null);
    setSending(true);
    try {
      await window.electronAPI.retryConversationMember({ conversationId: activeId, botId, messageId });
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      const kind = botErrorKind(message);
      setError(kind ? t(`botChat.runtime.errors.${kind}`) : message);
    } finally {
      setSending(false);
    }
  }

  async function handleReview() {
    if (!activeId) {
      return;
    }
    setShowReviewConfirm(false);
    setError(null);
    setSending(true);
    try {
      await window.electronAPI.requestConversationReview({ conversationId: activeId });
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    } finally {
      setSending(false);
    }
  }

  async function handleSummary(botId: string) {
    if (!activeId) {
      return;
    }
    setShowSummaryPicker(false);
    setError(null);
    setSending(true);
    try {
      await window.electronAPI.requestConversationSummary({ conversationId: activeId, botId });
    } catch (summaryError) {
      setError(summaryError instanceof Error ? summaryError.message : String(summaryError));
    } finally {
      setSending(false);
    }
  }

  function handleQuote(message: ConversationMessage) {
    setQuote({
      messageId: message.id,
      botName: message.botSnapshotName,
      content: message.content,
    });
    setRecipients(new Set([message.botId ?? '']));
  }

  function handleDeleteConversation(id: string) {
    if (!window.confirm(t('botChat.confirm.deleteConversation'))) {
      return;
    }
    void window.electronAPI.deleteConversation(id).then(() => {
      void reloadState().then((next) => {
        if (activeId === id) {
          setActiveId(next.conversations[0]?.id ?? null);
        }
      });
    });
  }

  return (
    <div className={`bot-chat${showGroupDetails && !hasContentPage && conversation ? ' group-details-open' : ''}`} data-language={language}>
      <aside className="bot-chat-sidebar">
        <div className="bot-chat-sidebar-actions">
          <button className="bot-chat-primary-button" aria-current={showNewConversation ? 'page' : undefined} onClick={() => { closeContentPages(); state?.bots.length ? setShowNewConversation(true) : setBotEditor({ returnTo: 'conversation' }); }}>
            <WorkspaceIcon name="plus" />
            {t('botChat.actions.newConversation')}
          </button>
          <button className="bot-chat-secondary-button" aria-current={botEditor ? 'page' : undefined} onClick={() => { closeContentPages(); setBotEditor({ returnTo: 'conversation' }); }}>
            <WorkspaceIcon name="plus" />{t('botChat.bots.createTitle')}
          </button>
          <button className="bot-chat-secondary-button" aria-current={showBotManager ? 'page' : undefined} onClick={() => { closeContentPages(); setShowBotManager(true); }}>
            <WorkspaceIcon name="settings" />
            {t('botChat.actions.manageBots')}
          </button>
        </div>
        <div className="bot-chat-conversation-list">
          {(state?.conversations ?? []).map((item) => (
            <ConversationListItem
              key={item.id}
              item={{ ...item, lastMessage: item.id === activeId && previews[item.id] !== undefined ? previews[item.id] : item.lastMessage !== undefined ? item.lastMessage : previews[item.id] }}
              active={!hasContentPage && item.id === activeId}
              running={roundStatuses[item.id]?.status === 'running'}
              onSelect={() => { closeContentPages(); setActiveId(item.id); }}
              onDelete={() => handleDeleteConversation(item.id)}
            />
          ))}
          {state && state.conversations.length === 0 && (
            <p className="bot-chat-empty-hint">{t('botChat.list.empty')}</p>
          )}
        </div>
      </aside>

      <section className="bot-chat-main">
        {!hasContentPage && <>
        {conversation ? (
          <>
            <header className="bot-chat-header">
              <div className="bot-chat-header-title">
                <GroupAvatar conversation={conversation} />
                <h2>{conversation.title || t('botChat.list.untitled')}</h2>
              </div>
              <button className="bot-chat-secondary-button bot-group-details-toggle" aria-expanded={showGroupDetails} onClick={() => setShowGroupDetails(value => !value)}>{t('botChat.group.details')}</button>
            </header>
            {conversation.coordinationPhase && <div className="bot-coordination-progress" role="status">{t(`botChat.coordination.${conversation.coordinationPhase}`)}</div>}

            <div className="bot-chat-transcript">
              {rounds.map((round, index) => (
                <div className="bot-chat-round" key={`${round.roundId}-${index}`}>
                  {round.type !== 'normal' && (
                    <div className={`bot-chat-round-badge bot-chat-round-badge-${round.type}`}>
                      {t(`botChat.round.${round.type}`)}
                    </div>
                  )}
                  {round.messages.map((message) =>
                    message.role === 'user' ? (
                      <UserBubble key={message.id} message={message} />
                    ) : (
                      <MemberBubble
                        key={message.id}
                        message={message}
                        member={members.find((member) => member.botId === message.botId)}
                        platform={message.botSnapshotSource || t('botChat.runtime.unknownSource')}
                        stopped={roundStatus?.status === 'running' ? isMemberStreaming(conversation, message.botId ?? '') : false}
                        onQuote={() => handleQuote(message)}
                        onStop={() => message.botId && void handleStopMember(message.botId)}
                        onRetry={() => message.botId && void handleRetry(message.botId, message.id)}
                      />
                    ),
                  )}
                </div>
              ))}
              {rounds.length === 0 && (
                <p className="bot-chat-empty-hint">{t('botChat.transcript.empty')}</p>
              )}
              <div ref={messagesEndRef} />
            </div>

            {error && (
              <div className="bot-chat-error" role="alert">
                {error}
              </div>
            )}
            {quote && (
              <div className="bot-chat-quote-preview">
                <span>{t('botChat.quote.label', { name: quote.botName })}</span>
                <button onClick={() => setQuote(null)}>{t('botChat.quote.remove')}</button>
              </div>
            )}

            <footer className="bot-chat-composer">
              {mentionOptions.length > 0 && <div className="bot-mention-options" role="listbox" id="bot-mention-options" aria-label={t('botChat.coordination.mention')}>
                {mentionOptions.map((option, index) => <button key={option.id} id={`bot-mention-${index}`} role="option" aria-selected={index === mentionIndex}
                  className={index === mentionIndex ? 'active' : ''} onMouseDown={event => event.preventDefault()} onClick={() => insertMention(option.label)}>@{option.label}</button>)}
              </div>}
              <textarea
                ref={composerRef}
                aria-controls={mentionOptions.length ? 'bot-mention-options' : undefined}
                aria-activedescendant={mentionOptions.length ? `bot-mention-${Math.min(mentionIndex, mentionOptions.length - 1)}` : undefined}
                value={input}
                placeholder={t('botChat.composer.placeholder')}
                onChange={(event) => { setInput(event.target.value); setMentionCursor(event.target.selectionStart); setMentionIndex(0); }}
                onClick={event => { setMentionCursor(event.currentTarget.selectionStart); setMentionIndex(0); }}
                onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (mentionOptions.length && !event.nativeEvent.isComposing) {
                    if (event.key === 'Escape') { event.preventDefault(); setMentionCursor(null); return; }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setMentionIndex(index => (index + (event.key === 'ArrowDown' ? 1 : mentionOptions.length - 1)) % mentionOptions.length); return; }
                    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); insertMention(mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)].label); return; }
                  }
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                rows={3}
              />
              <div className="bot-chat-composer-actions">
                <span className="bot-chat-recipient-summary">
                  {members.length === 1
                    ? t('botChat.composer.sendToSelected', { names: members[0].name })
                    : effectiveRecipients === 'all' && conversation.coordinatorId
                    ? t('botChat.coordination.automatic', { name: members.find(member => member.botId === conversation.coordinatorId)?.name })
                    : effectiveRecipients === 'all'
                    ? t('botChat.composer.sendToAll', { count: members.length })
                    : t('botChat.composer.sendToSelected', {
                        names: members
                          .filter((member) => effectiveRecipients.has(member.botId))
                          .map((member) => member.name)
                          .join(', ') || t('botChat.composer.none'),
                      })}
                </span>
                <div className="bot-chat-composer-buttons">
                  {isRoundRunning ? (
                    <button className="bot-chat-stop-button" onClick={() => void handleStopRound()}>
                      {t('botChat.composer.stop')}
                    </button>
                  ) : (
                    <>
                      {members.length > 1 && <button
                        className="bot-chat-secondary-button"
                        disabled={!canReview}
                        onClick={() => setShowReviewConfirm(true)}
                      >
                        {t('botChat.composer.review')}
                      </button>}
                      <button
                        className="bot-chat-secondary-button"
                        disabled={!canSummarize}
                        onClick={() => setShowSummaryPicker(true)}
                      >
                        {t('botChat.composer.summary')}
                      </button>
                      <button
                        className="bot-chat-primary-button"
                        disabled={!input.trim() || activeRecipientCount === 0}
                        onClick={() => void handleSend()}
                      >
                        {t('botChat.composer.send')}
                        <WorkspaceIcon name="send" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </footer>
          </>
        ) : (
          (
            <div className="bot-chat-placeholder">
              <p>{t('botChat.list.pickOrchestra')}</p>
            </div>
          )
        )}
        </>}

      {showBotManager && (
        <BotManagerPage
          bots={state?.bots ?? []}
          platform={t('botChat.runtime.unknownSource')}
          onClose={() => setShowBotManager(false)}
          onChanged={reloadState}
          onChat={async (bot) => {
            const created = await window.electronAPI.createConversation({ botIds: [bot.id] });
            await reloadState(); setActiveId(created.id); setConversation(created); setShowBotManager(false);
          }}
          onCreate={() => { setShowBotManager(false); setBotEditor({ returnTo: 'manage' }); }}
          onEdit={(bot) => { setShowBotManager(false); setBotEditor({ bot, returnTo: 'manage' }); }}
          onNewConversation={() => { setShowBotManager(false); setShowNewConversation(true); }}
        />
      )}
      {botEditor && <BotEditorPage key={botEditor.bot?.id ?? 'new'} bot={botEditor.bot}
        onClose={closeBotEditor} onSaved={async () => { await reloadState(); closeBotEditor(); }} />}
      {showNewConversation && (
        <NewConversationPage
          bots={state?.bots ?? []}
          onClose={() => setShowNewConversation(false)}
          onCreated={(id) => {
            setShowNewConversation(false);
            void reloadState().then(() => setActiveId(id));
          }}
        />
      )}
      {showMemberManager && conversation && (
        <MemberManagerPage
          conversation={conversation}
          selecting={selectingMembers}
          onSelecting={setSelectingMembers}
          bots={state?.bots ?? []}
          onClose={() => setShowMemberManager(false)}
          onCreateBot={() => { setShowMemberManager(false); setBotEditor({ returnTo: 'members' }); }}
          onChanged={async () => { await Promise.all([reloadConversation(conversation.id), reloadState()]); }}
        />
      )}
      {showReviewConfirm && conversation && (
        <div className="bot-content-page">
          <div className="bot-chat-modal bot-participant-page">
            <h3>{t('botChat.review.title')}</h3>
            <p className="bot-chat-modal-hint">{t('botChat.review.participants', { count: members.length, requests: members.length })}</p>
            <ul className="bot-participant-list">
              {members.map((member) => (
                <li key={member.botId} className="bot-participant-chip">
                  <BotAvatar {...member} /><span>{member.name}</span>
                </li>
              ))}
            </ul>
            <div className="bot-chat-modal-actions">
              <button className="bot-chat-secondary-button" onClick={() => setShowReviewConfirm(false)}>
                {t('botChat.actions.cancel')}
              </button>
              <button className="bot-chat-primary-button" onClick={() => void handleReview()}>
                {t('botChat.review.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showSummaryPicker && conversation && (
        <div className="bot-content-page">
          <div className="bot-chat-modal bot-participant-page">
            <h3>{t('botChat.summary.title')}</h3>
            <div className="bot-chat-summary-options bot-participant-list">
              {members.map((member) => (
                <button
                  key={member.botId}
                  className="bot-chat-secondary-button bot-participant-chip"
                  onClick={() => void handleSummary(member.botId)}
                >
                  <BotAvatar {...member} /><span>{member.name}</span>
                </button>
              ))}
            </div>
            <div className="bot-chat-modal-actions">
              <button className="bot-chat-secondary-button" onClick={() => setShowSummaryPicker(false)}>
                {t('botChat.actions.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
      </section>
      {!hasContentPage && conversation && showGroupDetails && <GroupDetails key={conversation.id} conversation={conversation} running={isRoundRunning}
        onClose={() => setShowGroupDetails(false)}
        onManage={() => { void reloadState(); setSelectingMembers(false); setShowMemberManager(true); }}
        onSaved={async () => { await Promise.all([reloadConversation(conversation.id), reloadState()]); }} />}
    </div>
  );
}

// --- 子组件 ---------------------------------------------------------------

function ConversationListItem({
  item,
  active,
  running,
  onSelect,
  onDelete,
}: {
  item: ConversationSummary;
  active: boolean;
  running: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`bot-chat-conversation-item${active ? ' active' : ''}`} onClick={onSelect} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(); } }} role="button" tabIndex={0}>
      <GroupAvatar conversation={item} />
      <div className="bot-chat-conversation-item-main">
        <div className="bot-group-list-heading"><span className="bot-chat-conversation-item-title">{item.title || t('botChat.list.untitled')}</span><time>{new Date(item.lastActivityAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</time></div>
        <span className="bot-chat-conversation-item-meta">
          {running ? t('botChat.list.running') : item.lastMessage?.content ? `${item.lastMessage.name ? `${item.lastMessage.name}: ` : ''}${item.lastMessage.content}` : item.lastMessage === null ? t('botChat.transcript.empty') : t('botChat.list.memberCount', { count: item.members.length })}
        </span>
      </div>
      <button
        className="bot-chat-icon-button"
        aria-label={t('botChat.actions.deleteConversation')}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        <WorkspaceIcon name="close" />
      </button>
    </div>
  );
}

function UserBubble({ message }: { message: ConversationMessage }) {
  return (
    <div className="bot-chat-user-bubble">
      {message.content}
    </div>
  );
}

function MemberBubble({
  message,
  member,
  platform,
  stopped,
  onQuote,
  onStop,
  onRetry,
}: {
  message: ConversationMessage;
  member?: ConversationMember;
  platform: string;
  stopped: boolean;
  onQuote: () => void;
  onStop: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const errorKind = message.error ? botErrorKind(message.error) : null;
  const retryable =
    !stopped && errorKind !== 'coordination-failed' && errorKind !== 'coordination-credentials' &&
    (message.status === 'failed' || message.status === 'stopped' || message.status === 'interrupted');

  return (
    <div className={`bot-chat-member-bubble status-${message.status}`}>
      <div className="bot-chat-member-bubble-header">
        <BotAvatar avatar={member?.avatar} connection={member?.connection} model={message.botSnapshotModel} name={message.botSnapshotName || 'Bot'} />
        <span className="bot-chat-member-bubble-name">{message.botSnapshotName}</span>
        <span className="bot-chat-member-bubble-model" title={`${platform} · ${message.botSnapshotModel}`}>
          {message.botSnapshotModel} · {platform}
        </span>
        <span className={`bot-chat-message-status status-${message.status}`}>
          {message.status === 'streaming' && message.activity ? t(`botChat.activity.${message.activity}`) : t(`botChat.status.${message.status}`)}
        </span>
      </div>
      <div className="bot-chat-member-bubble-content">
        {message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href) void window.electronAPI.openConversationLink(href).catch(() => {}); }}>{children}</a>,
          img: ({ alt }) => <span>{alt}</span>,
        }}>{message.content}</ReactMarkdown> : message.status === 'streaming' ? t(message.activity ? `botChat.activity.${message.activity}` : 'botChat.status.pending') : ''}
      </div>
      {message.error && <div className="bot-chat-member-bubble-error">{errorKind ? <>
        {errorKind === 'local-auth' ? <AgentAuthHelp source={message.botSnapshotSource} connection={member?.connection} /> : <p>{t(`botChat.runtime.errors.${errorKind}`)}</p>}
        <details><summary>{t('botChat.runtime.errorDetails')}</summary>{message.error}</details>
      </> : message.error}</div>}
      <div className="bot-chat-member-bubble-actions">
        {message.status === 'completed' && (
          <button className="bot-chat-icon-button" onClick={() => void navigator.clipboard.writeText(message.content)}>
            {t('botChat.actions.copy')}
          </button>
        )}
        {message.status === 'completed' && (
          <button className="bot-chat-icon-button" onClick={onQuote}>
            {t('botChat.actions.quote')}
          </button>
        )}
        {message.status === 'streaming' && stopped && (
          <button className="bot-chat-icon-button" onClick={onStop}>
            {t('botChat.actions.stopMember')}
          </button>
        )}
        {retryable && (
          <button className="bot-chat-icon-button" onClick={onRetry}>
            {t('botChat.actions.retry')}
          </button>
        )}
        {typeof message.elapsedMs === 'number' && message.status === 'completed' && (
          <span className="bot-chat-elapsed">{(message.elapsedMs / 1000).toFixed(1)}s</span>
        )}
      </div>
    </div>
  );
}

function NewConversationPage({
  bots,
  onClose,
  onCreated,
}: {
  bots: Bot[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function create() {
    setError(null);
    try {
      const conversation = await window.electronAPI.createConversation({
        title: title.trim(),
        botIds: [...selected],
      });
      onCreated(conversation.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    }
  }

  return (
    <div className="bot-content-page">
      <div className="bot-chat-modal">
        <h3>{t('botChat.newConversation.title')}</h3>
        <label>
          {t('botChat.newConversation.titleLabel')}
          <input
            value={title}
            placeholder={t('botChat.newConversation.titlePlaceholder')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <p className="bot-chat-modal-hint">{t('botChat.newConversation.pickHint')}</p>
        <div className="bot-chat-bot-checklist">
          {bots.map((bot) => (
            <label key={bot.id} className={`bot-chat-bot-check${selected.has(bot.id) ? ' checked' : ''}`}>
              <input type="checkbox" checked={selected.has(bot.id)} onChange={() => toggle(bot.id)} />
              <BotAvatar {...bot} />
              <span className="bot-chat-bot-check-details">
                <span>{bot.name}</span>
                <span className="bot-chat-bot-item-model">{botConnectionLabel(bot.connection)} · {bot.model || t('botChat.runtime.defaultModel')}</span>
              </span>
            </label>
          ))}
          {bots.length === 0 && <p className="bot-chat-empty-hint">{t('botChat.bots.empty')}</p>}
        </div>
        {error && <div className="bot-chat-error">{error}</div>}
        <div className="bot-chat-modal-actions">
          <button className="bot-chat-secondary-button" onClick={onClose}>
            {t('botChat.actions.cancel')}
          </button>
          <button className="bot-chat-primary-button" disabled={selected.size === 0} onClick={() => void create()}>
            {t('botChat.actions.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberManagerPage({ conversation, bots, selecting, onSelecting, onClose, onChanged, onCreateBot }: {
  conversation: Conversation; bots: Bot[]; selecting: boolean; onSelecting: (value: boolean) => void;
  onClose: () => void; onChanged: () => void | Promise<unknown>; onCreateBot: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const memberIds = new Set(conversation.members.map((member) => member.botId));
  const addable = bots.filter((bot) => !memberIds.has(bot.id));
  async function add() {
    if (busy || !selected.size) return;
    setBusy(true); setError(null);
    try {
      await window.electronAPI.addConversationMembers({ conversationId: conversation.id, botIds: addable.filter((bot) => selected.has(bot.id)).map((bot) => bot.id) });
      await onChanged(); setSelected(new Set()); onSelecting(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function remove(botId: string) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await window.electronAPI.removeConversationMember({ conversationId: conversation.id, botId }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="bot-content-page">
    <div className={`bot-chat-modal ${selecting ? 'bot-member-picker' : 'bot-member-manager'}`} role="region" aria-label={t(selecting ? 'botChat.members.addHint' : 'botChat.members.title')}>
      <h3>{t(selecting ? 'botChat.members.addHint' : 'botChat.members.title')}</h3>
      {selecting ? <div className="bot-chat-member-add">
        {addable.length ? <div className="bot-chat-bot-checklist">{addable.map((bot) => <label key={bot.id} className={`bot-chat-bot-check${selected.has(bot.id) ? ' checked' : ''}`}>
          <input type="checkbox" disabled={busy} checked={selected.has(bot.id)} onChange={() => setSelected((previous) => { const next = new Set(previous); if (next.has(bot.id)) next.delete(bot.id); else next.add(bot.id); return next; })} />
          <BotAvatar {...bot} /><span className="bot-chat-bot-check-details"><span>{bot.name}</span></span>
        </label>)}</div> : <>
          <p className="bot-chat-modal-hint">{t('botChat.members.noAvailable')}</p>
          <button className="bot-chat-secondary-button" onClick={onCreateBot}>+ {t('botChat.bots.createTitle')}</button>
        </>}
      </div> : <>
        {conversation.members.map((member) => <div className="bot-chat-member-edit" key={member.botId}>
          <div className="bot-chat-member-edit-row">
            <BotAvatar {...member} /><strong>{member.name}</strong>
            <button className="bot-chat-icon-button" disabled={busy} onClick={() => void remove(member.botId)}>{t('botChat.actions.removeMember')}</button>
          </div>
        </div>)}
        <button className="bot-chat-secondary-button" disabled={busy} onClick={() => { setError(null); setSelected(new Set()); onSelecting(true); }}>+ {t('botChat.members.addHint')}</button>
      </>}
      {error && <div className="bot-chat-error" role="alert">{error}</div>}
      <div className="bot-chat-modal-actions">
        {selecting ? <>
          <button className="bot-chat-secondary-button" disabled={busy} onClick={() => { setError(null); onSelecting(false); }}>{t('botChat.actions.cancel')}</button>
          {addable.length > 0 && <button className="bot-chat-primary-button" disabled={busy || !selected.size} onClick={() => void add()}>{t('botChat.members.addHint')}</button>}
        </> : <button className="bot-chat-primary-button" disabled={busy} onClick={onClose}>{t('botChat.actions.done')}</button>}
      </div>
    </div>
  </div>;
}

// --- 工具函数 --------------------------------------------------------------

interface RoundGroup {
  roundId: string;
  type: 'normal' | 'review' | 'summary';
  messages: ConversationMessage[];
}

function groupMessagesByRound(messages: ConversationMessage[]): RoundGroup[] {
  const rounds: RoundGroup[] = [];
  for (const message of messages) {
    const last = rounds[rounds.length - 1];
    if (last && last.roundId === message.roundId) {
      // Retries keep their persisted attempts, but replace the visible answer in place.
      const previousAttempt = message.role === 'assistant' && message.botId
        ? last.messages.findIndex((item) => item.role === 'assistant' && item.botId === message.botId)
        : -1;
      if (previousAttempt >= 0) last.messages[previousAttempt] = message;
      else last.messages.push(message);
      if (message.messageType !== 'normal') {
        last.type = message.messageType;
      }
    } else {
      rounds.push({ roundId: message.roundId, type: message.messageType, messages: [message] });
    }
  }
  return rounds;
}

function isMemberStreaming(conversation: Conversation, botId: string): boolean {
  return conversation.messages.some(
    (message) => message.botId === botId && message.status === 'streaming',
  );
}

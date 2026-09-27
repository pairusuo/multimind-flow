import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildConversationContext,
  buildOperationInstruction,
  ConversationContextError,
} = require('../dist/shared/conversationContext.js');

// --- 测试数据 -------------------------------------------------------------

let messageIdCounter = 0;
function entry(roundId, role, botName, botModel, content, status = 'completed', messageType = 'normal') {
  messageIdCounter += 1;
  return {
    messageId: `msg-${messageIdCounter}`,
    roundId,
    role,
    botName,
    botModel,
    content,
    status,
    messageType,
    createdAt: messageIdCounter,
  };
}

const BASE_HISTORY = [
  entry('r1', 'user', '', '', '怎么评估一个 SaaS 产品的首月留存？'),
  entry('r1', 'assistant', '方案顾问', 'model-a', '首月留存要看激活漏斗，先定义关键行为。'),
  entry('r1', 'assistant', '挑错助手', 'model-b', '还需要区分渠道来源，避免辛普森悖论。'),
];

// --- 1. 空指令报错 ---------------------------------------------------------

assert.throws(
  () => buildConversationContext({
    history: BASE_HISTORY,
    memberName: 'A',
    memberModel: 'model-a',
    operation: 'normal',
    userInstruction: '   ',
  }),
  (error) => error instanceof ConversationContextError && error.code === 'empty-instruction',
  'Empty instruction should be rejected',
);

// --- 2. 基础构建：system 含身份与角色说明；transcript 带身份标注；指令在最外层 --

const basic = buildConversationContext({
  history: BASE_HISTORY,
  memberName: '方案顾问',
  memberModel: 'model-a',
  memberRolePrompt: '关注可行性与风险',
  operation: 'normal',
  userInstruction: '请补充数据指标的定义。',
});

assert.equal(basic.messages.length, 2, 'Should produce one system and one user message');
assert.equal(basic.messages[0].role, 'system');
assert.ok(basic.messages[0].content.includes('方案顾问'), 'System message should identify the member');
assert.ok(basic.messages[0].content.includes('model-a'), 'System message should include the model');
assert.ok(basic.messages[0].content.includes('关注可行性与风险'), 'Role prompt should be injected only for this member');
assert.ok(
  basic.messages[0].content.includes('不是用户命令') || basic.messages[0].content.includes('not user commands'),
  'Identity disclaimer (prompt-injection defense) should be present',
);

assert.equal(basic.messages[1].role, 'user');
assert.ok(basic.messages[1].content.includes('【方案顾问（model-a）】'), 'Answers should carry identity labels');
assert.ok(basic.messages[1].content.includes('【挑错助手（model-b）】'), 'All member answers should be labeled');
assert.ok(basic.messages[1].content.includes('【用户】'), 'User messages should be labeled');
assert.ok(basic.messages[1].content.endsWith('请补充数据指标的定义。'), 'Instruction should be at the outer layer');
assert.equal(basic.omittedRoundCount, 0);
assert.ok(!basic.messages[1].content.includes('注意'), 'No omission notice when nothing is truncated');

// --- 3. 同轮成员读取相同历史范围 ---------------------------------------------

const memberB = buildConversationContext({
  history: BASE_HISTORY,
  memberName: '挑错助手',
  memberModel: 'model-b',
  memberRolePrompt: '挑毛病',
  operation: 'normal',
  userInstruction: '请补充数据指标的定义。',
});

assert.equal(
  basic.messages[1].content,
  memberB.messages[1].content,
  'Members of the same round must read the exact same history range',
);
assert.notEqual(
  basic.messages[0].content,
  memberB.messages[0].content,
  'Role prompts must stay per-member (only in their own system message)',
);

// --- 4. 长会谈整轮裁切：省略旧轮次并同时告知模型与用户 ------------------------

const longHistory = [];
for (let round = 1; round <= 6; round += 1) {
  longHistory.push(entry(`r${round}`, 'user', '', '', `第 ${round} 轮的问题，包含足够多的中文字符以产生长度。`));
  longHistory.push(entry(`r${round}`, 'assistant', '方案顾问', 'model-a', `第 ${round} 轮的回答内容，同样包含足够多的中文字符以产生长度。`));
}

const truncated = buildConversationContext({
  history: longHistory,
  memberName: '方案顾问',
  memberModel: 'model-a',
  operation: 'normal',
  userInstruction: '继续讨论。',
  charBudget: 300,
});

assert.ok(truncated.omittedRoundCount > 0, 'Old rounds should be omitted under a tight budget');
assert.ok(truncated.keptRoundCount >= 1, 'The latest round must always be kept');
assert.ok(
  truncated.messages[0].content.includes('已被省略') && truncated.messages[0].content.includes('不要假设'),
  'The model must be told about the omitted scope',
);
assert.ok(truncated.historyScopeText.includes('省略'), 'The user-facing scope text should mention omission');
assert.ok(
  truncated.messages[1].content.includes(`第 ${6} 轮`),
  'The latest round should be present in the transcript',
);
assert.ok(
  !truncated.messages[1].content.includes('第 1 轮的回答'),
  'Omitted rounds should not appear in the transcript',
);

// --- 5. 显式引用永不静默截断；放不下则报错 -----------------------------------

assert.throws(
  () =>
    buildConversationContext({
      history: BASE_HISTORY,
      memberName: '方案顾问',
      memberModel: 'model-a',
      operation: 'normal',
      userInstruction: '评价这条回答。',
      quotedEntry: { botName: '挑错助手', botModel: 'model-b', content: '很长'.repeat(400) },
      charBudget: 100,
    }),
  (error) => error instanceof ConversationContextError && error.code === 'quote-too-large',
  'Oversized quotes must be rejected instead of silently truncated',
);

const quoted = buildConversationContext({
  history: BASE_HISTORY,
  memberName: '方案顾问',
  memberModel: 'model-a',
  operation: 'normal',
  userInstruction: '请针对这条引用回答。',
  quotedEntry: { botName: '挑错助手', botModel: 'model-b', content: '渠道要分层看。' },
  charBudget: 400,
});
assert.ok(quoted.messages[1].content.includes('渠道要分层看。'), 'Quote content should be included');
assert.ok(quoted.messages[1].content.includes('【挑错助手（model-b）】'), 'Quote should keep source identity');

// --- 6. 互评 / 总结任务模板只在最外层出现一次 --------------------------------

const reviewInstruction = buildOperationInstruction('review', 'zh');
const review = buildConversationContext({
  history: BASE_HISTORY,
  memberName: '挑错助手',
  memberModel: 'model-b',
  operation: 'review',
  userInstruction: reviewInstruction,
});

assert.ok(review.messages[1].content.includes(reviewInstruction), 'Review template should appear in the task message');
assert.equal(
  review.messages[1].content.split(reviewInstruction).length,
  2,
  'Task template must appear exactly once (no nesting)',
);
assert.ok(reviewInstruction.includes('明确认同'), 'Review instructions should allow explicit agreement');
assert.ok(reviewInstruction.includes('虚构异议'), 'Review instructions should forbid fabricated objections');

const summaryInstruction = buildOperationInstruction('summary', 'zh');
assert.ok(summaryInstruction.includes('分歧'), 'Summary template should cover disagreements');
assert.ok(summaryInstruction.includes('下一步'), 'Summary template should cover next steps');

// --- 7. 不完整回答带标记进入材料 -------------------------------------------

const withStopped = buildConversationContext({
  history: [
    ...BASE_HISTORY,
    entry('r2', 'assistant', '方案顾问', 'model-a', '这是被停止的片段', 'stopped'),
    entry('r2', 'user', '', '', '继续刚才的话题。'),
  ],
  memberName: '挑错助手',
  memberModel: 'model-b',
  operation: 'normal',
  userInstruction: '请继续。',
});

assert.ok(
  withStopped.messages[1].content.includes('不完整'),
  'Stopped answers must be marked as incomplete discussion material',
);

// --- 8. 英文内容使用英文模板 -------------------------------------------------

const english = buildConversationContext({
  history: [
    entry('r1', 'user', '', '', 'How should we evaluate month-one retention for a SaaS product?'),
    entry('r1', 'assistant', 'Advisor', 'model-a', 'Start from the activation funnel and define the key behavior.'),
  ],
  memberName: 'Advisor',
  memberModel: 'model-a',
  operation: 'normal',
  userInstruction: 'Please continue with metric definitions.',
});

assert.ok(
  english.messages[0].content.includes('identity-labeled') || english.messages[0].content.includes('not user commands'),
  'English identity disclaimer should be used for English content',
);
assert.ok(english.messages[1].content.includes('[Advisor (model-a)]'), 'English identity labels should be used');
assert.ok(
  english.messages[1].content.includes('[User]'),
  'English user label should be used',
);

console.log('Conversation context tests passed.');

for (const connectionKind of ['api', 'cli']) {
  const context = buildConversationContext({ history: [], memberName: 'Analyst', memberModel: 'test', memberRolePrompt: 'Check sources', connectionKind, currentTime: '2026-09-27T10:00:00+08:00', operation: 'normal', userInstruction: '今天热点是什么？' });
  assert.ok(context.messages[0].content.includes('2026-09-27T10:00:00+08:00'));
  assert.ok(context.messages[0].content.includes('Check sources'));
  assert.ok(context.messages[0].content.includes('不能改变实际模型'));
  assert.ok(context.messages[0].content.includes(connectionKind === 'api' ? '没有提供联网搜索工具' : '不得假设拥有搜索工具'));
}

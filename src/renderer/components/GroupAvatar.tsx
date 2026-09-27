import BotAvatar from './BotAvatar';
import type { ConversationSummary } from '../../shared/types';
export default function GroupAvatar({ conversation }: { conversation: Pick<ConversationSummary, 'avatar' | 'members' | 'title'> }) {
  if (conversation.avatar) return <img className="bot-group-avatar custom" src={conversation.avatar} alt="" />;
  return <span className={`bot-group-avatar count-${Math.min(conversation.members.length, 4)}`} aria-hidden="true">
    {conversation.members.slice(0, 4).map(member => <BotAvatar key={member.botId} {...member} />)}
  </span>;
}

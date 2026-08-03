import { Link } from 'react-router-dom';
import { User, FileText, Building2, CheckSquare } from 'lucide-react';
import { mentionHref } from './mentionHref';
import type { MentionRef } from './types';

const MENTION_ICONS = {
  membro: User,
  post: FileText,
  cliente: Building2,
  tarefa: CheckSquare,
} as const;

interface MentionChipProps {
  mention: MentionRef;
  className?: string;
}

/**
 * Presentational @-mention chip used OUTSIDE the TipTap editor (plain-text mention
 * tokens rendered by `MentionText`, see Task 5). Inside the editor, `MentionNode`
 * renders its own DOM directly -- this component is not used there.
 */
export function MentionChip({ mention, className }: MentionChipProps) {
  const Icon = MENTION_ICONS[mention.entityType];
  const href = mentionHref(mention);
  const chipClassName = `mention-chip mention-chip--${mention.entityType}${className ? ` ${className}` : ''}`;
  const content = (
    <>
      <Icon aria-hidden="true" className="mention-chip__icon" />
      {`@${mention.label}`}
    </>
  );

  if (href) {
    return (
      <Link to={href} className={chipClassName}>
        {content}
      </Link>
    );
  }

  return <span className={chipClassName}>{content}</span>;
}

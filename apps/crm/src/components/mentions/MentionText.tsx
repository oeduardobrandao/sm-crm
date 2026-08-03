import { Fragment } from 'react';
import { MentionChip } from './MentionChip';
import { parseMentionTokens } from './mentionTokens';

interface MentionTextProps {
  text: string;
}

/**
 * Renders a plain-text string containing `@[Label](tipo:id)` mention tokens (see
 * mentionTokens.ts) as inline text interspersed with MentionChips.
 *
 * Deliberately renders inline content only -- no wrapping `div`/`p` -- so it can drop
 * into an existing `white-space: pre-wrap` container (comment bodies, tarefa
 * descriptions) without changing that container's layout.
 */
export function MentionText({ text }: MentionTextProps) {
  const segments = parseMentionTokens(text);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'mention' ? (
          <MentionChip key={`mention-${index}`} mention={segment.ref} />
        ) : (
          <Fragment key={`text-${index}`}>{segment.value}</Fragment>
        ),
      )}
    </>
  );
}

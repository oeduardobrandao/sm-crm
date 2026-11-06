import { parseMentionTokens } from '@/components/mentions/mentionTokens';
import { PostChip } from './PostChip';
import { PostChipPhone } from '../phone/PostChipPhone';

/** More distinct posts than this and the message keeps only its inline chips. */
export const MAX_POST_BLOCKS = 3;

export interface PostBlockRef {
  postId: number;
  workflowId: number | null;
  titulo: string;
}

/** Distinct `post` mentions of a team-chat message, in order of first appearance.
 *  Empty when there are none or more than MAX_POST_BLOCKS (inline chips only). */
export function postBlocksOf(text: string): PostBlockRef[] {
  const seen = new Set<number>();
  const out: PostBlockRef[] = [];
  for (const seg of parseMentionTokens(text)) {
    if (seg.kind !== 'mention' || seg.ref.entityType !== 'post') continue;
    if (seen.has(seg.ref.id)) continue;
    seen.add(seg.ref.id);
    out.push({ postId: seg.ref.id, workflowId: seg.ref.parentId ?? null, titulo: seg.ref.label });
  }
  return out.length > MAX_POST_BLOCKS ? [] : out;
}

/** True when the message renders blocks and, once its post tokens are removed, has no
 *  text left: the inline chip then goes away and only the block shows. */
export function hideInlineText(text: string): boolean {
  if (postBlocksOf(text).length === 0) return false;
  return parseMentionTokens(text).every((seg) =>
    seg.kind === 'mention' ? seg.ref.entityType === 'post' : seg.value.trim() === '',
  );
}

interface Props {
  text: string;
  variant: 'desktop' | 'phone';
  /** Desktop only: the side of the bubble the hover card aligns to. */
  align?: 'start' | 'end';
  className?: string;
}

/** Block chips for the posts a team-chat message mentions (up to 3 distinct ones), shown
 *  below the message text. Renders nothing when there are none. */
export function PostChipsBelow({ text, variant, align = 'start', className }: Props) {
  const blocks = postBlocksOf(text);
  if (blocks.length === 0) return null;
  return (
    <div
      data-testid="post-chips-below"
      className={className ?? 'mt-2 flex min-w-0 max-w-full flex-col items-start gap-2'}
    >
      {blocks.map((b) =>
        variant === 'phone' ? (
          <PostChipPhone
            key={b.postId}
            postId={b.postId}
            workflowId={b.workflowId}
            titulo={b.titulo}
            comDiscussao
          />
        ) : (
          <PostChip
            key={b.postId}
            postId={b.postId}
            workflowId={b.workflowId}
            titulo={b.titulo}
            align={align}
            comDiscussao
          />
        ),
      )}
    </div>
  );
}

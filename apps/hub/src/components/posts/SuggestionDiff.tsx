import { useTranslation } from 'react-i18next';
import type { HubPost, PendingEditSuggestion } from '../../types';
import { deriveCaption, pickPostCardKind } from '../../lib/postView';
import { TextDiff } from '../TextDiff';

export interface SuggestionDiffBlock {
  field: 'text' | 'caption';
  before: string;
  after: string;
}

/**
 * What accepting the suggestion would change, field by field, against the LIVE post (what
 * `changed_fields` is computed against and what accept overwrites). A field only appears when
 * its plain text really differs: `changed_fields` alone also flags formatting-only or
 * null-document "changes" that accept never applies.
 */
export function suggestionDiffBlocks(
  post: HubPost,
  suggestion: PendingEditSuggestion,
): SuggestionDiffBlock[] {
  const blocks: SuggestionDiffBlock[] = [];
  const beforeText = post.conteudo_plain ?? '';
  if (
    suggestion.suggested_conteudo_plain != null &&
    suggestion.suggested_conteudo_plain !== beforeText
  ) {
    blocks.push({ field: 'text', before: beforeText, after: suggestion.suggested_conteudo_plain });
  }
  if (suggestion.suggested_ig_caption != null) {
    // Text posts edit the stored caption; media posts edit the caption the client sees, which
    // falls back to the LEGENDA part of the body when ig_caption is empty.
    const beforeCaption =
      pickPostCardKind(post) === 'text'
        ? (post.ig_caption ?? '')
        : deriveCaption(post, post.ig_caption);
    if (suggestion.suggested_ig_caption !== beforeCaption) {
      blocks.push({
        field: 'caption',
        before: beforeCaption,
        after: suggestion.suggested_ig_caption,
      });
    }
  }
  return blocks;
}

export function SuggestionDiff({
  post,
  suggestion,
}: {
  post: HubPost;
  suggestion: PendingEditSuggestion;
}) {
  const { t } = useTranslation('hubPosts');
  const blocks = suggestionDiffBlocks(post, suggestion);
  if (blocks.length === 0) {
    return (
      <p className="text-[13px] hub-tx3">
        {t('shared.suggestionNoTextDiff', 'Sem diferenças de texto em relação ao original.')}
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="suggestion-diff">
      {blocks.map((b) => (
        <section key={b.field} className="space-y-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] hub-tx3">
            {b.field === 'text'
              ? t('shared.suggestionDiffTextLabel', 'Texto do post')
              : t('shared.suggestionDiffCaptionLabel', 'Legenda')}
          </p>
          <TextDiff
            before={b.before}
            after={b.after}
            className="text-[14px] leading-[1.6] whitespace-pre-wrap hub-txt"
          />
        </section>
      ))}
    </div>
  );
}

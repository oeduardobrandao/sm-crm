import { useTranslation } from 'react-i18next';
import type { HubPost, PendingEditSuggestion } from '../../types';
import { deriveCaption, pickPostCardKind, resolvePostTargets } from '../../lib/postView';
import { canonicalDoc, docPlainText } from '../../lib/richDoc';
import { TextDiff } from '../TextDiff';

export interface SuggestionDiffBlock {
  field: 'text' | 'caption' | 'tiktok' | 'geral';
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
  if (suggestion.suggested_conteudo_plain != null) {
    // Both sides from the documents when both load, so each is the text the Hub editor
    // itself produces (see docPlainText); otherwise the stored plain texts, as before.
    const beforeDoc = docPlainText(post.conteudo);
    const afterDoc = docPlainText(suggestion.suggested_conteudo);
    const fromDocs = beforeDoc !== null && afterDoc !== null;
    const beforeText = fromDocs ? beforeDoc : (post.conteudo_plain ?? '');
    const afterText = fromDocs ? afterDoc : suggestion.suggested_conteudo_plain;
    if (afterText !== beforeText) {
      blocks.push({ field: 'text', before: beforeText, after: afterText });
    }
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
  // TikTok and Geral: only a column the suggestion changed (its stored copy of any other is the
  // value as of the client's last save, stale after a team edit). "Before" is the RAW live
  // value, the one the server compares with (COALESCE to ''), never the caption TikTok shows
  // when it follows the Instagram one.
  const changed = suggestion.changed_fields ?? [];
  const extra: [
    SuggestionDiffBlock['field'],
    string | null | undefined,
    string | null | undefined,
  ][] = [
    [
      'tiktok',
      changed.includes('tiktok_caption') ? suggestion.suggested_tiktok_caption : null,
      post.tiktok_caption,
    ],
    [
      'geral',
      changed.includes('geral_caption') ? suggestion.suggested_geral_caption : null,
      post.geral_caption,
    ],
  ];
  for (const [field, after, live] of extra) {
    if (after == null) continue;
    const before = live ?? '';
    if (after !== before) blocks.push({ field, before, after });
  }
  return blocks;
}

/**
 * The suggested rich document differs from the post's while its plain text does not (no text
 * block): bold, links, inline images. The plain-text diff can't show those, so say they exist.
 */
export function hasFormatOnlyChange(
  post: HubPost,
  suggestion: PendingEditSuggestion,
  blocks: SuggestionDiffBlock[],
): boolean {
  return (
    suggestion.suggested_conteudo != null &&
    canonicalDoc(suggestion.suggested_conteudo) !== canonicalDoc(post.conteudo) &&
    !blocks.some((b) => b.field === 'text')
  );
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
  // With other destinations, "Legenda" alone would not say which one changed.
  const targets = resolvePostTargets(post);
  const multiDestination = targets !== null && targets.some((p) => p !== 'instagram');
  const label = (field: SuggestionDiffBlock['field']) => {
    if (field === 'text') return t('shared.suggestionDiffTextLabel', 'Texto do post');
    if (field === 'tiktok') return t('captions.fieldLabel.tiktok', 'Legenda do TikTok');
    if (field === 'geral') return t('captions.fieldLabel.geral', 'Legenda Geral');
    return multiDestination
      ? t('captions.fieldLabel.instagram', 'Legenda do Instagram')
      : t('shared.suggestionDiffCaptionLabel', 'Legenda');
  };
  const formatOnlyLine = hasFormatOnlyChange(post, suggestion, blocks) ? (
    <p className="text-[13px] hub-tx3">
      {t('shared.suggestionFormatOnlyDiff', 'Alterações somente de formatação ou imagens.')}
    </p>
  ) : null;
  if (blocks.length === 0) {
    return (
      formatOnlyLine ?? (
        <p className="text-[13px] hub-tx3">
          {t('shared.suggestionNoTextDiff', 'Sem diferenças de texto em relação ao original.')}
        </p>
      )
    );
  }
  return (
    <div className="space-y-4" data-testid="suggestion-diff">
      {blocks.map((b) => (
        <section key={b.field} className="space-y-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] hub-tx3">
            {label(b.field)}
          </p>
          <TextDiff
            before={b.before}
            after={b.after}
            className="text-[14px] leading-[1.6] whitespace-pre-wrap hub-txt"
          />
        </section>
      ))}
      {formatOnlyLine}
    </div>
  );
}

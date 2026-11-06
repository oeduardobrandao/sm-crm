import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@mesaas/i18n';
import { Info, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { extractR2Keys, injectSignedUrls, resolveInlineImageUrls } from '@/services/inlineImage';
import { computeWordDiff } from '@/utils/textDiff';
import { computeTipTapDiff } from '@/utils/tiptapDiff';
import type { PostEditSuggestion } from '../../../store';
import {
  liveCaption,
  originalCaption,
  suggestedCaption,
  tiktokNoLongerFollowsIg,
  type CaptionField,
  type SuggestionField,
  type SuggestionFieldState,
  type SuggestionLivePost,
} from '../editSuggestionFields';
import { DiffView } from './DiffView';
import { ReadOnlyTipTap } from './ReadOnlyTipTap';

type DiffBase = 'live' | 'original';

/** "a, b e c" / "a, b, and c" in the UI language. */
export function joinList(items: string[]): string {
  return new Intl.ListFormat(getIntlLocale(), { style: 'long', type: 'conjunction' }).format(items);
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(getIntlLocale()) + s.slice(1);

/**
 * Names of a suggestion field. `heading`: the field's title ("Legenda do TikTok"). `inline`: with
 * its article, inside a sentence ("a legenda do TikTok"). `plain`: lower case, no article
 * ("legenda do TikTok"), for the unchanged-fields line.
 */
export function useSuggestionFieldName() {
  const { t } = useTranslation('postEditor');
  return (field: SuggestionField, form: 'heading' | 'inline' | 'plain'): string => {
    if (form === 'heading') {
      if (field === 'texto') return t('suggestionReview.postText');
      if (field === 'legenda') return t('shared.igCaption');
      if (field === 'legenda_tiktok') return t('suggestionReview.fieldNames.tiktokCaption');
      return t('suggestionReview.fieldNames.geralCaption');
    }
    if (form === 'inline') {
      if (field === 'texto') return t('suggestionReview.dialog.fieldTexto');
      if (field === 'legenda') return t('suggestionReview.dialog.fieldLegenda');
      if (field === 'legenda_tiktok') return t('suggestionReview.dialog.fieldLegendaTiktok');
      return t('suggestionReview.dialog.fieldLegendaGeral');
    }
    if (field === 'texto') return t('suggestionReview.unchangedNames.texto');
    if (field === 'legenda') return t('suggestionReview.unchangedNames.legenda');
    if (field === 'legenda_tiktok') return t('suggestionReview.unchangedNames.legendaTiktok');
    return t('suggestionReview.unchangedNames.legendaGeral');
  };
}

/** The doc with signed inline-image URLs, so a diff against `original_conteudo` shows its images. */
function useSignedDoc(doc: Record<string, unknown> | null): Record<string, unknown> | null {
  const [resolved, setResolved] = useState(doc);
  useEffect(() => {
    if (!doc) {
      setResolved(null);
      return;
    }
    const keys = extractR2Keys(doc);
    if (keys.length === 0) {
      setResolved(doc);
      return;
    }
    let cancelled = false;
    resolveInlineImageUrls(keys)
      .then((urlMap) => {
        if (!cancelled) setResolved(injectSignedUrls(doc, urlMap));
      })
      .catch(() => {
        if (!cancelled) setResolved(doc);
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);
  return resolved;
}

/**
 * The fields worth drawing: changed by the client, and for texto only when there is a doc to
 * diff (a caption-only Story suggestion stores a NULL doc but still lists `conteudo` as changed).
 */
export function visibleSuggestionStates(
  states: SuggestionFieldState[],
  resolvedContent: Record<string, unknown> | null,
  resolvedSuggestion: Record<string, unknown> | null,
): SuggestionFieldState[] {
  return states.filter(
    (st) => st.changed && (st.field !== 'texto' || (resolvedContent && resolvedSuggestion)),
  );
}

const CONFLICT_KEY: Record<SuggestionField, string> = {
  texto: 'suggestionReview.conflictTexto',
  legenda: 'suggestionReview.conflictLegenda',
  legenda_tiktok: 'suggestionReview.conflictLegendaTiktok',
  legenda_geral: 'suggestionReview.conflictLegendaGeral',
};

function FieldNote({ tone, children }: { tone: 'amber' | 'muted'; children: ReactNode }) {
  return (
    <div
      role="note"
      className={cn(
        'flex items-start gap-2 rounded-lg px-2.5 py-2 text-[12px]',
        tone === 'amber' ? 'bg-amber-100 text-amber-900' : 'bg-stone-100 text-stone-700',
      )}
    >
      {children}
    </div>
  );
}

/**
 * One field of a client suggestion: its diff and, when the team edited the field after the
 * suggestion was sent, the amber line plus the toggle between "what accepting does" (live ->
 * suggested, the default) and "what the client changed" (their base -> suggested).
 * `label` is the desktop card's field heading; the phone sheet draws its own and passes none.
 * A caption whose live value is still loading, or whose destination is gone, shows only what the
 * client changed, with a line saying why.
 */
export function SuggestionFieldDiff({
  field,
  state,
  post,
  suggestion,
  resolvedContent,
  resolvedSuggestion,
  label,
}: {
  field: SuggestionField;
  state: SuggestionFieldState;
  post: SuggestionLivePost;
  suggestion: PostEditSuggestion;
  resolvedContent: Record<string, unknown> | null;
  resolvedSuggestion: Record<string, unknown> | null;
  label?: ReactNode;
}) {
  const { t } = useTranslation('postEditor');
  const fieldName = useSuggestionFieldName();
  const [base, setBase] = useState<DiffBase>('live');
  const original = useSignedDoc(
    field === 'texto' && base === 'original' ? suggestion.original_conteudo : null,
  );

  // An old row can have no stored base for the doc: nothing to compare against.
  const canToggle = state.conflict && (field !== 'texto' || suggestion.original_conteudo != null);
  // Without a judged live value there is only the client's own change to show.
  const against: DiffBase =
    state.pending || state.gone ? 'original' : state.conflict ? base : 'live';

  let diff: ReactNode;
  if (field === 'texto') {
    const from = against === 'original' ? original : resolvedContent;
    diff =
      from && resolvedSuggestion ? (
        <ReadOnlyTipTap content={computeTipTapDiff(from, resolvedSuggestion)} />
      ) : null;
  } else {
    const captionField: CaptionField = field;
    const from =
      against === 'original'
        ? originalCaption(suggestion, captionField)
        : liveCaption(post, captionField);
    diff = (
      <DiffView
        segments={computeWordDiff(from ?? '', suggestedCaption(suggestion, captionField) ?? '')}
      />
    );
  }

  const toggle = canToggle && (
    <div
      role="group"
      aria-label={t('suggestionReview.compareAria', { field: fieldName(field, 'heading') })}
      className="flex gap-0.5 rounded-lg bg-stone-100 p-0.5"
    >
      {(['live', 'original'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={base === value}
          onClick={() => setBase(value)}
          className={cn(
            'rounded-md px-2.5 py-[3px] text-[11px] transition-colors',
            base === value
              ? 'bg-white font-semibold text-stone-900 shadow-sm'
              : 'font-medium text-stone-600 hover:text-stone-900',
          )}
        >
          {value === 'live'
            ? t('suggestionReview.diffApply')
            : t('suggestionReview.diffClientOnly')}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-2">
      {(label || toggle) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {label ?? <span />}
          {toggle}
        </div>
      )}
      {state.conflict && (
        <FieldNote tone="amber">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t(CONFLICT_KEY[field])}</span>
        </FieldNote>
      )}
      {state.pending && (
        <FieldNote tone="muted">
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span>{t('suggestionReview.geralLoading')}</span>
        </FieldNote>
      )}
      {state.gone && (
        <FieldNote tone="amber">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t('suggestionReview.geralGone')}</span>
        </FieldNote>
      )}
      {field === 'legenda' && state.changed && tiktokNoLongerFollowsIg(post, suggestion) && (
        <FieldNote tone="amber">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t('suggestionReview.tiktokFollowedIg')}</span>
        </FieldNote>
      )}
      {diff}
    </div>
  );
}

/**
 * Quiet line under the diffs: the fields the team edited that the client did NOT touch, which
 * accepting leaves alone. `teamOnly` is `teamOnlyChangedFields`.
 */
export function TeamOnlyFooter({
  teamOnly,
  className,
}: {
  teamOnly: SuggestionField[];
  className?: string;
}) {
  const { t } = useTranslation('postEditor');
  const fieldName = useSuggestionFieldName();
  if (teamOnly.length === 0) return null;
  return (
    <p
      className={cn(
        'flex items-center gap-2 rounded-lg bg-amber-100 px-2.5 py-2 text-[12px] text-amber-900',
        className,
      )}
    >
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {t('suggestionReview.footerTeamOnly', {
          count: teamOnly.length,
          fields: joinList(teamOnly.map((f) => fieldName(f, 'inline'))),
        })}
      </span>
    </p>
  );
}

/**
 * The fields the post carries that the client left as they were: "Texto do post e legenda do
 * Instagram: sem alterações do cliente." Nothing when the client changed every one of them.
 */
export function UnchangedFieldsLine({
  states,
  reviewable,
  className,
}: {
  states: SuggestionFieldState[];
  reviewable: SuggestionField[];
  className?: string;
}) {
  const { t } = useTranslation('postEditor');
  const fieldName = useSuggestionFieldName();
  const unchanged = reviewable.filter((f) => !states.find((st) => st.field === f)?.changed);
  if (unchanged.length === 0) return null;
  return (
    <p className={cn('text-[12px] text-stone-500', className)}>
      {t('suggestionReview.unchangedFields', {
        fields: capitalize(joinList(unchanged.map((f) => fieldName(f, 'plain')))),
      })}
    </p>
  );
}

/**
 * Note above a caption field while the client's pending suggestion rewrote it: editing it now
 * makes the suggestion show a conflict, so the team is pointed at the review first. Not blocking.
 */
export function CaptionSuggestionNote({
  field = 'legenda',
  onViewSuggestion,
  className,
}: {
  field?: CaptionField;
  onViewSuggestion: () => void;
  className?: string;
}) {
  const { t } = useTranslation('postEditor');
  return (
    <p
      className={cn(
        'mb-1.5 flex items-center gap-2 rounded-lg bg-amber-100 px-2.5 py-2 text-[12px] text-amber-900',
        className,
      )}
    >
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="grow">
        {t(
          field === 'legenda_tiktok'
            ? 'suggestionReview.captionNoteTiktok'
            : field === 'legenda_geral'
              ? 'suggestionReview.captionNoteGeral'
              : 'suggestionReview.captionNote',
        )}
      </span>
      <button
        type="button"
        onClick={onViewSuggestion}
        className="shrink-0 font-semibold underline underline-offset-2"
      >
        {t('suggestionReview.viewSuggestion')}
      </button>
    </p>
  );
}

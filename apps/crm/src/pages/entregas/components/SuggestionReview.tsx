import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { extractR2Keys, injectSignedUrls, resolveInlineImageUrls } from '@/services/inlineImage';
import { computeWordDiff } from '@/utils/textDiff';
import { computeTipTapDiff } from '@/utils/tiptapDiff';
import type { PostEditSuggestion, WorkflowPost } from '../../../store';
import type { SuggestionField, SuggestionFieldState } from '../editSuggestionFields';
import { DiffView } from './DiffView';
import { ReadOnlyTipTap } from './ReadOnlyTipTap';

type DiffBase = 'live' | 'original';

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

/**
 * One field of a client suggestion: its diff and, when the team edited the field after the
 * suggestion was sent, the amber line plus the toggle between "what accepting does" (live ->
 * suggested, the default) and "what the client changed" (their base -> suggested).
 * `label` is the desktop card's field heading; the phone sheet draws its own and passes none.
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
  post: Pick<WorkflowPost, 'ig_caption'>;
  suggestion: PostEditSuggestion;
  resolvedContent: Record<string, unknown> | null;
  resolvedSuggestion: Record<string, unknown> | null;
  label?: ReactNode;
}) {
  const { t } = useTranslation('postEditor');
  const [base, setBase] = useState<DiffBase>('live');
  const original = useSignedDoc(
    field === 'texto' && base === 'original' ? suggestion.original_conteudo : null,
  );

  // An old row can have no stored base for the doc: nothing to compare against.
  const canToggle = state.conflict && (field === 'legenda' || suggestion.original_conteudo != null);
  const against = state.conflict ? base : 'live';

  const diff =
    field === 'texto' ? (
      (against === 'original' ? original : resolvedContent) && resolvedSuggestion ? (
        <ReadOnlyTipTap
          content={computeTipTapDiff(
            (against === 'original' ? original : resolvedContent) as Record<string, unknown>,
            resolvedSuggestion,
          )}
        />
      ) : null
    ) : (
      <DiffView
        segments={computeWordDiff(
          (against === 'original' ? suggestion.original_ig_caption : post.ig_caption) ?? '',
          suggestion.suggested_ig_caption ?? '',
        )}
      />
    );

  const fieldName = field === 'texto' ? t('suggestionReview.postText') : t('shared.igCaption');
  const toggle = canToggle && (
    <div
      role="group"
      aria-label={t('suggestionReview.compareAria', { field: fieldName })}
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
        <div
          role="note"
          className="flex items-start gap-2 rounded-lg bg-amber-100 px-2.5 py-2 text-[12px] text-amber-900"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              field === 'texto'
                ? 'suggestionReview.conflictTexto'
                : 'suggestionReview.conflictLegenda',
            )}
          </span>
        </div>
      )}
      {diff}
    </div>
  );
}

/**
 * Quiet line under the diffs: when the team edited the one field the client did NOT touch,
 * accepting leaves it alone. `teamOnly` is `teamOnlyChangedFields`; it only reads sensibly when
 * exactly one field is team-only (the other one is what the client changed).
 */
export function TeamOnlyFooter({
  teamOnly,
  className,
}: {
  teamOnly: SuggestionField[];
  className?: string;
}) {
  const { t } = useTranslation('postEditor');
  if (teamOnly.length !== 1) return null;
  return (
    <p
      className={cn(
        'flex items-center gap-2 rounded-lg bg-amber-100 px-2.5 py-2 text-[12px] text-amber-900',
        className,
      )}
    >
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {t(
          teamOnly[0] === 'legenda'
            ? 'suggestionReview.footerOnlyTexto'
            : 'suggestionReview.footerOnlyLegenda',
        )}
      </span>
    </p>
  );
}

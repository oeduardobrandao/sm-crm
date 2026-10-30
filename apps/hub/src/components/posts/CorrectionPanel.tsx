import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle, Loader2, Save, X } from 'lucide-react';
import { captionMaxFor, type PlatformId } from '@mesaas/platforms';
import type { CorrectionReason, HubPost, SuggestionBases, SuggestionField } from '../../types';
import type { SaveErrorKind, useEditSuggestion } from '../../hooks/useEditSuggestion';
import type { PostReferencesState } from '../../hooks/usePostReferences';
import type { ReferenceItem } from '../../types/postReferences';
import { ReferencePicker } from './references/ReferencePicker';
import { ReferenceOpen, ReferenceThumb } from './references/ReferenceTiles';
import { referenceErrorMessage } from './references/referenceErrors';
import { referenceTitle } from './references/referenceFormat';
import {
  changedSuggestionFields,
  destinationCaptions,
  editCaptionGroups,
  groupCaptions,
  pickPostCardKind,
  resolvePostTargets,
  suggestionAwareCaption,
  type EditCaptionGroup,
} from '../../lib/postView';
import { canonicalDoc } from '../../lib/richDoc';
import { RichTextContent } from '../RichTextContent';
import { CorrectionReasonChips } from '../CorrectionReasonChips';
import { CaptionTabPanel, CaptionTabs, usePlatformNames } from './PlatformCaptions';

export type EditSuggestion = ReturnType<typeof useEditSuggestion>;

export type SuggestionView = 'diff' | 'suggestion' | 'original';

interface SuggestionPendingNoticeProps {
  /** The pending suggestion's `changed_fields`; only read when `onViewChange` is given. */
  changedFields?: string[];
  /** The post has a destination besides Instagram: name the Instagram caption explicitly. */
  multiDestination?: boolean;
  view?: SuggestionView;
  /** Reading view only: says which version is on screen and lets the client switch. */
  onViewChange?: (view: SuggestionView) => void;
}

/**
 * "Sugestão enviada para revisão", shown above the reading view while a suggestion is
 * pending (the panel itself stays editable through Editar sugestão). It explains the
 * disabled Aprovar, says which version the body below shows and offers an Alterações /
 * Sua sugestão / Original toggle, Alterações (the diff) being the default.
 */
export function SuggestionPendingNotice({
  changedFields = [],
  multiDestination = false,
  view = 'diff',
  onViewChange,
}: SuggestionPendingNoticeProps = {}) {
  const { t, i18n } = useTranslation('hubPosts');
  const phrase = (field: SuggestionField) => {
    if (field === 'texto') return t('shared.suggestionFieldPhrase.texto', 'no texto');
    if (field === 'legenda_tiktok')
      return t('shared.suggestionFieldPhrase.legendaTiktok', 'na legenda do TikTok');
    if (field === 'legenda_geral')
      return t('shared.suggestionFieldPhrase.legendaGeral', 'na legenda Geral');
    return multiDestination
      ? t('shared.suggestionFieldPhrase.legendaInstagram', 'na legenda do Instagram')
      : t('shared.suggestionFieldPhrase.legenda', 'na legenda');
  };
  const fields = changedSuggestionFields(changedFields);
  const fieldList = new Intl.ListFormat(i18n.language || 'pt-BR', {
    style: 'long',
    type: 'conjunction',
  }).format(fields.map(phrase));
  const detail =
    view === 'diff'
      ? t(
          'shared.suggestionShowingDiff',
          'Em vermelho o que você removeu, em verde o que acrescentou.',
        )
      : view === 'original'
        ? t(
            'shared.suggestionShowingOriginal',
            'Você está vendo a versão original, sem as suas alterações.',
          )
        : fields.length > 0
          ? t(
              'shared.suggestionShowingFields',
              'Abaixo está a versão que você sugeriu, com mudanças {{fields}}.',
              { fields: fieldList },
            )
          : t('shared.suggestionShowing', 'Abaixo está a versão que você sugeriu.');
  const option = (key: SuggestionView, label: string) => (
    <button
      type="button"
      aria-pressed={view === key}
      onClick={() => onViewChange?.(key)}
      className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
        view === key
          ? 'bg-amber-800 text-white dark:bg-amber-300 dark:text-amber-950'
          : 'text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="rounded-lg px-4 py-3 text-[13px] bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 ring-1 ring-amber-200/60 dark:ring-amber-800/40 text-center">
      <p className="font-medium">
        {t('shared.suggestionPendingReviewFull', 'Sugestão enviada para revisão da equipe')}
      </p>
      {onViewChange && (
        <>
          <p className="mt-1 text-[12px]" aria-live="polite">
            {detail}
          </p>
          <div
            role="group"
            aria-label={t('shared.suggestionCompareLabel', 'Comparar versões')}
            className="mt-2 inline-flex gap-0.5 rounded-full p-0.5 ring-1 ring-amber-200 dark:ring-amber-800/60 bg-white/60 dark:bg-black/20"
          >
            {option('diff', t('shared.suggestionViewDiff', 'Alterações'))}
            {option('suggestion', t('shared.suggestionViewMine', 'Sua sugestão'))}
            {option('original', t('shared.suggestionViewOriginal', 'Original'))}
          </div>
        </>
      )}
    </div>
  );
}

/** Rejected-suggestion warning copy, for the panel's info line and the reading view's nudge. */
export function rejectedSuggestionWarningText(t: TFunction<'hubPosts'>): string {
  return t(
    'shared.rejectedSuggestionWarning',
    '⚠️ Sua sugestão anterior foi rejeitada pela equipe. Edite novamente para enviar uma nova.',
  );
}

/** Low-noise nudge shown in the reading view to open Corrigir and retry. */
export function RejectedSuggestionNotice() {
  const { t } = useTranslation('hubPosts');
  return (
    <p className="mb-3 rounded-lg px-3 py-2 text-[12px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200/60 dark:ring-amber-800/40">
      {rejectedSuggestionWarningText(t)}
    </p>
  );
}

/** The suggestion field that holds each destination's caption. */
const FIELD_OF_PLATFORM: Record<PlatformId, SuggestionField> = {
  instagram: 'legenda',
  tiktok: 'legenda_tiktok',
  geral: 'legenda_geral',
};

/** The failure line of a save, by the reason the server gave (see SaveErrorKind). */
function saveErrorText(
  t: TFunction<'hubPosts'>,
  error: SaveErrorKind | null,
  tiktokMax: number | null,
  lang: string,
): string {
  if (error === 'target_gone')
    return t('shared.saveErrorTargetGone', 'Esse destino foi removido do post.');
  if (error === 'retry')
    return t('shared.saveErrorRetry', 'Não deu para salvar agora. Tente de novo.');
  if (error === 'caption_too_long')
    return tiktokMax !== null
      ? t(
          'shared.saveErrorCaptionTooLong',
          'A legenda do TikTok passou do limite de {{max}} caracteres.',
          { max: tiktokMax.toLocaleString(lang) },
        )
      : t(
          'shared.saveErrorCaptionTooLongNoMax',
          'A legenda do TikTok passou do limite de caracteres.',
        );
  return t('shared.saveFailedRetry', 'Não foi possível salvar. Tente novamente.');
}

interface CorrectionPanelProps {
  post: HubPost;
  edit: EditSuggestion;
  submitting: boolean;
  /** `referenceIds` is passed only when references are staged (so old call shapes still hold). */
  onSubmitCorrection: (
    comentario: string,
    motivo: CorrectionReason | null,
    referenceIds?: number[],
  ) => void;
  /** True whenever something unsent exists: staged content differs, comentário typed or motivo chosen. */
  onDirtyChange: (dirty: boolean) => void;
  /** True while the staged text/caption differs from the baseline (comentário and motivo excluded). */
  onContentDirtyChange?: (dirty: boolean) => void;
  /** Called after a successful save when nothing else (comentário/motivo) is unsent. */
  onSavedClean?: () => void;
  /**
   * Where Salvar edição renders. Omitted: inline at the end of the edit section. Given: the
   * button is portalled into this element (the dialog's action footer, in place of Aprovar),
   * and renders nothing while the host has not mounted the slot yet (`null`).
   */
  saveSlot?: HTMLElement | null;
  /** The post's references (usePostReferences, called once by the dialog). Absent: no attach. */
  references?: PostReferencesState;
  onOpenReference?: (item: ReferenceItem) => void;
  /** Sheet or link form open, so the dialog pauses its arrow keys and close path. */
  onOverlayChange?: (open: boolean) => void;
}

/**
 * The staged-edit + correction-request flow (spec 2026-09-17), once, for every
 * post kind. Section 1 edits the text/caption and saves it as a suggestion;
 * section 2 sends the correction request. Both are optional and independent.
 * Remounted by the dialog per post (key={post.id}), so all state starts clean.
 */
export function CorrectionPanel({
  post,
  edit,
  submitting,
  onSubmitCorrection,
  onDirtyChange,
  onContentDirtyChange,
  onSavedClean,
  saveSlot,
  references,
  onOpenReference,
  onOverlayChange,
}: CorrectionPanelProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const isText = pickPostCardKind(post) === 'text';
  const listFormat = new Intl.ListFormat(i18n.language || 'pt-BR', {
    style: 'long',
    type: 'conjunction',
  });
  const fieldLabel = (p: PlatformId) =>
    p === 'instagram'
      ? t('captions.fieldLabel.instagram', 'Legenda do Instagram')
      : p === 'tiktok'
        ? t('captions.fieldLabel.tiktok', 'Legenda do TikTok')
        : t('captions.fieldLabel.geral', 'Legenda Geral');
  const platformNames = usePlatformNames();
  const platformList = (platforms: PlatformId[]) =>
    t('captions.groupFieldLabel', 'Legenda de {{names}}', { names: platformNames(platforms) });
  const withArticle = (p: PlatformId) =>
    p === 'instagram'
      ? t('captions.withArticle.instagram', 'o Instagram')
      : p === 'tiktok'
        ? t('captions.withArticle.tiktok', 'o TikTok')
        : t('captions.withArticle.geral', 'o destino Geral');
  const platformListWithArticles = (platforms: PlatformId[]) =>
    listFormat.format(platforms.map(withArticle));
  const {
    hasPendingSuggestion,
    wasRejected,
    saveSuggestion,
    saveState,
    approvalBlocked,
    dirty,
    saveFailed,
    saveError,
    discardFailedSave,
    draftConteudo,
    draftConteudoPlain,
    draftIgCaption,
    draftTiktokCaption,
    draftGeralCaption,
    suggestion,
  } = edit;

  const onSavedCleanRef = useRef(onSavedClean);
  onSavedCleanRef.current = onSavedClean;

  // What the client started from: the RAW post as it was when the panel opened (never the
  // derived or suggestion-aware text, and not updated by a later refetch). The server
  // compares these with the live post, so a team edit made while the panel stayed open reads
  // as a conflict instead of being silently overwritten.
  const seedBasesRef = useRef({
    conteudo: post.conteudo ?? null,
    conteudo_plain: post.conteudo_plain ?? null,
    ig_caption: post.ig_caption ?? null,
    tiktok_caption: post.tiktok_caption ?? null,
    geral_caption: post.geral_caption ?? null,
  });
  // Fields edited at any point in this session. Sticky: once a save has recorded a field in
  // the suggestion, the next save (after the draft re-seeds from it) still sends it.
  const touchedRef = useRef<Set<SuggestionField>>(new Set());

  // Baseline: the caption the client actually sees. A pending suggestion's own caption wins
  // even when '' (see suggestionAwareCaption); otherwise the LEGENDA fallback applies.
  const captionBaseline = suggestionAwareCaption(post, suggestion);
  const [stagedConteudo, setStagedConteudo] = useState(draftConteudo);
  const [stagedConteudoPlain, setStagedConteudoPlain] = useState(draftConteudoPlain);
  const [stagedCaption, setStagedCaption] = useState(captionBaseline);

  // Posts with a destination besides Instagram edit one caption per group (spec 2026-10-30,
  // PR 2 "Hub"): the groups of the reading view, computed from the drafts when the panel opens
  // and then frozen, so the tabs never regroup while the client types. Null = today's single
  // Instagram caption field.
  const captionTargets = resolvePostTargets(post);
  const multiCaption =
    captionTargets !== null && !(captionTargets.length === 1 && captionTargets[0] === 'instagram');
  const editTargets: PlatformId[] = multiCaption && captionTargets ? captionTargets : [];
  // The Instagram caption as this panel shows it: media posts keep the LEGENDA fallback (the
  // single field already does), text posts show the stored caption, as the reading view does.
  const igShownBaseline = isText ? (draftIgCaption ?? '') : captionBaseline;
  // What each field reads before any edit, from the current drafts (a refetch moves these).
  const fieldBaseline = (field: SuggestionField): string =>
    field === 'legenda'
      ? igShownBaseline
      : field === 'legenda_tiktok'
        ? (draftTiktokCaption ?? '')
        : (draftGeralCaption ?? '');
  const [frozenGroups] = useState<EditCaptionGroup[]>(() =>
    multiCaption
      ? editCaptionGroups(
          groupCaptions(
            destinationCaptions(
              { ...post, tiktok_caption: draftTiktokCaption, geral_caption: draftGeralCaption },
              editTargets,
              igShownBaseline,
              draftIgCaption,
            ),
          ),
          draftTiktokCaption,
        )
      : [],
  );
  // The mode is frozen with the groups: a refetch that turns a single-caption post into a
  // multi-destination one (an old cached payload) must not leave the panel without a field.
  const groupMode = frozenGroups.length > 0;
  // The destinations the post has now; unknown (a payload without them) keeps every group.
  const liveTargets: PlatformId[] = captionTargets ?? frozenGroups.flatMap((g) => g.platforms);
  // A destination removed while the panel is open (refetch after a 409 target_gone) leaves its
  // group; the fields are recomputed so a TikTok that followed a removed Instagram becomes its own.
  const captionGroups: EditCaptionGroup[] = groupMode
    ? editCaptionGroups(
        frozenGroups
          .map((g) => ({ ...g, platforms: g.platforms.filter((p) => liveTargets.includes(p)) }))
          .filter((g) => g.platforms.length > 0),
        draftTiktokCaption,
      )
    : [];
  // Staged text per frozen group, keyed by the group's first destination (stable across removal).
  const groupKey = (g: { platforms: PlatformId[] }) => g.platforms[0];
  const groupBaseline = (g: EditCaptionGroup) =>
    g.fields.length > 0 ? fieldBaseline(g.fields[0]) : g.text;
  const [stagedGroups, setStagedGroups] = useState<Record<string, string>>(() =>
    Object.fromEntries(frozenGroups.map((g) => [groupKey(g), g.text])),
  );
  const stagedOf = (g: EditCaptionGroup) => stagedGroups[groupKey(g)] ?? groupBaseline(g);
  const groupsDirty = captionGroups.map((g) => stagedOf(g) !== groupBaseline(g));
  const [activeGroup, setActiveGroup] = useState(0);
  const activeIdx = Math.min(activeGroup, Math.max(0, captionGroups.length - 1));
  const tabsPanelId = useId();
  const resetStagedGroups = () =>
    setStagedGroups(Object.fromEntries(captionGroups.map((g) => [groupKey(g), groupBaseline(g)])));
  const [comentario, setComentario] = useState('');
  const [motivo, setMotivo] = useState<CorrectionReason | null>(null);
  // Ids of references added from this composer and still meant for this correction.
  const [stagedIds, setStagedIds] = useState<number[]>([]);
  const waitHintId = useId();
  // Suppresses the "failed, retry" UI for the ~1.5s debounce window between
  // clicking Save and `saveState` actually leaving 'idle' for 'saving' -- during that
  // window `edit.dirty` is already true (set synchronously by saveSuggestion) while
  // saveState hasn't moved yet, which would otherwise read identically to a genuine
  // stuck failure and flash the rose message on every successful save. Cleared as
  // soon as saveState leaves 'idle', so a REAL failure (which brings saveState back
  // to 'idle' afterwards) still shows the message.
  const [saveRequested, setSaveRequested] = useState(false);
  // Bumped only when a genuine background resync (below) replaces stagedConteudo,
  // and passed as RichTextContent's `key`. RichTextContent/TipTap only reads
  // `content` as the editor's INITIAL value -- it never calls setContent when the
  // prop changes later -- so without forcing a remount here, the on-screen editor
  // would keep showing the pre-refetch body even though stagedConteudo/panelDirty
  // have already moved on, letting the user approve or edit on top of stale text.
  const [contentVersion, setContentVersion] = useState(0);

  useEffect(() => {
    if (saveState !== 'idle') setSaveRequested(false);
  }, [saveState]);
  // A request that fails fast can go idle -> saving -> idle inside one React batch, so
  // the effect above never sees 'saving'. The hook flipping `saveFailed` to true is the
  // other reliable end-of-attempt signal (it is reset to false the moment a save is queued).
  useEffect(() => {
    if (saveFailed) setSaveRequested(false);
  }, [saveFailed]);

  // The panel is only remounted when the post ID changes (key={post.id} in the
  // dialog), not when the SAME post's data refetches (window-focus refetch, the
  // publicando poll, another post's approval invalidating the shared query). A
  // background refetch can change captionBaseline/draftConteudoPlain while the
  // staged fields stay stale, which would otherwise permanently flip
  // contentDirty/panelDirty to true with no edit the user actually made. Only
  // auto-resync when the staged value still equals the PREVIOUSLY-synced
  // baseline (the user hasn't diverged from it yet) -- never clobber a genuine
  // local edit.
  //
  // Done during render (React's "adjusting state when a prop changes" pattern),
  // not in a useEffect: an effect would still let THIS render's contentDirty
  // see the stale staged value and briefly report dirty=true to onDirtyChange
  // before the effect corrects it on the next render. Adjusting state directly
  // in the render body makes React redo this render immediately, with the
  // corrected staged value, before anything downstream (contentDirty,
  // onDirtyChange) ever observes the stale one.
  const lastSyncedCaptionRef = useRef(captionBaseline);
  if (captionBaseline !== lastSyncedCaptionRef.current) {
    if (stagedCaption === lastSyncedCaptionRef.current) {
      setStagedCaption(captionBaseline);
      // The client now SEES the refetched caption, so an edit on top of it starts from that
      // caption, not from the one the panel opened with: re-seed the base from the raw post.
      // Once a save recorded the field (touched), its base is the one the server already holds;
      // and a caption the client had already typed over never gets here (it is not resynced), so
      // a team edit under a local edit still reads as a conflict at accept.
      if (!touchedRef.current.has('legenda')) {
        seedBasesRef.current.ig_caption = post.ig_caption ?? null;
      }
    }
    lastSyncedCaptionRef.current = captionBaseline;
  }

  // Same resync, per caption group: a refetch moves a group's baseline; a group the client has
  // not typed in follows it (and its untouched fields re-seed their bases from the raw post).
  const groupBaselineKey = JSON.stringify(
    captionGroups.map((g) => [groupKey(g), groupBaseline(g)]),
  );
  const lastSyncedGroupsRef = useRef<Record<string, string>>(
    Object.fromEntries(captionGroups.map((g) => [groupKey(g), groupBaseline(g)])),
  );
  const lastGroupBaselineKeyRef = useRef(groupBaselineKey);
  if (groupBaselineKey !== lastGroupBaselineKeyRef.current) {
    lastGroupBaselineKeyRef.current = groupBaselineKey;
    const next = { ...stagedGroups };
    let changed = false;
    for (const g of captionGroups) {
      const key = groupKey(g);
      const baseline = groupBaseline(g);
      const prev = lastSyncedGroupsRef.current[key];
      if (prev !== undefined && baseline !== prev && stagedOf(g) === prev) {
        next[key] = baseline;
        changed = true;
        for (const f of g.fields) {
          if (touchedRef.current.has(f)) continue;
          if (f === 'legenda') seedBasesRef.current.ig_caption = post.ig_caption ?? null;
          if (f === 'legenda_tiktok')
            seedBasesRef.current.tiktok_caption = post.tiktok_caption ?? null;
          if (f === 'legenda_geral')
            seedBasesRef.current.geral_caption = post.geral_caption ?? null;
        }
      }
      lastSyncedGroupsRef.current[key] = baseline;
    }
    if (changed) setStagedGroups(next);
  }

  // The body is tracked by plain text AND by canonical document, so a refetch that only
  // changes formatting (or re-signs image URLs, which canonicalDoc ignores) resyncs too.
  const draftDocKey = canonicalDoc(draftConteudo);
  const stagedDocKey = canonicalDoc(stagedConteudo);
  const lastSyncedConteudoPlainRef = useRef(draftConteudoPlain);
  const lastSyncedDocKeyRef = useRef(draftDocKey);
  if (
    draftConteudoPlain !== lastSyncedConteudoPlainRef.current ||
    draftDocKey !== lastSyncedDocKeyRef.current
  ) {
    if (
      stagedConteudoPlain === lastSyncedConteudoPlainRef.current &&
      stagedDocKey === lastSyncedDocKeyRef.current
    ) {
      setStagedConteudo(draftConteudo);
      setStagedConteudoPlain(draftConteudoPlain);
      // Same as the caption above: the body shown is now the refetched one.
      if (!touchedRef.current.has('texto')) {
        seedBasesRef.current.conteudo = post.conteudo ?? null;
        seedBasesRef.current.conteudo_plain = post.conteudo_plain ?? null;
      }
      // Force RichTextContent to remount with the resynced body as its new
      // initial value -- see contentVersion's declaration above.
      setContentVersion((v) => v + 1);
    }
    lastSyncedConteudoPlainRef.current = draftConteudoPlain;
    lastSyncedDocKeyRef.current = draftDocKey;
  }

  // The staged text/caption as of the last Salvar edição (or retry) click. When the save
  // lands, anything typed after that click was never sent: see the 'saved' effect below.
  // `conteudo` is compared by reference: TipTap emits a new doc on every edit, so a
  // formatting-only change (same plain text) still counts as edited since the send.
  const sentStagedRef = useRef<{
    conteudo: unknown;
    conteudoPlain: string;
    caption: string;
    groups: Record<string, string>;
  } | null>(null);

  // Resubmits whatever is currently staged. Shared by Salvar edição and the failed-save retry.
  function submitStaged() {
    setSaveRequested(true);
    sentStagedRef.current = {
      conteudo: stagedConteudo,
      conteudoPlain: stagedConteudoPlain,
      caption: stagedCaption,
      groups: stagedGroups,
    };
    // An untouched body sends its STORED text: draftConteudoPlain is the editor's rendering
    // of the document, which can differ from the stored text in line breaks alone, and the
    // RPC would then record a body change that accepting applies (see docPlainText).
    const bodyEdited = stagedConteudoPlain !== draftConteudoPlain || stagedDocKey !== draftDocKey;
    // The suggestion's stored text counts only while it changed the body: otherwise the
    // editor was seeded from the live post and the plain text must pair with it.
    const suggestionHasText =
      !!suggestion?.changed_fields?.includes('conteudo') ||
      !!suggestion?.changed_fields?.includes('conteudo_plain');
    const textPlain = bodyEdited
      ? stagedConteudoPlain
      : ((suggestionHasText ? suggestion?.suggested_conteudo_plain : null) ??
        post.conteudo_plain ??
        '');
    if (isText && bodyEdited) touchedRef.current.add('texto');
    // Captions sent: each group's staged text for its fields; a field in no group (destination
    // absent, or TikTok still following Instagram) carries its raw draft, which the server
    // ignores while untouched.
    const captionValues: Record<'legenda' | 'legenda_tiktok' | 'legenda_geral', string | null> = {
      legenda: showCaptionField ? stagedCaption : '',
      legenda_tiktok: draftTiktokCaption,
      legenda_geral: draftGeralCaption,
    };
    if (groupMode) {
      captionValues.legenda = draftIgCaption;
      // A destination that left the post is no longer a field (the server answers target_gone).
      for (const f of [...touchedRef.current]) {
        if (f === 'texto') continue;
        const platform = (Object.keys(FIELD_OF_PLATFORM) as PlatformId[]).find(
          (p) => FIELD_OF_PLATFORM[p] === f,
        );
        if (platform && !liveTargets.includes(platform)) touchedRef.current.delete(f);
      }
      captionGroups.forEach((g, i) => {
        for (const f of g.fields) {
          if (f !== 'texto') captionValues[f] = stagedOf(g);
          if (groupsDirty[i]) touchedRef.current.add(f);
        }
      });
    } else if (showCaptionField && stagedCaption !== captionBaseline) {
      touchedRef.current.add('legenda');
    }
    // Bases only for touched fields: the server checks the ones it receives.
    const seed = seedBasesRef.current;
    const bases: SuggestionBases = {};
    if (touchedRef.current.has('texto')) {
      bases.conteudo = seed.conteudo;
      bases.conteudo_plain = seed.conteudo_plain;
    }
    if (touchedRef.current.has('legenda')) bases.ig_caption = seed.ig_caption;
    if (touchedRef.current.has('legenda_tiktok')) bases.tiktok_caption = seed.tiktok_caption;
    if (touchedRef.current.has('legenda_geral')) bases.geral_caption = seed.geral_caption;
    const conteudo = isText ? stagedConteudo : draftConteudo;
    const conteudoPlain = isText ? textPlain : (post.conteudo_plain ?? '');
    const touch = { fields: [...touchedRef.current], bases };
    // An Instagram-only post sends no TikTok/Geral keys at all (absent = untouched).
    if (groupMode)
      saveSuggestion(conteudo, conteudoPlain, captionValues.legenda, touch, {
        tiktok_caption: captionValues.legenda_tiktok,
        geral_caption: captionValues.legenda_geral,
      });
    else saveSuggestion(conteudo, conteudoPlain, captionValues.legenda, touch);
  }

  // Way out of a failed save: forget the failure on the hook (which clears `dirty`) and
  // drop this panel's own staged edit back to the baseline, remounting the TipTap editor
  // (it only reads `content` as its initial value) so it shows the restored body.
  function discardFailedEdit() {
    discardFailedSave();
    setSaveRequested(false);
    setStagedConteudo(draftConteudo);
    setStagedConteudoPlain(draftConteudoPlain);
    setStagedCaption(captionBaseline);
    resetStagedGroups();
    setContentVersion((v) => v + 1);
  }

  // The caption field itself is hidden under this same condition (below) when
  // there's neither an explicit ig_caption nor a draft/suggested one -- in that
  // case stagedCaption is still seeded from captionBaseline's conteudo_plain
  // fallback (deriveCaption), but the client never saw or edited that text as a
  // caption, so it must not be submitted as one. A text post's suggestion stores
  // '' when it had no caption field, which must not reveal one.
  // A suggestion's stored caption counts only while it changed the caption (see
  // suggestionAwareCaption): otherwise it is a stale copy of what the client saw.
  const showCaptionField =
    !isText ||
    post.ig_caption != null ||
    (!!suggestion?.changed_fields?.includes('ig_caption') && !!suggestion.suggested_ig_caption);

  // A formatting-only edit (bold, an inline image) leaves the plain text untouched, so the
  // document is compared too, canonically (see canonicalDoc).
  const contentDirty =
    (isText && (stagedConteudoPlain !== draftConteudoPlain || stagedDocKey !== draftDocKey)) ||
    (groupMode ? groupsDirty.some(Boolean) : stagedCaption !== captionBaseline);
  // Staged references that still exist: one removed in the Referências tab drops out here too
  // (a failed upload never gets staged).
  const stagedItems: ReferenceItem[] = references
    ? stagedIds.flatMap((id) => references.items.filter((item) => item.id === id))
    : [];
  // Only uploads started here belong to this correction; tab uploads still block sending.
  const composerUploads = references
    ? references.uploads.filter((entry) => entry.source === 'composer')
    : [];
  const uploadsInFlight = references?.uploadsInFlight ?? false;
  const panelDirty =
    contentDirty || comentario.trim() !== '' || motivo !== null || stagedItems.length > 0;

  function sendCorrection() {
    const ids = stagedItems.map((item) => item.id);
    if (ids.length > 0) onSubmitCorrection(comentario.trim(), motivo, ids);
    else onSubmitCorrection(comentario.trim(), motivo);
  }

  useEffect(() => {
    onDirtyChange(panelDirty);
  }, [panelDirty, onDirtyChange]);
  useEffect(() => {
    onContentDirtyChange?.(contentDirty);
  }, [contentDirty, onContentDirtyChange]);
  // The panel can unmount without going through the host's own close path (the post stops
  // being pending on a refetch); without this the host would keep a stale "unsent" flag.
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const onContentDirtyChangeRef = useRef(onContentDirtyChange);
  onContentDirtyChangeRef.current = onContentDirtyChange;
  useEffect(
    () => () => {
      onDirtyChangeRef.current(false);
      onContentDirtyChangeRef.current?.(false);
    },
    [],
  );

  // A successful save makes the staged values the new baseline (draft* update via
  // pending_suggestion on refetch); until then the fields keep what was typed. `onSavedClean`
  // fires only on the TRANSITION into 'saved', never on mount: the hook holds saveState ===
  // 'saved' for 3s after a save (savedTimerRef in useEditSuggestion.ts), and effects run on
  // mount too, so reopening the panel within that window would otherwise close it right away.
  // Text typed after the click (while the save was queued or in flight) differs from what was
  // sent: then neither reset nor close, so the client keeps it and Salvar edição stays up.
  const prevSaveStateRef = useRef(saveState);
  useEffect(() => {
    const enteredSaved = saveState === 'saved' && prevSaveStateRef.current !== 'saved';
    prevSaveStateRef.current = saveState;
    const sent = sentStagedRef.current;
    const editedSinceSend =
      sent !== null &&
      (stagedConteudo !== sent.conteudo ||
        stagedConteudoPlain !== sent.conteudoPlain ||
        stagedCaption !== sent.caption ||
        Object.keys(sent.groups).some((k) => stagedGroups[k] !== sent.groups[k]));
    if (saveState === 'saved' && !editedSinceSend) {
      setStagedConteudo(draftConteudo);
      setStagedConteudoPlain(draftConteudoPlain);
      // Same as the caption above: the body shown is now the refetched one.
      if (!touchedRef.current.has('texto')) {
        seedBasesRef.current.conteudo = post.conteudo ?? null;
        seedBasesRef.current.conteudo_plain = post.conteudo_plain ?? null;
      }
      setStagedCaption(captionBaseline);
      resetStagedGroups();
      if (enteredSaved && comentario.trim() === '' && motivo === null) onSavedCleanRef.current?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState]);

  // `saveFailed` is only true once the last attempt settled as a failure (never during the
  // debounce window or in flight), so it is the gate; `!saveRequested` just keeps the UI
  // from lingering for the instant between a click and the hook's state catching up.
  const showFailure = saveFailed && saveState === 'idle' && !saveRequested;

  // Queued (the hook's 1.5s debounce) counts as saving too, so a click shows feedback at once.
  const saving = saveState === 'saving' || (dirty && !saveFailed);
  const saveLabel = saving
    ? t('shared.saving', 'Salvando...')
    : t('shared.salvarEdicao', 'Salvar edição');
  const saveDisabled = (!contentDirty && !dirty) || saving;
  const saveButton =
    saveSlot === undefined ? (
      <button
        type="button"
        onClick={submitStaged}
        disabled={saveDisabled}
        className="hub-btn-primary rounded-[4px] py-2 px-3 text-[12px] font-semibold disabled:opacity-50 transition-colors"
      >
        {saveLabel}
      </button>
    ) : saveSlot ? (
      createPortal(
        <button
          type="button"
          onClick={submitStaged}
          disabled={saveDisabled}
          className="flex-1 flex items-center justify-center gap-1.5 hub-btn-primary rounded-[4px] py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50"
        >
          <Save size={15} aria-hidden="true" /> {saveLabel}
        </button>,
        saveSlot,
      )
    ) : null;

  const tiktokMax = captionMaxFor('tiktok', post.tipo);

  // One caption group's field: its textarea, the TikTok counter and, when the text goes to
  // several destinations, a note saying so. `labelled`: a lone field names its destination.
  function renderGroupField(group: EditCaptionGroup, labelled: boolean) {
    const value = stagedOf(group);
    const key = groupKey(group);
    const label =
      group.platforms.length === 1 ? fieldLabel(group.platforms[0]) : platformList(group.platforms);
    const max = group.platforms.includes('tiktok') ? tiktokMax : null;
    return (
      <div className="space-y-1.5">
        {labelled && group.platforms.length === 1 && (
          <p className="text-[12px] hub-tx3 font-medium">{label}</p>
        )}
        <textarea
          aria-label={label}
          value={value}
          onChange={(e) => {
            const text = e.target.value;
            setStagedGroups((prev) => ({ ...prev, [key]: text }));
          }}
          className="hub-focus-accent w-full text-[13px] hub-tx2 leading-relaxed border border-dashed hub-border-strong rounded-lg px-3 py-2 resize-none min-h-[120px] hub-bg-card focus:outline-none focus:border-solid"
        />
        {(max !== null || group.platforms.length > 1) && (
          <div className="flex items-start justify-between gap-3">
            <p className="text-[12px] hub-tx3">
              {group.platforms.length > 1 &&
                t('captions.appliesTo', 'Esta mudança vale para {{names}}.', {
                  names: platformListWithArticles(group.platforms),
                })}
            </p>
            {max !== null && (
              <p
                className={`shrink-0 text-[12px] tabular-nums ${
                  value.length > max ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'hub-tx3'
                }`}
              >
                {value.length.toLocaleString(i18n.language || 'pt-BR')} /{' '}
                {max.toLocaleString(i18n.language || 'pt-BR')}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  const reasons: CorrectionReason[] = isText
    ? ['texto', 'legenda', 'outro']
    : ['midia', 'texto', 'legenda', 'outro'];

  return (
    <div className="space-y-3">
      {saveSlot !== undefined && saveButton}
      <section className="rounded-xl border hub-border hub-bg-soft p-3 space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] hub-tx3">
          {isText ? t('posts.editText', 'Editar texto') : t('posts.editCaption', 'Editar legenda')}
        </p>
        {hasPendingSuggestion && (
          <p className="text-[12px] text-amber-800 dark:text-amber-300">
            {t(
              'shared.editingSuggestionNote',
              'Você está editando a sugestão que já enviou. As alterações anteriores continuam valendo.',
            )}
          </p>
        )}
        {isText && stagedConteudo && (
          <RichTextContent
            key={contentVersion}
            content={stagedConteudo}
            className="text-[13px] hub-tx2 leading-relaxed rounded-lg border border-dashed hub-border-strong px-3 py-2 hub-bg-card"
            editable
            onUpdate={(json, plain) => {
              setStagedConteudo(json);
              setStagedConteudoPlain(plain);
            }}
            fallbackText={post.conteudo_plain}
          />
        )}
        {isText && !stagedConteudo && (
          <textarea
            aria-label={t('shared.contentAriaLabel', 'Conteúdo do post')}
            value={stagedConteudoPlain}
            onChange={(e) => {
              setStagedConteudo(null);
              setStagedConteudoPlain(e.target.value);
            }}
            className="hub-focus-accent w-full text-[13px] hub-tx2 leading-relaxed border border-dashed hub-border-strong rounded-lg px-3 py-2 resize-none min-h-[100px] hub-bg-card focus:outline-none focus:border-solid"
          />
        )}
        {groupMode && captionGroups.length > 0 && (
          <div className="space-y-2">
            {isText && (
              <p className="text-[12px] hub-tx3 font-medium">
                {t('textCard.captionLabel', 'Legenda')}
              </p>
            )}
            {captionGroups.length > 1 ? (
              <>
                <CaptionTabs
                  groups={captionGroups}
                  active={activeIdx}
                  onChange={setActiveGroup}
                  dirty={groupsDirty}
                  panelId={tabsPanelId}
                />
                <CaptionTabPanel panelId={tabsPanelId} active={activeIdx}>
                  {renderGroupField(captionGroups[activeIdx], false)}
                </CaptionTabPanel>
              </>
            ) : (
              renderGroupField(captionGroups[0], true)
            )}
          </div>
        )}
        {!groupMode && showCaptionField && (
          <>
            {isText && (
              <p className="text-[12px] hub-tx3 font-medium">
                {t('textCard.instagramCaptionLabel', 'Legenda do Instagram')}
              </p>
            )}
            <textarea
              aria-label={t('instagramCard.captionAriaLabel', 'Legenda do post')}
              value={stagedCaption}
              onChange={(e) => setStagedCaption(e.target.value)}
              className="hub-focus-accent w-full text-[13px] hub-tx2 leading-relaxed border border-dashed hub-border-strong rounded-lg px-3 py-2 resize-none min-h-[72px] hub-bg-card focus:outline-none focus:border-solid"
            />
          </>
        )}
        <p
          className={`text-[12px] ${wasRejected ? 'text-amber-800 dark:text-amber-300' : 'hub-tx3'}`}
        >
          {wasRejected
            ? rejectedSuggestionWarningText(t)
            : t(
                'shared.suggestionInfoNote',
                'ℹ️ Suas edições serão enviadas como sugestão para a equipe revisar',
              )}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saveState === 'saving' && (
            <span className="text-[12px] hub-tx3">
              {t('shared.savingSuggestion', 'Salvando sugestão...')}
            </span>
          )}
          {saveState === 'saved' && (
            <span className="text-[12px] text-emerald-600 dark:text-emerald-400 font-medium">
              {t('shared.suggestionSaved', 'Sugestão salva')}
            </span>
          )}
          {showFailure && (
            <>
              <span role="alert" className="text-[12px] text-rose-600 dark:text-rose-400">
                {saveErrorText(t, saveError, tiktokMax, i18n.language || 'pt-BR')}
              </span>
              {/* A failure remembered from an earlier mount leaves nothing staged here, and
                  resubmitting the baseline would create a no-op pending suggestion. */}
              {contentDirty && (
                <button
                  type="button"
                  onClick={submitStaged}
                  className="hub-btn-secondary rounded-[4px] py-2 px-3 text-[12px] font-semibold transition-colors"
                >
                  {t('shared.retrySave', 'Tentar novamente')}
                </button>
              )}
              <button
                type="button"
                onClick={discardFailedEdit}
                className="hub-btn-secondary rounded-[4px] py-2 px-3 text-[12px] font-semibold transition-colors"
              >
                {t('shared.discardFailedEdit', 'Descartar edição')}
              </button>
            </>
          )}
          {saveSlot === undefined && saveButton}
        </div>
      </section>

      <section className="rounded-xl border hub-border hub-bg-soft p-3 space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] hub-tx3">
          {t('posts.requestCorrection', 'Solicitar correção')}
        </p>
        {hasPendingSuggestion && (
          <p className="text-[12px] hub-tx3">
            {t(
              'shared.correctionBlockedBySuggestion',
              'Para pedir correção, aguarde a equipe revisar sua sugestão.',
            )}
          </p>
        )}
        <CorrectionReasonChips
          value={motivo}
          onChange={setMotivo}
          disabled={submitting || approvalBlocked}
          reasons={reasons}
        />
        <textarea
          aria-label={t('shared.commentPlaceholder', 'Descreva o que precisa mudar')}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder={t('shared.commentPlaceholder', 'Descreva o que precisa mudar')}
          className="hub-focus-accent w-full rounded-lg border hub-border px-3 py-2.5 text-[13px] resize-none min-h-[70px] hub-bg-card hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none focus:border-[var(--hub-bd2)] transition-all"
        />
        {references && (references.canAdd || stagedItems.length > 0) && (
          <div className="space-y-2">
            {(stagedItems.length > 0 || composerUploads.length > 0) && (
              <ul
                aria-label={t('references.composer.staged', 'Referências desta correção')}
                className="flex flex-wrap gap-1.5"
              >
                {stagedItems.map((item) => {
                  const name = referenceTitle(item);
                  return (
                    <li
                      key={item.id}
                      className="inline-flex items-center gap-1.5 max-w-full rounded-full border hub-border hub-bg-card py-1 pl-1 pr-1.5"
                    >
                      <ReferenceOpen
                        item={item}
                        onOpen={onOpenReference}
                        label={t('references.open', 'Abrir {{name}}', { name })}
                        className="inline-flex items-center gap-1.5 min-w-0 rounded-full"
                      >
                        <ReferenceThumb item={item} size={24} />
                        <span className="truncate max-w-[160px] text-[12px] hub-txt">{name}</span>
                      </ReferenceOpen>
                      <button
                        type="button"
                        onClick={() => setStagedIds((ids) => ids.filter((id) => id !== item.id))}
                        aria-label={t('references.composer.unstage', 'Tirar {{name}} da correção', {
                          name,
                        })}
                        className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center hub-tx3 hover:bg-[var(--hub-soft)]"
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
                {composerUploads.map((entry) =>
                  entry.status === 'uploading' ? (
                    <li
                      key={entry.localId}
                      className="inline-flex items-center gap-1.5 rounded-full border hub-border px-2.5 py-1 text-[12px] hub-tx3"
                    >
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                      <span className="truncate max-w-[160px]">{entry.name}</span>
                    </li>
                  ) : (
                    <li
                      key={entry.localId}
                      role="alert"
                      className="w-full text-[12px] text-rose-700 dark:text-rose-300"
                    >
                      {entry.name}:{' '}
                      {referenceErrorMessage(entry.error ?? 'internal', t, {
                        fileKind: entry.fileKind,
                        sizeBytes: entry.total,
                      })}
                    </li>
                  ),
                )}
              </ul>
            )}
            {references.canAdd && (
              <ReferencePicker
                refs={references}
                variant="composer"
                disabled={submitting || approvalBlocked}
                onAdded={(item) =>
                  setStagedIds((ids) => (ids.includes(item.id) ? ids : [...ids, item.id]))
                }
                onOverlayChange={onOverlayChange}
              />
            )}
            <p className="text-[12px] hub-tx3">
              {t(
                'references.composer.helper',
                'As referências anexadas também ficam na aba Referências deste post.',
              )}
            </p>
          </div>
        )}
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={sendCorrection}
            disabled={submitting || approvalBlocked || dirty || contentDirty || uploadsInFlight}
            aria-describedby={uploadsInFlight ? waitHintId : undefined}
            className="flex items-center gap-1.5 hub-btn-secondary rounded-[4px] py-2 px-3 text-[12px] font-semibold disabled:opacity-50 transition-colors"
          >
            <AlertCircle size={14} /> {t('shared.enviarCorrecao', 'Enviar correção')}
          </button>
          {uploadsInFlight && (
            <p id={waitHintId} className="text-[12px] hub-tx3">
              {t('references.waitUpload', 'Aguarde o envio terminar')}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

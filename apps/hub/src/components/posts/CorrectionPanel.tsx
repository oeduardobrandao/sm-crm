import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle, Loader2, Save, X } from 'lucide-react';
import type { CorrectionReason, HubPost } from '../../types';
import type { useEditSuggestion } from '../../hooks/useEditSuggestion';
import type { PostReferencesState } from '../../hooks/usePostReferences';
import type { ReferenceItem } from '../../types/postReferences';
import { ReferencePicker } from './references/ReferencePicker';
import { ReferenceOpen, ReferenceThumb } from './references/ReferenceTiles';
import { referenceErrorMessage } from './references/referenceErrors';
import { referenceTitle } from './references/referenceFormat';
import { pickPostCardKind, suggestionAwareCaption } from '../../lib/postView';
import { canonicalDoc } from '../../lib/richDoc';
import { RichTextContent } from '../RichTextContent';
import { CorrectionReasonChips } from '../CorrectionReasonChips';

export type EditSuggestion = ReturnType<typeof useEditSuggestion>;

export type SuggestionView = 'diff' | 'suggestion' | 'original';

interface SuggestionPendingNoticeProps {
  /** The pending suggestion's `changed_fields`; only read when `onViewChange` is given. */
  changedFields?: string[];
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
  view = 'diff',
  onViewChange,
}: SuggestionPendingNoticeProps = {}) {
  const { t } = useTranslation('hubPosts');
  const textChanged =
    changedFields.includes('conteudo') || changedFields.includes('conteudo_plain');
  const captionChanged = changedFields.includes('ig_caption');
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
        : textChanged && captionChanged
          ? t(
              'shared.suggestionShowingBoth',
              'Abaixo está a versão que você sugeriu. Você alterou o texto e a legenda.',
            )
          : textChanged
            ? t(
                'shared.suggestionShowingText',
                'Abaixo está a versão que você sugeriu. Você alterou o texto.',
              )
            : captionChanged
              ? t(
                  'shared.suggestionShowingCaption',
                  'Abaixo está a versão que você sugeriu. Você alterou a legenda.',
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
  const { t } = useTranslation('hubPosts');
  const isText = pickPostCardKind(post) === 'text';
  const {
    hasPendingSuggestion,
    wasRejected,
    saveSuggestion,
    saveState,
    approvalBlocked,
    dirty,
    saveFailed,
    discardFailedSave,
    draftConteudo,
    draftConteudoPlain,
    suggestion,
  } = edit;

  const onSavedCleanRef = useRef(onSavedClean);
  onSavedCleanRef.current = onSavedClean;

  // Baseline: the caption the client actually sees. A pending suggestion's own caption wins
  // even when '' (see suggestionAwareCaption); otherwise the LEGENDA fallback applies.
  const captionBaseline = suggestionAwareCaption(post, suggestion);
  const [stagedConteudo, setStagedConteudo] = useState(draftConteudo);
  const [stagedConteudoPlain, setStagedConteudoPlain] = useState(draftConteudoPlain);
  const [stagedCaption, setStagedCaption] = useState(captionBaseline);
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
    }
    lastSyncedCaptionRef.current = captionBaseline;
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
  } | null>(null);

  // Resubmits whatever is currently staged. Shared by Salvar edição and the failed-save retry.
  function submitStaged() {
    setSaveRequested(true);
    sentStagedRef.current = {
      conteudo: stagedConteudo,
      conteudoPlain: stagedConteudoPlain,
      caption: stagedCaption,
    };
    // An untouched body sends its STORED text: draftConteudoPlain is the editor's rendering
    // of the document, which can differ from the stored text in line breaks alone, and the
    // RPC would then record a body change that accepting applies (see docPlainText).
    const bodyEdited = stagedConteudoPlain !== draftConteudoPlain || stagedDocKey !== draftDocKey;
    const textPlain = bodyEdited
      ? stagedConteudoPlain
      : (suggestion?.suggested_conteudo_plain ?? post.conteudo_plain ?? '');
    saveSuggestion(
      isText ? stagedConteudo : draftConteudo,
      isText ? textPlain : (post.conteudo_plain ?? ''),
      showCaptionField ? stagedCaption : '',
    );
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
    setContentVersion((v) => v + 1);
  }

  // The caption field itself is hidden under this same condition (below) when
  // there's neither an explicit ig_caption nor a draft/suggested one -- in that
  // case stagedCaption is still seeded from captionBaseline's conteudo_plain
  // fallback (deriveCaption), but the client never saw or edited that text as a
  // caption, so it must not be submitted as one. A text post's suggestion stores
  // '' when it had no caption field, which must not reveal one.
  const showCaptionField = !isText || post.ig_caption != null || !!suggestion?.suggested_ig_caption;

  // A formatting-only edit (bold, an inline image) leaves the plain text untouched, so the
  // document is compared too, canonically (see canonicalDoc).
  const contentDirty =
    (isText && (stagedConteudoPlain !== draftConteudoPlain || stagedDocKey !== draftDocKey)) ||
    stagedCaption !== captionBaseline;
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
        stagedCaption !== sent.caption);
    if (saveState === 'saved' && !editedSinceSend) {
      setStagedConteudo(draftConteudo);
      setStagedConteudoPlain(draftConteudoPlain);
      setStagedCaption(captionBaseline);
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
        {showCaptionField && (
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
              <span className="text-[12px] text-rose-600 dark:text-rose-400">
                {t('shared.saveFailedRetry', 'Não foi possível salvar. Tente novamente.')}
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

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle } from 'lucide-react';
import type { CorrectionReason, HubPost } from '../../types';
import type { useEditSuggestion } from '../../hooks/useEditSuggestion';
import { deriveCaption, pickPostCardKind } from '../../lib/postView';
import { RichTextContent } from '../RichTextContent';
import { CorrectionReasonChips } from '../CorrectionReasonChips';

export type EditSuggestion = ReturnType<typeof useEditSuggestion>;

/** "Sugestão enviada para revisão": replaces the whole panel, and explains the disabled footer actions in the reading view. */
export function SuggestionPendingNotice() {
  const { t } = useTranslation('hubPosts');
  return (
    <div className="rounded-lg px-4 py-3 text-[13px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 ring-1 ring-amber-200/60 dark:ring-amber-800/40 text-center">
      {t('shared.suggestionPendingReviewFull', 'Sugestão enviada para revisão da equipe')}
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
  onSubmitCorrection: (comentario: string, motivo: CorrectionReason | null) => void;
  /** True whenever something unsent exists: staged content differs, comentário typed or motivo chosen. */
  onDirtyChange: (dirty: boolean) => void;
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
    draftIgCaption,
  } = edit;

  // Baselines: the caption the client actually sees (LEGENDA fallback included).
  const captionBaseline = deriveCaption(post, draftIgCaption);
  const [stagedConteudo, setStagedConteudo] = useState(draftConteudo);
  const [stagedConteudoPlain, setStagedConteudoPlain] = useState(draftConteudoPlain);
  const [stagedCaption, setStagedCaption] = useState(captionBaseline);
  const [comentario, setComentario] = useState('');
  const [motivo, setMotivo] = useState<CorrectionReason | null>(null);
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

  const lastSyncedConteudoPlainRef = useRef(draftConteudoPlain);
  if (draftConteudoPlain !== lastSyncedConteudoPlainRef.current) {
    if (stagedConteudoPlain === lastSyncedConteudoPlainRef.current) {
      setStagedConteudo(draftConteudo);
      setStagedConteudoPlain(draftConteudoPlain);
      // Force RichTextContent to remount with the resynced body as its new
      // initial value -- see contentVersion's declaration above.
      setContentVersion((v) => v + 1);
    }
    lastSyncedConteudoPlainRef.current = draftConteudoPlain;
  }

  // Resubmits whatever is currently staged. Shared by Salvar edição and the failed-save retry.
  function submitStaged() {
    setSaveRequested(true);
    saveSuggestion(
      isText ? stagedConteudo : draftConteudo,
      isText ? stagedConteudoPlain : (post.conteudo_plain ?? ''),
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
  // caption, so it must not be submitted as one.
  const showCaptionField = !isText || draftIgCaption !== null || !!post.ig_caption;

  const contentDirty =
    (isText && stagedConteudoPlain !== draftConteudoPlain) || stagedCaption !== captionBaseline;
  const panelDirty = contentDirty || comentario.trim() !== '' || motivo !== null;

  useEffect(() => {
    onDirtyChange(panelDirty);
  }, [panelDirty, onDirtyChange]);
  // The panel can unmount without going through the host's own close path (the post stops
  // being pending on a refetch); without this the host would keep a stale "unsent" flag.
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => () => onDirtyChangeRef.current(false), []);

  // A successful save makes the staged values the new baseline (draft* update via
  // pending_suggestion on refetch); until then the fields keep what was typed.
  useEffect(() => {
    if (saveState === 'saved') {
      setStagedConteudo(draftConteudo);
      setStagedConteudoPlain(draftConteudoPlain);
      setStagedCaption(captionBaseline);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState]);

  if (hasPendingSuggestion) {
    return <SuggestionPendingNotice />;
  }

  // `saveFailed` is only true once the last attempt settled as a failure (never during the
  // debounce window or in flight), so it is the gate; `!saveRequested` just keeps the UI
  // from lingering for the instant between a click and the hook's state catching up.
  const showFailure = saveFailed && saveState === 'idle' && !saveRequested;

  const reasons: CorrectionReason[] = isText
    ? ['texto', 'legenda', 'outro']
    : ['midia', 'texto', 'legenda', 'outro'];

  return (
    <div className="space-y-3">
      <section className="rounded-xl border hub-border hub-bg-soft p-3 space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] hub-tx3">
          {isText ? t('posts.editText', 'Editar texto') : t('posts.editCaption', 'Editar legenda')}
        </p>
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
          <button
            type="button"
            onClick={submitStaged}
            disabled={(!contentDirty && !dirty) || saveState === 'saving'}
            className="hub-btn-primary rounded-[4px] py-2 px-3 text-[12px] font-semibold disabled:opacity-50 transition-colors"
          >
            {saveState === 'saving'
              ? t('shared.saving', 'Salvando...')
              : t('shared.salvarEdicao', 'Salvar edição')}
          </button>
        </div>
      </section>

      <section className="rounded-xl border hub-border hub-bg-soft p-3 space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] hub-tx3">
          {t('posts.requestCorrection', 'Solicitar correção')}
        </p>
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
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onSubmitCorrection(comentario.trim(), motivo)}
            disabled={submitting || approvalBlocked || dirty || contentDirty}
            className="flex items-center gap-1.5 hub-btn-secondary rounded-[4px] py-2 px-3 text-[12px] font-semibold disabled:opacity-50 transition-colors"
          >
            <AlertCircle size={14} /> {t('shared.enviarCorrecao', 'Enviar correção')}
          </button>
        </div>
      </section>
    </div>
  );
}

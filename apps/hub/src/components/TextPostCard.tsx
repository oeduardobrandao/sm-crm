import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertCircle, ChevronDown, ExternalLink, ImageOff } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { submitApproval } from '../api';
import { sanitizeExternalUrl } from '../lib/security';
import { getPostStatusLabel, formatDate, PlatformBadge } from './PostCard';
import { getTipoLabel } from '../lib/postView';
import { RichTextContent } from './RichTextContent';
import { CorrectionReasonChips } from './CorrectionReasonChips';
import { PostHistoryPanel } from './PostHistoryPanel';
import type { CorrectionReason, HubPost, PostApproval } from '../types';
import { useEditSuggestion } from '../hooks/useEditSuggestion';

/** Status label color, independent from PostagensPage's StatusTag map (not guaranteed to share every key). */
const STATUS_TEXT_COLOR: Record<string, string> = {
  aprovado_cliente: 'text-emerald-600',
  correcao_cliente: 'text-rose-600',
  agendado: 'text-[#42c8f5]',
};

interface TextPostCardProps {
  post: HubPost;
  token: string;
  approvals: PostApproval[];
  onApprovalSubmitted?: () => void;
  readOnly?: boolean;
}

export function TextPostCard({
  post,
  token,
  approvals,
  onApprovalSubmitted,
  readOnly,
}: TextPostCardProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const dateLang = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const [expanded, setExpanded] = useState(false);
  const [comentario, setComentario] = useState('');
  const [motivo, setMotivo] = useState<CorrectionReason | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const isPending = !readOnly && post.status === 'enviado_cliente';
  const preview = post.ig_caption || post.conteudo_plain;

  const {
    isEditable: canEdit,
    hasPendingSuggestion,
    wasRejected,
    saveSuggestion,
    saveState,
    approvalBlocked,
    dirty,
    draftConteudo,
    draftConteudoPlain,
    draftIgCaption,
  } = useEditSuggestion({
    token,
    post,
    onSaved: () => onApprovalSubmitted?.(),
  });
  const isEditable = canEdit && !readOnly;
  const editingContent = panelOpen && isEditable && !hasPendingSuggestion;

  const [stagedConteudo, setStagedConteudo] = useState(draftConteudo);
  const [stagedConteudoPlain, setStagedConteudoPlain] = useState(draftConteudoPlain);
  const [stagedIgCaption, setStagedIgCaption] = useState(draftIgCaption ?? '');
  const contentDirty =
    stagedConteudoPlain !== draftConteudoPlain || stagedIgCaption !== (draftIgCaption ?? '');

  useUnsavedWork(comentario.trim() !== '' || submitting || contentDirty);

  // Once a staged edit successfully flushes, the panel has nothing left to do --
  // `hasPendingSuggestion` will flip true on the same render and freeze the flow anyway,
  // so closing here just avoids a stale open panel if the suggestion is later rejected.
  useEffect(() => {
    if (saveState === 'saved') setPanelOpen(false);
  }, [saveState]);

  // `postagens/:postId` has no `key`, so React Router can reuse this component
  // instance across different posts (see useEditSuggestion's own comment on
  // `currentPostIdRef`). Without this, a still-open panel or stale staged edit
  // from the post just left would carry over onto the newly displayed one.
  const postIdRef = useRef(post.id);
  if (postIdRef.current !== post.id) {
    postIdRef.current = post.id;
    setPanelOpen(false);
    setComentario('');
    setMotivo(null);
    setStagedConteudo(draftConteudo);
    setStagedConteudoPlain(draftConteudoPlain);
    setStagedIgCaption(draftIgCaption ?? '');
  }

  function openPanel() {
    setStagedConteudo(draftConteudo);
    setStagedConteudoPlain(draftConteudoPlain);
    setStagedIgCaption(draftIgCaption ?? '');
    setPanelOpen(true);
  }

  function closePanel() {
    if (contentDirty || comentario.trim() !== '' || motivo) {
      if (!window.confirm(t('shared.discardCorrectionConfirm', 'Descartar as alterações não enviadas?')))
        return;
    }
    setPanelOpen(false);
    setComentario('');
    setMotivo(null);
    // Discard any unsent staged edit so `contentDirty` doesn't stay stuck true
    // (which would leave Aprovar disabled with no panel open to explain why).
    setStagedConteudo(draftConteudo);
    setStagedConteudoPlain(draftConteudoPlain);
    setStagedIgCaption(draftIgCaption ?? '');
  }

  function handleSaveEdicao() {
    saveSuggestion(stagedConteudo, stagedConteudoPlain, stagedIgCaption);
  }

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      if (action === 'correcao') {
        await submitApproval(token, post.id, action, comentario.trim(), motivo ?? undefined);
      } else {
        await submitApproval(token, post.id, action, comentario || undefined);
      }
      setResult({
        type: 'success',
        message:
          action === 'aprovado'
            ? t('shared.postApproved', 'Post aprovado!')
            : t('shared.correctionSent', 'Correção enviada!'),
      });
      onApprovalSubmitted?.();
    } catch (e) {
      setResult({ type: 'error', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  // Storage auto-clean: the media was deleted after publication, so this post
  // landed on the text card. Say so, and keep a path to the live publication.
  const autocleanedLink = post.media_autocleaned_at
    ? post.instagram_permalink
      ? { href: post.instagram_permalink, label: t('shared.viewOnInstagram', 'Ver no Instagram') }
      : post.tiktok_post_url
        ? { href: post.tiktok_post_url, label: t('shared.viewOnTikTok', 'Ver no TikTok') }
        : null
    : null;

  return (
    <div
      className={`hub-bg-card rounded-[10px] border transition-all ${expanded ? 'hub-border-strong shadow-sm' : 'hub-border hover:shadow-sm'}`}
    >
      {post.media_autocleaned_at && (
        <div className="hub-bg-soft rounded-t-[10px] border-b hub-border px-5 py-6 flex flex-col items-center justify-center gap-2 text-center">
          <ImageOff size={20} className="hub-tx3 opacity-60" aria-hidden="true" />
          <span className="text-[12.5px] font-medium hub-tx2">
            {t('textCard.mediaRemoved', 'Mídia removida para liberar espaço')}
          </span>
          {autocleanedLink && (
            <a
              href={sanitizeExternalUrl(autocleanedLink.href)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors hub-bg-card"
              style={{ color: 'var(--hub-acc)', borderColor: 'var(--hub-acc)' }}
            >
              {autocleanedLink.label}
              <ExternalLink size={11} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
      <button
        className="w-full text-left px-5 py-4 flex items-start justify-between gap-3"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold hub-btn-primary px-2 py-0.5 rounded">
              {getTipoLabel(t, post.tipo)}
            </span>
            {post.ig_trial_strategy && (
              <span
                className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border"
                style={{ color: 'var(--hub-acc)', borderColor: 'var(--hub-acc)' }}
              >
                {t('shared.reelDeTeste', 'Reel de teste')}
              </span>
            )}
            <span
              className={`text-[11px] font-semibold ${STATUS_TEXT_COLOR[post.status] ?? 'hub-tx2'}`}
            >
              {getPostStatusLabel(t, post.status)}
            </span>
            <PlatformBadge platform={post.platform} />
            <span className="text-[12px] hub-tx3 ml-auto">
              {formatDate(post.scheduled_at, dateLang)}
            </span>
          </div>
          <p className="font-semibold text-[14px] hub-txt mb-1">{post.titulo}</p>
          {!expanded && preview && <p className="text-[13px] hub-tx2 truncate">{preview}</p>}
        </div>
        <span
          className={`mt-2 shrink-0 hub-tx3 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <ChevronDown size={18} />
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-1 border-t hub-border space-y-4">
          {editingContent && stagedConteudo ? (
            <RichTextContent
              content={stagedConteudo}
              className="text-[13px] hub-tx2 leading-relaxed"
              editable
              onUpdate={(json, plain) => {
                setStagedConteudo(json);
                setStagedConteudoPlain(plain);
              }}
              fallbackText={post.conteudo_plain}
            />
          ) : draftConteudo ? (
            <RichTextContent
              content={draftConteudo}
              className="text-[13px] hub-tx2 leading-relaxed"
              editable={false}
              fallbackText={post.conteudo_plain}
            />
          ) : post.conteudo_plain ? (
            <p className="text-[13px] hub-tx2 leading-relaxed whitespace-pre-wrap">
              {post.conteudo_plain}
            </p>
          ) : null}

          {editingContent && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveEdicao}
                disabled={!contentDirty || saveState === 'saving'}
                className="hub-btn-secondary rounded py-2 px-3 text-[12px] font-semibold disabled:opacity-50 transition-colors"
              >
                {saveState === 'saving'
                  ? t('shared.saving', 'Salvando...')
                  : t('shared.salvarEdicao', 'Salvar edição')}
              </button>
              {saveState === 'saving' && (
                <span className="text-[11px] hub-tx3">
                  {t('shared.savingSuggestion', 'Salvando sugestão...')}
                </span>
              )}
              {saveState === 'saved' && (
                <span className="text-[11px] text-emerald-600 font-medium">
                  {t('shared.suggestionSaved', 'Sugestão salva')}
                </span>
              )}
              {dirty && saveState === 'idle' && !contentDirty && (
                <span className="text-[11px] text-rose-600">
                  {t('shared.saveFailedRetry', 'Não foi possível salvar. Tente novamente.')}
                </span>
              )}
            </div>
          )}

          {isEditable && !hasPendingSuggestion && (
            <div
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg ring-1 ${wasRejected ? 'bg-amber-50 ring-amber-200/40' : 'bg-emerald-50 ring-emerald-200/40'}`}
            >
              <span
                className={`text-[11px] ${wasRejected ? 'text-amber-800' : 'text-emerald-800'}`}
              >
                {wasRejected
                  ? t(
                      'shared.rejectedSuggestionWarning',
                      '⚠️ Sua sugestão anterior foi rejeitada pela equipe. Edite novamente para enviar uma nova.',
                    )
                  : t(
                      'shared.suggestionInfoNote',
                      'ℹ️ Suas edições serão enviadas como sugestão para a equipe revisar',
                    )}
              </span>
            </div>
          )}

          {editingContent ? (
            <div className="border-l-2 hub-border pl-3">
              <p className="text-[11px] hub-tx3 font-medium mb-1">
                {t('textCard.instagramCaptionLabel', 'Legenda do Instagram')}
              </p>
              <textarea
                value={stagedIgCaption}
                onChange={(e) => setStagedIgCaption(e.target.value)}
                className="w-full text-[13px] hub-tx2 leading-relaxed border border-dashed hub-border-strong rounded-lg px-3 py-2 resize-none min-h-[60px] focus:outline-none focus:border-[var(--hub-bd2)] focus:border-solid transition-colors"
              />
            </div>
          ) : (
            (draftIgCaption || post.ig_caption) && (
              <div className="border-l-2 hub-border pl-3">
                <p className="text-[11px] hub-tx3 font-medium mb-1">
                  {t('textCard.instagramCaptionLabel', 'Legenda do Instagram')}
                </p>
                <p className="text-[13px] hub-tx2 leading-relaxed whitespace-pre-wrap">
                  {post.ig_caption}
                </p>
              </div>
            )
          )}

          {isPending && !result && (
            <div className="space-y-3">
              {hasPendingSuggestion ? (
                <div className="rounded-lg px-4 py-3 text-[13px] font-medium bg-amber-50 text-amber-800 ring-1 ring-amber-200/60 text-center">
                  {t(
                    'shared.suggestionPendingReviewFull',
                    'Sugestão enviada para revisão da equipe',
                  )}
                </div>
              ) : !panelOpen ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction('aprovado')}
                    disabled={submitting || approvalBlocked || dirty || contentDirty}
                    className="flex-1 flex items-center justify-center gap-1.5 hub-btn-primary rounded py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50 transition-colors"
                  >
                    <CheckCircle size={14} />{' '}
                    {saveState === 'saving'
                      ? t('shared.saving', 'Salvando...')
                      : t('shared.aprovar', 'Aprovar')}
                  </button>
                  <button
                    onClick={openPanel}
                    disabled={submitting}
                    className="flex-1 flex items-center justify-center gap-1.5 hub-btn-secondary rounded py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50 transition-colors"
                  >
                    <AlertCircle size={14} /> {t('shared.correcaoShort', 'Correção')}
                  </button>
                </div>
              ) : (
                <>
                  <textarea
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    placeholder={t('shared.commentPlaceholder', 'Descreva o que precisa mudar')}
                    className="hub-focus-accent w-full rounded border hub-border px-4 py-3 text-[13px] resize-none min-h-[70px] hub-bg-card hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none focus:border-[var(--hub-bd2)] focus:ring-4 transition-all"
                  />
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium hub-tx3">
                      {t('correctionReason.title', 'Motivo da correção')}
                    </p>
                    <CorrectionReasonChips
                      value={motivo}
                      onChange={setMotivo}
                      disabled={submitting || approvalBlocked}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction('correcao')}
                      disabled={submitting || approvalBlocked || dirty || contentDirty}
                      className="flex-1 flex items-center justify-center gap-1.5 hub-btn-secondary rounded py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50 transition-colors"
                    >
                      <AlertCircle size={14} /> {t('shared.enviarCorrecao', 'Enviar correção')}
                    </button>
                    <button
                      onClick={closePanel}
                      disabled={dirty}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded border hub-border py-2.5 min-h-[44px] text-[13px] font-semibold hub-tx2 disabled:opacity-50 transition-colors"
                    >
                      {t('shared.fechar', 'Fechar')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {result && (
            <div
              className={`rounded-lg px-4 py-3 text-[13px] font-medium ${result.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}
            >
              {result.message}
            </div>
          )}

          <PostHistoryPanel
            post={post}
            token={token}
            approvals={approvals}
            onCommentSent={onApprovalSubmitted}
          />
        </div>
      )}
    </div>
  );
}

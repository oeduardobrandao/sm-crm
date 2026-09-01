import { useState, useEffect, useRef } from 'react';
import { CheckCircle, AlertCircle, ChevronDown, MessageSquare, Send } from 'lucide-react';
import { submitApproval } from '../api';
import type { HubPost, PostApproval, HubPostProperty, HubSelectOption } from '../types';
import { PostMediaLightbox } from './PostMediaLightbox';
import { OptimizedImage } from './OptimizedImage';
import { RichTextContent } from './RichTextContent';
import { MediaUnavailable } from './MediaUnavailable';
import { useEditSuggestion } from '../hooks/useEditSuggestion';
import { sanitizeExternalUrl } from '../lib/security';
import { StatusPill } from './StatusPill';

export const TIPO_LABEL: Record<string, string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};

export const STATUS_LABEL: Record<string, string> = {
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  publicado: 'Publicado',
  rascunho: 'Rascunho',
  revisao_interna: 'Revisão interna',
  aprovado_interno: 'Aprovado interno',
};

export const PLATFORM_LABEL: Record<'instagram' | 'tiktok' | 'both', string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  both: 'Instagram + TikTok',
};

/**
 * Small, purely presentational chip showing which platform(s) a post targets.
 * `platform` is optional on `HubPost` — pre-migration rows and stale cached
 * payloads omit it, which we treat the same as 'instagram' (mirrors the DB
 * default), so the badge always renders exactly one of the three labels.
 */
export function PlatformBadge({
  platform,
  tone = 'neutral',
}: {
  platform?: HubPost['platform'];
  tone?: 'neutral' | 'overlay';
}) {
  const label = PLATFORM_LABEL[platform ?? 'instagram'] ?? PLATFORM_LABEL.instagram;
  const toneClass =
    tone === 'overlay'
      ? 'bg-white/15 text-white/90 ring-1 ring-white/25 backdrop-blur-sm'
      : 'bg-stone-100 text-stone-500 ring-1 ring-stone-200/70 dark:bg-stone-800 dark:text-stone-400 dark:ring-stone-700/60';
  return (
    <span
      className={`inline-flex items-center shrink-0 whitespace-nowrap text-[10px] font-medium px-1.5 py-0.5 rounded-full ${toneClass}`}
    >
      {label}
    </span>
  );
}

export function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

type PropDef = HubPostProperty['template_property_definitions'];
type SelectOpt = { id: string; label: string; color: string };

function resolveOptions(
  def: PropDef,
  workflowSelectOptions: HubSelectOption[],
  workflowId?: number | null,
): SelectOpt[] {
  const templateOpts: SelectOpt[] = (def.config?.options ?? []).map((o) => ({
    id: o.id,
    label: o.label,
    color: o.color,
  }));
  const workflowOpts: SelectOpt[] = workflowSelectOptions
    .filter((o) => workflowId == null || o.workflow_id === workflowId)
    .map((o) => ({ id: o.option_id, label: o.label, color: o.color }));
  return [...templateOpts, ...workflowOpts];
}

function PropertyRow({
  prop,
  workflowSelectOptions,
  workflowId,
}: {
  prop: HubPostProperty;
  workflowSelectOptions: HubSelectOption[];
  workflowId: number | null;
}) {
  const def = prop.template_property_definitions;
  const value = prop.value;

  const renderValue = () => {
    if (value === null || value === undefined || value === '') {
      return <span className="text-muted-foreground italic text-sm">—</span>;
    }
    if (def.type === 'url') {
      const safe = sanitizeExternalUrl(String(value));
      return (
        <a
          href={safe}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline break-all"
        >
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      );
    }
    if (def.type === 'date') {
      const raw = String(value);
      const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const formatted = m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
      return <span className="text-sm">{formatted}</span>;
    }
    if (def.type === 'checkbox') {
      return <span className="text-sm">{value ? 'Sim' : 'Não'}</span>;
    }
    if (def.type === 'select' || def.type === 'status') {
      const options = resolveOptions(def, workflowSelectOptions, workflowId);
      const opt = options.find((o) => o.id === value);
      if (!opt) return <span className="text-sm text-muted-foreground italic">—</span>;
      return (
        <span
          className="text-xs px-2 py-0.5 rounded-full border"
          style={{ background: opt.color + '22', color: opt.color, borderColor: opt.color + '55' }}
        >
          {opt.label}
        </span>
      );
    }
    if (def.type === 'multiselect') {
      const options = resolveOptions(def, workflowSelectOptions, workflowId);
      const selected = (value as string[])
        .map((id) => options.find((o) => o.id === id))
        .filter(Boolean) as SelectOpt[];
      if (selected.length === 0)
        return <span className="text-sm text-muted-foreground italic">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {selected.map((opt) => (
            <span
              key={opt.id}
              className="text-xs px-2 py-0.5 rounded-full border"
              style={{
                background: opt.color + '22',
                color: opt.color,
                borderColor: opt.color + '55',
              }}
            >
              {opt.label}
            </span>
          ))}
        </div>
      );
    }
    return <span className="text-sm">{String(value)}</span>;
  };

  return (
    <div className="flex items-start gap-3 py-2.5 border-b hub-border last:border-b-0">
      <span className="text-[12.5px] hub-tx2 w-36 shrink-0 pt-0.5">{def.name}</span>
      <div className="flex-1 min-w-0 hub-txt">{renderValue()}</div>
    </div>
  );
}

export interface PostCardProps {
  post: HubPost;
  token: string;
  approvals: PostApproval[];
  propertyValues: HubPostProperty[];
  workflowSelectOptions: HubSelectOption[];
  onApprovalSubmitted: () => void;
  defaultExpanded?: boolean;
}

export function PostCard({
  post,
  token,
  approvals,
  propertyValues,
  workflowSelectOptions,
  onApprovalSubmitted,
  defaultExpanded,
}: PostCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (defaultExpanded && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [defaultExpanded]);
  const [comentario, setComentario] = useState('');
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const isPending = post.status === 'enviado_cliente';

  const {
    isEditable,
    hasPendingSuggestion,
    wasRejected,
    saveSuggestion,
    saveState,
    approvalBlocked,
    draftConteudo,
    draftIgCaption,
  } = useEditSuggestion({
    token,
    post,
    onSaved: onApprovalSubmitted,
  });
  const igCaptionRef = useRef(draftIgCaption ?? '');
  const postApprovals = approvals.filter((a) => a.post_id === post.id);
  const postProperties = propertyValues.filter((p) => p.post_id === post.id);
  const displayCover =
    post.cover_media ?? (post.media && post.media.length > 0 ? post.media[0] : null);

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      await submitApproval(token, post.id, action, comentario || undefined);
      setResult({
        type: 'success',
        message: action === 'aprovado' ? 'Post aprovado!' : 'Correção enviada!',
      });
      onApprovalSubmitted();
    } catch (e) {
      setResult({ type: 'error', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReply() {
    if (!replyText.trim()) return;
    setSendingReply(true);
    try {
      await submitApproval(token, post.id, 'mensagem', replyText.trim());
      setReplyText('');
      onApprovalSubmitted();
    } catch (e) {
      setResult({ type: 'error', message: (e as Error).message || 'Erro ao enviar mensagem.' });
    } finally {
      setSendingReply(false);
    }
  }

  return (
    <div ref={cardRef} className="hub-card overflow-hidden transition-shadow hover:shadow-md">
      {displayCover ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const coverIdx = post.media?.findIndex((m) => m.id === displayCover.id) ?? 0;
            setLightboxIdx(Math.max(0, coverIdx));
          }}
          className="relative block w-full aspect-[4/3] overflow-hidden hub-bg-soft"
        >
          {displayCover.media_lost_at ? (
            <MediaUnavailable size="full" />
          ) : displayCover.kind === 'image' ? (
            <OptimizedImage
              src={displayCover.url ?? ''}
              alt=""
              width={displayCover.width ?? undefined}
              height={displayCover.height ?? undefined}
              blurDataURL={displayCover.blur_data_url ?? undefined}
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="w-full h-full object-cover"
            />
          ) : (
            <>
              <img
                src={displayCover.thumbnail_url ?? ''}
                alt=""
                width={4}
                height={3}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </span>
            </>
          )}
        </button>
      ) : (
        <div className="w-full aspect-[4/3] hub-bg-soft flex flex-col items-center justify-center gap-2 hub-tx3">
          <svg
            className="h-8 w-8 opacity-40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <span className="text-[11.5px] font-medium">Nenhuma imagem adicionada</span>
        </div>
      )}
      <button
        className="w-full flex items-start justify-between gap-3 px-5 py-4 text-left hover:bg-[var(--hub-soft)] transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[11px] font-semibold hub-btn-primary px-2 py-0.5 rounded-full">
              {TIPO_LABEL[post.tipo] ?? post.tipo}
            </span>
            {post.status === 'agendado' ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60">
                {STATUS_LABEL[post.status] ?? post.status}
              </span>
            ) : (
              <StatusPill
                tone={
                  post.status === 'correcao_cliente' ? 'danger' : isPending ? 'accent' : 'neutral'
                }
              >
                {STATUS_LABEL[post.status] ?? post.status}
              </StatusPill>
            )}
            <PlatformBadge platform={post.platform} />
          </div>
          <p className="font-display font-semibold text-[16px] tracking-tight hub-txt leading-snug">
            {post.titulo}
          </p>
          {post.scheduled_at && (
            <p className="text-[12px] hub-tx2 mt-1">{formatDate(post.scheduled_at)}</p>
          )}
        </div>
        <span
          className={`mt-1 shrink-0 flex items-center justify-center w-7 h-7 rounded-full hub-tx2 transition-all ${expanded ? 'hub-bg-soft rotate-180' : 'hover:bg-[var(--hub-soft)]'}`}
        >
          <ChevronDown size={15} />
        </span>
      </button>

      {expanded && (
        <div className="border-t hub-border px-5 pb-5 pt-4 space-y-5 hub-bg-soft">
          {draftConteudo ? (
            <RichTextContent
              content={draftConteudo}
              className="text-[13.5px] hub-tx2 leading-relaxed"
              editable={isEditable}
              onUpdate={
                isEditable
                  ? (json, plain) => {
                      saveSuggestion(json, plain, igCaptionRef.current);
                    }
                  : undefined
              }
              fallbackText={post.conteudo_plain}
            />
          ) : post.conteudo_plain ? (
            <p className="text-[13.5px] hub-tx2 leading-relaxed whitespace-pre-wrap">
              {post.conteudo_plain}
            </p>
          ) : null}

          {isEditable && saveState !== 'idle' && (
            <div className="flex items-center gap-1.5">
              {saveState === 'saving' && (
                <span className="text-[11px] hub-tx3">Salvando sugestão...</span>
              )}
              {saveState === 'saved' && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[11px] text-emerald-600 font-medium">Sugestão salva</span>
                </>
              )}
            </div>
          )}

          {isEditable && (
            <div
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg ring-1 ${wasRejected ? 'bg-amber-50 ring-amber-200/40' : 'bg-emerald-50 ring-emerald-200/40'}`}
            >
              <span
                className={`text-[11px] ${wasRejected ? 'text-amber-800' : 'text-emerald-800'}`}
              >
                {wasRejected
                  ? '⚠️ Sua sugestão anterior foi rejeitada pela equipe. Edite novamente para enviar uma nova.'
                  : 'ℹ️ Suas edições serão enviadas como sugestão para a equipe revisar'}
              </span>
            </div>
          )}

          {post.media && post.media.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {post.media.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setLightboxIdx(i)}
                  className="shrink-0 w-20 h-20 rounded-lg overflow-hidden hub-bg-soft ring-1 ring-[var(--hub-bd)] hover:ring-[var(--hub-bd2)] transition-all"
                >
                  {m.media_lost_at ? (
                    <MediaUnavailable size="compact" />
                  ) : m.kind === 'image' ? (
                    <OptimizedImage
                      src={m.thumbnail_url ?? m.url ?? ''}
                      alt=""
                      width={80}
                      height={80}
                      blurDataURL={m.blur_data_url ?? undefined}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={m.thumbnail_url ?? ''}
                      alt=""
                      width={80}
                      height={80}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  )}
                </button>
              ))}
            </div>
          )}

          {postProperties.length > 0 && (
            <div className="rounded-xl border hub-border hub-bg-card px-4 pt-3 pb-1">
              <p className="text-[12px] font-semibold hub-tx3 pb-2">Propriedades</p>
              {postProperties.map((p) => (
                <PropertyRow
                  key={`${p.post_id}-${p.template_property_definitions.name}`}
                  prop={p}
                  workflowSelectOptions={workflowSelectOptions}
                  workflowId={post.workflow_id}
                />
              ))}
            </div>
          )}

          {postApprovals.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold hub-tx3">
                <MessageSquare size={12} /> Comentários
              </div>
              {postApprovals.map((a) => {
                const isTeam = a.is_workspace_user;
                const label = isTeam
                  ? 'Equipe'
                  : a.action === 'correcao'
                    ? 'Correção solicitada'
                    : a.action === 'aprovado'
                      ? 'Aprovado'
                      : 'Você';
                const date = new Date(a.created_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <div
                    key={a.id}
                    className={`rounded-xl px-4 py-3 text-[13.5px] ${
                      isTeam ? 'ml-6' : 'hub-bg-card ring-1 ring-[var(--hub-bd)] mr-6'
                    }`}
                    style={
                      isTeam
                        ? {
                            background: 'color-mix(in srgb, var(--hub-txt) 6%, transparent)',
                            boxShadow:
                              'inset 0 0 0 1px color-mix(in srgb, var(--hub-txt) 14%, transparent)',
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`font-semibold text-[11.5px] ${isTeam ? 'hub-acc-text' : 'hub-txt'}`}
                      >
                        {label}
                      </span>
                      <span className="text-[11px] hub-tx3">{date}</span>
                    </div>
                    {a.comentario && (
                      <p className="text-[13.5px] leading-relaxed hub-txt">{a.comentario}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!isPending && (
            <div className="flex items-center gap-2">
              <input
                className="hub-focus-accent flex-1 rounded-full border hub-border hub-bg-card px-4 py-2.5 text-[13.5px] hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none focus:border-[var(--hub-bd2)] focus:ring-4 transition-all"
                placeholder="Enviar mensagem…"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleReply();
                  }
                }}
              />
              <button
                className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full hub-btn-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                disabled={sendingReply || !replyText.trim()}
                onClick={handleReply}
                aria-label="Enviar"
              >
                <Send size={14} />
              </button>
            </div>
          )}

          {isPending && !result && (
            <div className="space-y-3">
              {hasPendingSuggestion ? (
                <div className="rounded-xl px-4 py-3 text-[13px] font-medium bg-amber-50 text-amber-800 ring-1 ring-amber-200/60 text-center">
                  Sugestão enviada para revisão da equipe
                </div>
              ) : (
                <>
                  <textarea
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    placeholder="Comentário (opcional)…"
                    className="hub-focus-accent w-full rounded-xl border hub-border px-4 py-3 text-[13.5px] resize-none min-h-[80px] hub-bg-card hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none focus:border-[var(--hub-bd2)] focus:ring-4 transition-all"
                  />
                  <div className="flex gap-2.5">
                    <button
                      onClick={() => handleAction('aprovado')}
                      disabled={submitting || approvalBlocked}
                      className="flex-1 flex items-center justify-center gap-2 hub-btn-primary rounded-full py-3 min-h-[44px] text-[13.5px] font-semibold disabled:opacity-50 transition-colors shadow-sm"
                    >
                      <CheckCircle size={15} />{' '}
                      {saveState === 'saving' ? 'Salvando sugestão...' : 'Aprovar'}
                    </button>
                    <button
                      onClick={() => handleAction('correcao')}
                      disabled={submitting || approvalBlocked}
                      className="flex-1 flex items-center justify-center gap-2 rounded-full py-3 min-h-[44px] text-[13.5px] font-semibold hub-btn-secondary disabled:opacity-50 transition-colors"
                    >
                      <AlertCircle size={15} /> Solicitar correção
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {result && (
            <div
              className={`rounded-xl px-4 py-3 text-[13.5px] font-medium ${result.type === 'success' ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/60' : 'bg-rose-50 text-rose-800 ring-1 ring-rose-200/60'}`}
            >
              {result.message}
            </div>
          )}
        </div>
      )}
      {lightboxIdx !== null && post.media && post.media.length > 0 && (
        <PostMediaLightbox
          media={post.media}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onStaleUrl={onApprovalSubmitted}
        />
      )}
    </div>
  );
}

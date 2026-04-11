import { useState, useEffect, useRef } from 'react';
import { CheckCircle, AlertCircle, ChevronDown, MessageSquare, Send } from 'lucide-react';
import { submitApproval } from '../api';
import type { HubPost, PostApproval, HubPostProperty, HubSelectOption } from '../types';
import { PostMediaLightbox } from './PostMediaLightbox';

export const TIPO_LABEL: Record<string, string> = {
  feed: 'Feed', reels: 'Reels', stories: 'Stories', carrossel: 'Carrossel',
};

export const STATUS_LABEL: Record<string, string> = {
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  publicado: 'Publicado',
  rascunho: 'Rascunho',
  em_producao: 'Em produção',
};

export function formatDate(d: string | null) {
  if (!d) return '—';
  const raw = d.includes('T') ? d : `${d}T00:00:00`;
  return new Date(raw).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sanitizeUrl(url: string) {
  return url.startsWith('http') ? url : `https://${url}`;
}

type PropDef = HubPostProperty['template_property_definitions'];
type SelectOpt = { id: string; label: string; color: string };

function resolveOptions(def: PropDef, workflowSelectOptions: HubSelectOption[], workflowId?: number): SelectOpt[] {
  const templateOpts: SelectOpt[] = (def.config?.options ?? []).map(o => ({ id: o.id, label: o.label, color: o.color }));
  const workflowOpts: SelectOpt[] = workflowSelectOptions
    .filter(o => workflowId == null || o.workflow_id === workflowId)
    .map(o => ({ id: o.option_id, label: o.label, color: o.color }));
  return [...templateOpts, ...workflowOpts];
}

function PropertyRow({ prop, workflowSelectOptions, workflowId }: { prop: HubPostProperty; workflowSelectOptions: HubSelectOption[]; workflowId: number }) {
  const def = prop.template_property_definitions;
  const value = prop.value;

  const renderValue = () => {
    if (value === null || value === undefined || value === '') {
      return <span className="text-muted-foreground italic text-sm">—</span>;
    }
    if (def.type === 'url') {
      const safe = sanitizeUrl(String(value));
      return (
        <a href={safe} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all">
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      );
    }
    if (def.type === 'date') {
      return <span className="text-sm">{new Date(String(value)).toLocaleDateString('pt-BR')}</span>;
    }
    if (def.type === 'checkbox') {
      return <span className="text-sm">{value ? 'Sim' : 'Não'}</span>;
    }
    if (def.type === 'select' || def.type === 'status') {
      const options = resolveOptions(def, workflowSelectOptions, workflowId);
      const opt = options.find(o => o.id === value);
      if (!opt) return <span className="text-sm text-muted-foreground italic">—</span>;
      return (
        <span className="text-xs px-2 py-0.5 rounded-full border" style={{ background: opt.color + '22', color: opt.color, borderColor: opt.color + '55' }}>
          {opt.label}
        </span>
      );
    }
    if (def.type === 'multiselect') {
      const options = resolveOptions(def, workflowSelectOptions, workflowId);
      const selected = (value as string[]).map(id => options.find(o => o.id === id)).filter(Boolean) as SelectOpt[];
      if (selected.length === 0) return <span className="text-sm text-muted-foreground italic">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {selected.map(opt => (
            <span key={opt.id} className="text-xs px-2 py-0.5 rounded-full border" style={{ background: opt.color + '22', color: opt.color, borderColor: opt.color + '55' }}>
              {opt.label}
            </span>
          ))}
        </div>
      );
    }
    return <span className="text-sm">{String(value)}</span>;
  };

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-stone-200/70 last:border-b-0">
      <span className="text-[12.5px] text-stone-500 w-36 shrink-0 pt-0.5">{def.name}</span>
      <div className="flex-1 min-w-0 text-stone-900">{renderValue()}</div>
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

export function PostCard({ post, token, approvals, propertyValues, workflowSelectOptions, onApprovalSubmitted, defaultExpanded }: PostCardProps) {
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
  const postApprovals = approvals.filter(a => a.post_id === post.id);
  const postProperties = propertyValues.filter(p => p.post_id === post.id);

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      await submitApproval(token, post.id, action, comentario || undefined);
      setResult({ type: 'success', message: action === 'aprovado' ? 'Post aprovado!' : 'Correção enviada!' });
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

  const statusStyles = post.status === 'correcao_cliente'
    ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/60'
    : isPending
    ? 'bg-[#FFBF30]/18 text-stone-900 ring-1 ring-[#FFBF30]/50'
    : post.status === 'agendado'
    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60'
    : 'bg-stone-100 text-stone-700 ring-1 ring-stone-200/80';

  return (
    <div ref={cardRef} className="hub-card overflow-hidden transition-shadow hover:shadow-md">
      {post.cover_media && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setLightboxIdx(0); }}
          className="relative block w-full aspect-[4/3] overflow-hidden bg-stone-100"
        >
          {post.cover_media.kind === 'image' ? (
            <img src={post.cover_media.url} alt="" className="w-full h-full object-cover" />
          ) : (
            <>
              <img src={post.cover_media.thumbnail_url ?? ''} alt="" className="w-full h-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </span>
              </span>
            </>
          )}
        </button>
      )}
      <button
        className="w-full flex items-start justify-between gap-3 px-5 py-4 text-left hover:bg-stone-50/80 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider bg-stone-900 text-white px-2 py-0.5 rounded-full">
              {TIPO_LABEL[post.tipo] ?? post.tipo}
            </span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusStyles}`}>
              {STATUS_LABEL[post.status] ?? post.status}
            </span>
          </div>
          <p className="font-display font-semibold text-[16px] tracking-tight text-stone-900 leading-snug">{post.titulo}</p>
          {post.scheduled_at && <p className="text-[12px] text-stone-500 mt-1">{formatDate(post.scheduled_at)}</p>}
        </div>
        <span className={`mt-1 shrink-0 flex items-center justify-center w-7 h-7 rounded-full text-stone-500 transition-all ${expanded ? 'bg-stone-100 rotate-180' : 'hover:bg-stone-100'}`}>
          <ChevronDown size={15} />
        </span>
      </button>

      {expanded && (
        <div className="border-t border-stone-200/80 px-5 pb-5 pt-4 space-y-5 bg-stone-50/30">
          {post.conteudo_plain && (
            <p className="text-[13.5px] text-stone-600 leading-relaxed whitespace-pre-wrap">{post.conteudo_plain}</p>
          )}

          {postProperties.length > 0 && (
            <div className="rounded-2xl border border-stone-200/80 bg-white px-4 pt-3 pb-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400 pb-2">Propriedades</p>
              {postProperties.map((p) => (
                <PropertyRow key={`${p.post_id}-${p.template_property_definitions.name}`} prop={p} workflowSelectOptions={workflowSelectOptions} workflowId={post.workflow_id} />
              ))}
            </div>
          )}

          {postApprovals.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400">
                <MessageSquare size={12} /> Comentários
              </div>
              {postApprovals.map(a => {
                const isTeam = a.is_workspace_user;
                const label = isTeam
                  ? 'Equipe'
                  : a.action === 'correcao' ? 'Correção solicitada'
                  : a.action === 'aprovado' ? 'Aprovado'
                  : 'Você';
                const date = new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={a.id} className={`rounded-2xl px-4 py-3 text-[13.5px] ${
                    isTeam
                      ? 'bg-[#FFBF30]/10 ring-1 ring-[#FFBF30]/25 ml-6'
                      : 'bg-white ring-1 ring-stone-200/80 mr-6'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-semibold text-[11.5px] ${isTeam ? 'text-amber-900' : 'text-stone-900'}`}>{label}</span>
                      <span className="text-[11px] text-stone-400">{date}</span>
                    </div>
                    {a.comentario && <p className="text-[13.5px] leading-relaxed text-stone-800">{a.comentario}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {!isPending && (
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded-full border border-stone-200/80 bg-white px-4 py-2.5 text-[13.5px] text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-300 focus:ring-4 focus:ring-[#FFBF30]/15 transition-all"
                placeholder="Enviar mensagem…"
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
              />
              <button
                className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
              <textarea
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder="Comentário (opcional)…"
                className="w-full rounded-2xl border border-stone-200/80 px-4 py-3 text-[13.5px] resize-none min-h-[80px] bg-white text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-300 focus:ring-4 focus:ring-[#FFBF30]/15 transition-all"
              />
              <div className="flex gap-2.5">
                <button
                  onClick={() => handleAction('aprovado')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 bg-stone-900 text-white rounded-full py-3 text-[13.5px] font-semibold hover:bg-stone-800 disabled:opacity-50 transition-colors shadow-sm"
                >
                  <CheckCircle size={15} /> Aprovar
                </button>
                <button
                  onClick={() => handleAction('correcao')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 border border-stone-200/80 bg-white text-stone-800 rounded-full py-3 text-[13.5px] font-semibold hover:border-stone-300 hover:bg-stone-50 disabled:opacity-50 transition-colors"
                >
                  <AlertCircle size={15} /> Solicitar correção
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className={`rounded-2xl px-4 py-3 text-[13.5px] font-medium ${result.type === 'success' ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/60' : 'bg-rose-50 text-rose-800 ring-1 ring-rose-200/60'}`}>
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

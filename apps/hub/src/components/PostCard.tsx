import { useState } from 'react';
import { CheckCircle, AlertCircle, ChevronDown, ChevronUp, MessageSquare, Send } from 'lucide-react';
import { submitApproval } from '../api';
import type { HubPost, PostApproval, HubPostProperty, HubSelectOption } from '../types';

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
    <div className="flex items-start gap-3 py-2 border-b last:border-b-0">
      <span className="text-sm text-muted-foreground w-36 shrink-0 pt-0.5">{def.name}</span>
      <div className="flex-1 min-w-0">{renderValue()}</div>
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
}

export function PostCard({ post, token, approvals, propertyValues, workflowSelectOptions, onApprovalSubmitted }: PostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [comentario, setComentario] = useState('');
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
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
    } catch {
      // silent
    } finally {
      setSendingReply(false);
    }
  }

  const statusColor = post.status === 'correcao_cliente'
    ? 'bg-red-50 text-red-700'
    : isPending
    ? 'bg-yellow-100 text-yellow-800'
    : 'bg-green-100 text-green-800';

  return (
    <div className="border rounded-xl bg-white overflow-hidden">
      <button
        className="w-full flex items-start justify-between gap-2 p-4 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full font-medium">{TIPO_LABEL[post.tipo] ?? post.tipo}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
              {STATUS_LABEL[post.status] ?? post.status}
            </span>
          </div>
          <p className="font-semibold text-sm">{post.titulo}</p>
          {post.scheduled_at && <p className="text-xs text-muted-foreground mt-1">{formatDate(post.scheduled_at)}</p>}
        </div>
        <span className="text-muted-foreground mt-0.5 shrink-0">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-4">
          {post.conteudo_plain && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{post.conteudo_plain}</p>
          )}

          {postProperties.length > 0 && (
            <div className="rounded-lg border bg-muted/40 px-3 py-1">
              <p className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground pt-2 pb-1">Propriedades</p>
              {postProperties.map((p, i) => (
                <PropertyRow key={i} prop={p} workflowSelectOptions={workflowSelectOptions} workflowId={post.workflow_id} />
              ))}
            </div>
          )}

          {postApprovals.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
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
                  <div key={a.id} className={`rounded-xl px-3 py-2.5 text-sm ${isTeam ? 'bg-amber-50 ml-8' : 'bg-muted mr-8'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-semibold text-xs ${isTeam ? 'text-amber-800' : ''}`}>{label}</span>
                      <span className="text-xs text-muted-foreground">{date}</span>
                    </div>
                    {a.comentario && <p className="text-sm">{a.comentario}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {!isPending && (
            <div className="flex items-center gap-2">
              <input
                className="flex-1 border rounded-xl px-3 py-2 text-sm bg-muted/30 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Enviar mensagem…"
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
              />
              <button
                className="shrink-0 rounded-xl p-2 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
                disabled={sendingReply || !replyText.trim()}
                onClick={handleReply}
              >
                <Send size={15} />
              </button>
            </div>
          )}

          {isPending && !result && (
            <div className="space-y-2">
              <textarea
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder="Comentário (opcional)…"
                className="w-full border rounded-xl p-3 text-sm resize-none min-h-[64px] bg-muted/30 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction('aprovado')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle size={15} /> Aprovar
                </button>
                <button
                  onClick={() => handleAction('correcao')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 border text-destructive rounded-xl py-2.5 text-sm font-semibold hover:bg-destructive/5 disabled:opacity-50 transition-colors"
                >
                  <AlertCircle size={15} /> Solicitar correção
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className={`rounded-xl p-3 text-sm font-medium ${result.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {result.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

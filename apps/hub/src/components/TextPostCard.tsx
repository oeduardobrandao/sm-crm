import { useState } from 'react';
import { CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';
import { submitApproval } from '../api';
import { TIPO_LABEL, STATUS_LABEL, formatDate } from './PostCard';
import type { HubPost, PostApproval } from '../types';

interface TextPostCardProps {
  post: HubPost;
  token: string;
  approvals: PostApproval[];
  onApprovalSubmitted?: () => void;
  readOnly?: boolean;
}

export function TextPostCard({ post, token, approvals, onApprovalSubmitted, readOnly }: TextPostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const isPending = !readOnly && post.status === 'enviado_cliente';
  const preview = post.ig_caption || post.conteudo_plain;

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      await submitApproval(token, post.id, action, comentario || undefined);
      setResult({ type: 'success', message: action === 'aprovado' ? 'Post aprovado!' : 'Correção enviada!' });
      onApprovalSubmitted?.();
    } catch (e) {
      setResult({ type: 'error', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`bg-white rounded-[10px] border transition-all ${expanded ? 'border-stone-300 shadow-sm' : 'border-stone-200 hover:shadow-sm'}`}>
      <button
        className="w-full text-left px-5 py-4 flex items-start justify-between gap-3"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider bg-stone-900 text-white px-2 py-0.5 rounded">
              {TIPO_LABEL[post.tipo] ?? post.tipo}
            </span>
            <span className="text-[11px] font-semibold text-amber-600">
              {STATUS_LABEL[post.status] ?? post.status}
            </span>
            <span className="text-[12px] text-stone-400 ml-auto">{formatDate(post.scheduled_at)}</span>
          </div>
          <p className="font-semibold text-[14px] text-stone-900 mb-1">{post.titulo}</p>
          {!expanded && preview && (
            <p className="text-[13px] text-stone-500 truncate">{preview}</p>
          )}
        </div>
        <span className={`mt-2 shrink-0 text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
          <ChevronDown size={18} />
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-1 border-t border-stone-100 space-y-4">
          {post.conteudo_plain && (
            <p className="text-[13px] text-stone-600 leading-relaxed whitespace-pre-wrap">{post.conteudo_plain}</p>
          )}
          {post.ig_caption && (
            <div className="border-l-2 border-stone-200 pl-3">
              <p className="text-[11px] text-stone-400 font-medium mb-1">Legenda do Instagram</p>
              <p className="text-[13px] text-stone-600 leading-relaxed whitespace-pre-wrap">{post.ig_caption}</p>
            </div>
          )}

          {isPending && !result && (
            <div className="space-y-3">
              <textarea
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder="Comentário (necessário para solicitar correção)…"
                className="w-full rounded border border-stone-200 px-4 py-3 text-[13px] resize-none min-h-[70px] bg-white text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-300 focus:ring-4 focus:ring-[#FFBF30]/15 transition-all"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction('aprovado')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-stone-900 text-white rounded py-2.5 text-[13px] font-semibold hover:bg-stone-800 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle size={14} /> Aprovar
                </button>
                <button
                  onClick={() => handleAction('correcao')}
                  disabled={submitting || !comentario.trim()}
                  title={!comentario.trim() ? 'Deixe um comentário para solicitar correção' : undefined}
                  className="flex-1 flex items-center justify-center gap-1.5 border border-stone-200 bg-white text-stone-800 rounded py-2.5 text-[13px] font-semibold hover:bg-stone-50 disabled:opacity-50 transition-colors"
                >
                  <AlertCircle size={14} /> Solicitar correção
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className={`rounded-lg px-4 py-3 text-[13px] font-medium ${result.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
              {result.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

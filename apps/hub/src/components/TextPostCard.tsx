import { useState, useRef } from 'react';
import { CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';
import { submitApproval } from '../api';
import { TIPO_LABEL, STATUS_LABEL, formatDate } from './PostCard';
import { RichTextContent } from './RichTextContent';
import type { HubPost, PostApproval } from '../types';
import { useEditSuggestion } from '../hooks/useEditSuggestion';

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
  const [expanded, setExpanded] = useState(false);
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const isPending = !readOnly && post.status === 'enviado_cliente';
  const preview = post.ig_caption || post.conteudo_plain;

  const {
    isEditable: canEdit,
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
    onSaved: () => onApprovalSubmitted?.(),
  });
  const isEditable = canEdit && !readOnly;
  const igCaptionRef = useRef(draftIgCaption ?? '');

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      await submitApproval(token, post.id, action, comentario || undefined);
      setResult({
        type: 'success',
        message: action === 'aprovado' ? 'Post aprovado!' : 'Correção enviada!',
      });
      onApprovalSubmitted?.();
    } catch (e) {
      setResult({ type: 'error', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={`bg-white rounded-[10px] border transition-all ${expanded ? 'border-stone-300 shadow-sm' : 'border-stone-200 hover:shadow-sm'}`}
    >
      <button
        className="w-full text-left px-5 py-4 flex items-start justify-between gap-3"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider bg-stone-900 text-white px-2 py-0.5 rounded">
              {TIPO_LABEL[post.tipo] ?? post.tipo}
            </span>
            <span className="text-[11px] font-semibold text-amber-600">
              {STATUS_LABEL[post.status] ?? post.status}
            </span>
            <span className="text-[12px] text-stone-400 ml-auto">
              {formatDate(post.scheduled_at)}
            </span>
          </div>
          <p className="font-semibold text-[14px] text-stone-900 mb-1">{post.titulo}</p>
          {!expanded && preview && <p className="text-[13px] text-stone-500 truncate">{preview}</p>}
        </div>
        <span
          className={`mt-2 shrink-0 text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <ChevronDown size={18} />
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-1 border-t border-stone-100 space-y-4">
          {draftConteudo ? (
            <RichTextContent
              content={draftConteudo}
              className="text-[13px] text-stone-600 leading-relaxed"
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
            <p className="text-[13px] text-stone-600 leading-relaxed whitespace-pre-wrap">
              {post.conteudo_plain}
            </p>
          ) : null}

          {isEditable && saveState !== 'idle' && (
            <div className="flex items-center gap-1.5">
              {saveState === 'saving' && (
                <span className="text-[11px] text-stone-400">Salvando sugestão...</span>
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

          {(draftIgCaption || post.ig_caption) && (
            <div className="border-l-2 border-stone-200 pl-3">
              <p className="text-[11px] text-stone-400 font-medium mb-1">Legenda do Instagram</p>
              {isEditable ? (
                <textarea
                  defaultValue={draftIgCaption ?? ''}
                  onChange={(e) => {
                    igCaptionRef.current = e.target.value;
                    saveSuggestion(draftConteudo, post.conteudo_plain, e.target.value);
                  }}
                  className="w-full text-[13px] text-stone-600 leading-relaxed border border-dashed border-stone-300 rounded-lg px-3 py-2 resize-none min-h-[60px] focus:outline-none focus:border-stone-400 focus:border-solid transition-colors"
                />
              ) : (
                <p className="text-[13px] text-stone-600 leading-relaxed whitespace-pre-wrap">
                  {post.ig_caption}
                </p>
              )}
            </div>
          )}

          {isPending && !result && (
            <div className="space-y-3">
              {hasPendingSuggestion ? (
                <div className="rounded-lg px-4 py-3 text-[13px] font-medium bg-amber-50 text-amber-800 ring-1 ring-amber-200/60 text-center">
                  Sugestão enviada para revisão da equipe
                </div>
              ) : (
                <>
                  <textarea
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    placeholder="Comente aqui ou corrija o texto diretamente no campo acima"
                    className="w-full rounded border border-stone-200 px-4 py-3 text-[13px] resize-none min-h-[70px] bg-white text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-300 focus:ring-4 focus:ring-[#FFBF30]/15 transition-all"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction('aprovado')}
                      disabled={submitting || approvalBlocked}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-stone-900 text-white rounded py-2.5 min-h-[44px] text-[13px] font-semibold hover:bg-stone-800 disabled:opacity-50 transition-colors"
                    >
                      <CheckCircle size={14} /> {saveState === 'saving' ? 'Salvando...' : 'Aprovar'}
                    </button>
                    <button
                      onClick={() => handleAction('correcao')}
                      disabled={submitting || approvalBlocked || !comentario.trim()}
                      title={
                        !comentario.trim()
                          ? 'Deixe um comentário para solicitar correção'
                          : undefined
                      }
                      className="flex-1 flex items-center justify-center gap-1.5 border border-stone-200 bg-white text-stone-800 rounded py-2.5 min-h-[44px] text-[13px] font-semibold hover:bg-stone-50 disabled:opacity-50 transition-colors"
                    >
                      <AlertCircle size={14} /> Solicitar correção
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
        </div>
      )}
    </div>
  );
}

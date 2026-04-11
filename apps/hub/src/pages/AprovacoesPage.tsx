import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPosts, submitApproval } from '../api';
import type { HubPost, PostApproval } from '../types';

const TIPO_LABEL: Record<string, string> = {
  feed: 'Feed', reels: 'Reels', stories: 'Stories', carrossel: 'Carrossel',
};

const STATUS_LABEL: Record<string, string> = {
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  publicado: 'Publicado',
  rascunho: 'Rascunho',
  em_producao: 'Em produção',
};

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function PostCard({ post, token, approvals }: { post: HubPost; token: string; approvals: PostApproval[] }) {
  const [expanded, setExpanded] = useState(false);
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const qc = useQueryClient();
  const isPending = post.status === 'enviado_cliente';
  const postApprovals = approvals.filter(a => a.post_id === post.id);

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      await submitApproval(token, post.id, action, comentario || undefined);
      setResult({ type: 'success', message: action === 'aprovado' ? 'Post aprovado!' : 'Correção enviada!' });
      qc.invalidateQueries({ queryKey: ['hub-posts', token] });
    } catch (e) {
      setResult({ type: 'error', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border rounded-xl bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{TIPO_LABEL[post.tipo] ?? post.tipo}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${isPending ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
              {STATUS_LABEL[post.status] ?? post.status}
            </span>
          </div>
          <p className="font-medium text-sm line-clamp-2">{post.titulo}</p>
          <p className="text-xs text-muted-foreground mt-1">{formatDate(post.scheduled_at)}</p>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 border-t pt-3">
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{post.conteudo_plain}</p>

          {postApprovals.length > 0 && (
            <div className="mt-4 space-y-2">
              {postApprovals.map(a => {
                const isTeam = a.is_workspace_user;
                const label = isTeam ? 'Equipe' : a.action === 'correcao' ? 'Correção solicitada' : a.action === 'aprovado' ? 'Aprovado' : 'Você';
                const date = new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={a.id} className={`rounded-xl px-3 py-2 text-sm ${isTeam ? 'bg-primary/10 ml-6' : 'bg-muted mr-6'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-xs">{label}</span>
                      <span className="text-xs text-muted-foreground">{date}</span>
                    </div>
                    {a.comentario && <p className="text-sm">{a.comentario}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {isPending && !result && (
            <div className="mt-4 space-y-2">
              <textarea
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder="Comentário (opcional)..."
                className="w-full border rounded-lg p-2 text-sm resize-none min-h-[60px]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction('aprovado')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  <CheckCircle size={15} /> Aprovar
                </button>
                <button
                  onClick={() => handleAction('correcao')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 border text-destructive rounded-lg py-2 text-sm font-medium hover:bg-destructive/5 disabled:opacity-50"
                >
                  <AlertCircle size={15} /> Solicitar correção
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className={`mt-3 rounded-lg p-3 text-sm ${result.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {result.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AprovacoesPage() {
  const { token } = useHub();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const approvals = data?.postApprovals ?? [];
  const pending = (data?.posts ?? [])
    .filter(p => p.status === 'enviado_cliente')
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-1">Aprovações</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {pending.length === 0 ? 'Nenhum post aguardando aprovação.' : `${pending.length} post${pending.length > 1 ? 's' : ''} aguardando sua aprovação.`}
      </p>
      <div className="space-y-3">
        {pending.map(post => <PostCard key={post.id} post={post} token={token} approvals={approvals} />)}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Circle, ExternalLink, FolderOpen, FileText, ThumbsUp, MessageSquare, Send, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { PortalPropertyTable } from './PortalPropertyTable';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface PortalEtapa {
  id: number;
  ordem: number;
  nome: string;
  tipo?: 'padrao' | 'aprovacao_cliente';
  status: 'pendente' | 'ativo' | 'concluido';
  iniciado_em: string | null;
  concluido_em: string | null;
}

interface PortalApproval {
  id: number;
  workflow_etapa_id: number;
  action: 'aprovado' | 'correcao' | 'mensagem';
  comentario: string | null;
  created_at: string;
  is_workspace_user?: boolean;
}

interface PortalPost {
  id: number;
  titulo: string;
  tipo: 'feed' | 'reels' | 'stories' | 'carrossel';
  status: 'enviado_cliente' | 'aprovado_cliente' | 'correcao_cliente';
  ordem: number;
  conteudo_plain: string;
}

interface PostApproval {
  id: number;
  post_id: number;
  action: 'aprovado' | 'correcao' | 'mensagem';
  comentario: string | null;
  is_workspace_user: boolean;
  created_at: string;
}

interface PortalData {
  workflow: {
    titulo: string;
    status: 'ativo' | 'concluido' | 'arquivado';
    etapa_atual: number;
    link_notion: string | null;
    link_drive: string | null;
    created_at: string;
  };
  etapas: PortalEtapa[];
  approvals: PortalApproval[];
  posts: PortalPost[];
  postApprovals: PostApproval[];
  propertyDefinitions?: Array<{
    id: number;
    name: string;
    type: string;
    config: Record<string, unknown>;
    display_order: number;
  }>;
  propertyValues?: Array<{
    property_definition_id: number;
    post_id: number;
    value: unknown;
  }>;
  selectOptions?: Array<{
    option_id: string;
    property_definition_id: number;
    label: string;
    color: string;
  }>;
  cliente_nome: string;
  workspace: {
    name: string;
    logo_url: string | null;
  };
}

const STATUS_LABEL: Record<string, string> = {
  ativo: 'Em Andamento',
  concluido: 'Concluído',
  arquivado: 'Arquivado',
};

function formatPortalDate(d: string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function PortalSkeleton() {
  return (
    <div className="portal-page">
      <header className="portal-header">
        <div className="portal-header-inner">
          <div className="portal-skeleton-block" style={{ width: 120, height: 28 }} />
          <div className="portal-skeleton-block" style={{ width: 72, height: 22, borderRadius: 999 }} />
        </div>
      </header>
      <main className="portal-main">
        <section className="portal-hero card">
          <div className="portal-skeleton-block" style={{ width: 86, height: 20, borderRadius: 999 }} />
          <div className="portal-skeleton-block" style={{ width: '65%', height: 28, marginTop: 12 }} />
          <div className="portal-skeleton-block" style={{ width: '40%', height: 16, marginTop: 8, marginBottom: 0 }} />
          <div className="portal-skeleton-progress">
            <div className="portal-skeleton-block" style={{ width: 60, height: 13 }} />
            <div className="portal-skeleton-block" style={{ width: 75, height: 13 }} />
          </div>
          <div className="portal-skeleton-block" style={{ width: '100%', height: 8, borderRadius: 4 }} />
        </section>
        <div className="portal-skeleton-spinner">
          <Spinner size="sm" />
          <span>Carregando etapas e conteúdos…</span>
        </div>
      </main>
    </div>
  );
}

export default function PortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Etapa-level approval state
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [approvalResult, setApprovalResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Post accordion state
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const togglePost = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Per-post approval state
  const [postComentarios, setPostComentarios] = useState<Record<number, string>>({});
  const [postSubmitting, setPostSubmitting] = useState<number | null>(null);
  const [postResults, setPostResults] = useState<Record<number, { type: 'success' | 'error'; message: string }>>({});

  useEffect(() => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  const fetchData = async () => {
    if (!token) { setError('Link inválido.'); setLoading(false); return; }
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/portal-data?token=${encodeURIComponent(token)}`,
        { headers: { apikey: SUPABASE_ANON_KEY } },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao carregar dados.');
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar dados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [token]);

  const handleApprovalAction = async (action: 'aprovado' | 'correcao') => {
    if (!token || !data) return;

    const approvalEtapa = data.etapas.find(
      e => e.tipo === 'aprovacao_cliente' && e.status === 'ativo'
    );
    if (!approvalEtapa) return;

    if (action === 'correcao' && !comentario.trim()) return;

    setSubmitting(true);
    setApprovalResult(null);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/portal-approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          token,
          etapa_id: approvalEtapa.id,
          action,
          comentario: comentario.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao enviar.');

      if (action === 'aprovado') {
        setApprovalResult({ type: 'success', message: 'Aprovado com sucesso!' });
        // Update etapas in-place from response
        if (json.etapas) {
          setData(prev => prev ? { ...prev, etapas: json.etapas } : prev);
        } else {
          await fetchData();
        }
      } else {
        setApprovalResult({ type: 'success', message: 'Correções enviadas com sucesso!' });
        setComentario('');
      }
    } catch (err: any) {
      setApprovalResult({ type: 'error', message: err.message || 'Erro ao enviar.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostApprovalAction = async (postId: number, action: 'aprovado' | 'correcao') => {
    if (!token || !data) return;
    const comentarioTrimmed = (postComentarios[postId] || '').trim();
    if (action === 'correcao' && !comentarioTrimmed) return;

    setPostSubmitting(postId);
    setPostResults(prev => ({ ...prev, [postId]: undefined as any }));

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/portal-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ token, post_id: postId, action, comentario: comentarioTrimmed || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao enviar.');

      const msg = action === 'aprovado' ? 'Post aprovado!' : 'Correções enviadas!';
      setPostResults(prev => ({ ...prev, [postId]: { type: 'success', message: msg } }));
      if (action === 'aprovado') {
        setPostComentarios(prev => ({ ...prev, [postId]: '' }));
      }
      if (json.posts) {
        setData(prev => prev ? { ...prev, posts: json.posts } : prev);
      } else {
        await fetchData();
      }
    } catch (err: any) {
      setPostResults(prev => ({ ...prev, [postId]: { type: 'error', message: err.message || 'Erro.' } }));
    } finally {
      setPostSubmitting(null);
    }
  };

  if (loading) {
    return <PortalSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="portal-error">
        <div className="portal-error-card">
          <h2>Ops!</h2>
          <p>{error || 'Link inválido ou expirado.'}</p>
        </div>
      </div>
    );
  }

  const { workflow, etapas, cliente_nome, workspace } = data;
  const completedCount = etapas.filter(e => e.status === 'concluido').length;
  const progressPct = etapas.length > 0 ? Math.round((completedCount / etapas.length) * 100) : 0;

  const approvalEtapa = etapas.find(
    e => e.tipo === 'aprovacao_cliente' && e.status === 'ativo'
  );

  return (
    <div className="portal-page">
      {/* Header */}
      <header className="portal-header">
        <div className="portal-header-inner">
          <div className="portal-header-logo">
            {workspace.logo_url ? (
              <img
                src={workspace.logo_url}
                alt={workspace.name}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).parentElement!.querySelector('.portal-header-name')!.removeAttribute('hidden');
                }}
              />
            ) : null}
            <span className="portal-header-name" hidden={!!workspace.logo_url}>{workspace.name}</span>
          </div>
          <div className="portal-header-badge">
            <span>Área Segura</span>
            <small>Portal do Cliente</small>
          </div>
        </div>
      </header>

      <main className="portal-main">
        {/* Hero */}
        <section className="portal-hero card">
          <Badge
            variant={workflow.status === 'concluido' ? 'default' : 'secondary'}
            className="portal-hero-badge"
          >
            {STATUS_LABEL[workflow.status] || workflow.status}
          </Badge>
          <h1 className="portal-hero-title">{workflow.titulo}</h1>
          <p className="portal-hero-subtitle">{cliente_nome}</p>

          {/* Progress Bar */}
          <div className="portal-progress">
            <div className="portal-progress-labels">
              <span>Progresso</span>
              <span>{progressPct}% ({completedCount}/{etapas.length})</span>
            </div>
            <div className="portal-progress-bar">
              <div className="portal-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </section>

        {/* Timeline */}
        <section className="portal-section card">
          <h2 className="portal-section-title">
            <Circle className="h-5 w-5" /> Etapas do Projeto
          </h2>
          <p className="portal-section-subtitle">Acompanhe o andamento das etapas</p>

          <div className="portal-timeline">
            {etapas.map((etapa, i) => {
              const isDone = etapa.status === 'concluido';
              const isActive = etapa.status === 'ativo';
              const isPending = etapa.status === 'pendente';

              const etapaApprovals = data.approvals
                ? data.approvals.filter(a => a.workflow_etapa_id === etapa.id && a.comentario)
                : [];

              return (
                <div
                  key={etapa.id}
                  className={`portal-timeline-item ${isDone ? 'done' : ''} ${isActive ? 'active' : ''} ${isPending ? 'pending' : ''}`}
                >
                  <div className="portal-timeline-rail">
                    <div className="portal-timeline-dot">
                      {isDone ? <Check className="h-3.5 w-3.5" /> : <span className="portal-timeline-dot-inner" />}
                    </div>
                    {i < etapas.length - 1 && <div className="portal-timeline-line" />}
                  </div>
                  <div className="portal-timeline-content">
                    <div className="portal-timeline-header">
                      <span className="portal-timeline-name">{etapa.nome}</span>
                      {isDone && etapa.concluido_em && (
                        <span className="portal-timeline-date">
                          Concluído em {formatPortalDate(etapa.concluido_em)}
                        </span>
                      )}
                      {isActive && etapa.iniciado_em && (
                        <span className="portal-timeline-date portal-timeline-date--active">
                          Iniciado em {formatPortalDate(etapa.iniciado_em)}
                        </span>
                      )}
                    </div>
                    {etapaApprovals.length > 0 && (
                      <div className="portal-timeline-comments" style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {etapaApprovals.slice().reverse().map(a => {
                          const isTeam = a.is_workspace_user;
                          return (
                            <div key={a.id} style={{
                              background: isTeam ? 'var(--primary-color)' : 'var(--card-bg)',
                              border: `1px solid ${isTeam ? 'var(--primary-color)' : 'var(--border-color)'}`,
                              padding: '0.75rem',
                              borderRadius: '8px',
                              marginLeft: isTeam ? '2rem' : '0',
                              marginRight: isTeam ? '0' : '2rem',
                            }}>
                              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: isTeam ? '#111' : (a.action === 'correcao' ? '#ef4444' : 'var(--primary-color)'), marginBottom: '0.25rem', opacity: isTeam ? 0.9 : 1 }}>
                                {isTeam ? 'Resposta da Equipe' : (a.action === 'correcao' ? 'Correção solicitada' : 'Observação')} &bull; {new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </div>
                              <p style={{ fontSize: '0.9rem', color: isTeam ? '#111' : 'var(--text-color)', margin: 0, whiteSpace: 'pre-wrap' }}>{a.comentario}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Posts for client review */}
        {data.posts && data.posts.length > 0 && (
          <section className="portal-section card">
            <h2 className="portal-section-title">
              <FileText className="h-5 w-5" /> Conteúdos para Aprovação
            </h2>
            <p className="portal-section-subtitle">
              Revise cada post e aprove ou solicite correções.
            </p>

            <div className="portal-posts-list">
              {data.posts.map(post => {
                const postThread = (data.postApprovals || []).filter(a => a.post_id === post.id);
                const isApproved = post.status === 'aprovado_cliente';
                const isCorrection = post.status === 'correcao_cliente';
                const result = postResults[post.id];

                return (
                  <div key={post.id} className={`portal-post-card${isApproved ? ' portal-post-card--approved' : isCorrection ? ' portal-post-card--correction' : ''}`}>
                    {/* Accordion header — always visible */}
                    <div className="portal-post-card-header" onClick={() => togglePost(post.id)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                      <span className={`portal-post-status-badge ${isApproved ? 'approved' : isCorrection ? 'correction' : 'pending'}`} style={{ marginBottom: '0.35rem' }}>
                        {isApproved ? '✅ Aprovado' : isCorrection ? '✏️ Correção' : '⏳ Aguardando'}
                      </span>
                      <div className="portal-post-card-meta">
                        {expandedIds.has(post.id)
                          ? <ChevronDown className="h-4 w-4" style={{ flexShrink: 0 }} />
                          : <ChevronRight className="h-4 w-4" style={{ flexShrink: 0 }} />
                        }
                        <span className="portal-post-tipo">{post.tipo.charAt(0).toUpperCase() + post.tipo.slice(1)}</span>
                        <span className="portal-post-titulo">{post.titulo}</span>
                      </div>
                    </div>

                    {/* Accordion body — visible only when expanded */}
                    {expandedIds.has(post.id) && (
                      <>
                        {/* Custom properties (portal-visible only) */}
                        {(data.propertyDefinitions ?? []).length > 0 && (
                          <PortalPropertyTable
                            definitions={data.propertyDefinitions ?? []}
                            values={(data.propertyValues ?? []).filter((v: any) => v.post_id === post.id)}
                            selectOptions={data.selectOptions ?? []}
                          />
                        )}

                        {post.conteudo_plain && (
                          <p className="portal-post-content">{post.conteudo_plain}</p>
                        )}

                        {postThread.length > 0 && (
                          <div className="portal-post-thread">
                            {postThread.map(a => {
                              const isTeam = a.is_workspace_user;
                              return (
                                <div key={a.id} style={{
                                  background: isTeam ? 'var(--primary-color)' : 'var(--card-bg)',
                                  border: `1px solid ${isTeam ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                  padding: '0.65rem 0.75rem',
                                  borderRadius: '8px',
                                  marginLeft: isTeam ? '2rem' : '0',
                                  marginRight: isTeam ? '0' : '2rem',
                                }}>
                                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: isTeam ? '#111' : (a.action === 'correcao' ? '#ef4444' : 'var(--primary-color)'), marginBottom: '0.2rem' }}>
                                    {isTeam ? 'Equipe' : a.action === 'correcao' ? 'Correção solicitada' : 'Aprovado'} &bull; {new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                  {a.comentario && <p style={{ fontSize: '0.875rem', color: isTeam ? '#111' : 'var(--text-color)', margin: 0, whiteSpace: 'pre-wrap' }}>{a.comentario}</p>}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {result && (
                          <div className={`portal-approval-result ${result.type}`} style={{ marginTop: '0.5rem' }}>
                            {result.message}
                          </div>
                        )}

                        {!isApproved && (
                          <div className="portal-post-actions">
                            <div className="portal-approval-comment" style={{ marginBottom: '0.5rem' }}>
                              <textarea
                                value={postComentarios[post.id] || ''}
                                onChange={e => setPostComentarios(prev => ({ ...prev, [post.id]: e.target.value }))}
                                placeholder="Comentários ou correções (opcional para aprovação)…"
                                rows={2}
                                disabled={postSubmitting === post.id}
                              />
                            </div>
                            <div className="portal-approval-actions">
                              <button
                                className="portal-approval-btn portal-approval-btn--approve"
                                onClick={() => handlePostApprovalAction(post.id, 'aprovado')}
                                disabled={postSubmitting === post.id}
                              >
                                {postSubmitting === post.id ? <Spinner size="sm" /> : <ThumbsUp className="h-4 w-4" />}
                                Aprovar
                              </button>
                              <button
                                className="portal-approval-btn portal-approval-btn--correction"
                                onClick={() => handlePostApprovalAction(post.id, 'correcao')}
                                disabled={postSubmitting === post.id || !(postComentarios[post.id] || '').trim()}
                              >
                                {postSubmitting === post.id ? <Spinner size="sm" /> : <Send className="h-4 w-4" />}
                                Enviar Correções
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Links */}
        {(workflow.link_drive || workflow.link_notion) && (
          <section className="portal-section card">
            <h2 className="portal-section-title">
              <ExternalLink className="h-5 w-5" /> Links do Projeto
            </h2>
            <div className="portal-links">
              {workflow.link_drive && (
                <a
                  href={workflow.link_drive}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="portal-link-btn"
                >
                  <FolderOpen className="h-5 w-5" />
                  <span>Abrir Google Drive</span>
                </a>
              )}
              {workflow.link_notion && (
                <a
                  href={workflow.link_notion}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="portal-link-btn"
                >
                  <FileText className="h-5 w-5" />
                  <span>Abrir Notion</span>
                </a>
              )}
            </div>
          </section>
        )}

        {/* Client Approval Section */}
        {approvalEtapa && (
          <section className="portal-section portal-approval card">
            <h2 className="portal-section-title">
              <ThumbsUp className="h-5 w-5" /> Sua Aprovação
            </h2>
            <p className="portal-section-subtitle">
              Esta etapa aguarda sua aprovação. Revise o trabalho e aprove ou envie correções.
            </p>

            {approvalResult && (
              <div className={`portal-approval-result ${approvalResult.type}`}>
                {approvalResult.message}
              </div>
            )}

            <div className="portal-approval-comment">
              <label htmlFor="portal-comment">
                <MessageSquare className="h-4 w-4" />
                Comentários ou correções (opcional para aprovação)
              </label>
              <textarea
                id="portal-comment"
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder="Descreva aqui as correções necessárias ou deixe um comentário..."
                rows={4}
                disabled={submitting}
              />
            </div>

            <div className="portal-approval-actions">
              <button
                className="portal-approval-btn portal-approval-btn--approve"
                onClick={() => handleApprovalAction('aprovado')}
                disabled={submitting}
              >
                {submitting ? <Spinner size="sm" /> : <ThumbsUp className="h-4 w-4" />}
                Aprovar
              </button>
              <button
                className="portal-approval-btn portal-approval-btn--correction"
                onClick={() => handleApprovalAction('correcao')}
                disabled={submitting || !comentario.trim()}
              >
                {submitting ? <Spinner size="sm" /> : <Send className="h-4 w-4" />}
                Enviar Correções
              </button>
            </div>
          </section>
        )}

        {/* Last updated */}
        <div className="portal-updated">
          Criado em {formatPortalDate(workflow.created_at)}
        </div>
      </main>

      {/* Footer */}
      <footer className="portal-footer">
        <span>fornecido por</span>
        <img src="/logo-gray.svg" alt="Mesaas" className="portal-footer-logo" />
      </footer>
    </div>
  );
}

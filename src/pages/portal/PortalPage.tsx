import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Circle, ExternalLink, FolderOpen, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface PortalEtapa {
  id: number;
  ordem: number;
  nome: string;
  status: 'pendente' | 'ativo' | 'concluido';
  iniciado_em: string | null;
  concluido_em: string | null;
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

export default function PortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (!token) { setError('Link inválido.'); setLoading(false); return; }
    const fetchData = async () => {
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
    fetchData();
  }, [token]);

  if (loading) {
    return (
      <div className="portal-loading">
        <Spinner size="lg" />
        <p>Carregando...</p>
      </div>
    );
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

  return (
    <div className="portal-page">
      {/* Header */}
      <header className="portal-header">
        <div className="portal-header-inner">
          <div className="portal-header-logo">
            {workspace.logo_url ? (
              <img src={workspace.logo_url} alt={workspace.name} />
            ) : (
              <span className="portal-header-name">{workspace.name}</span>
            )}
          </div>
          <div className="portal-header-badge">
            <span>Área do Cliente</span>
            <small>Acesso via Link Seguro</small>
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
                  </div>
                </div>
              );
            })}
          </div>
        </section>

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

        {/* Last updated */}
        <div className="portal-updated">
          Criado em {formatPortalDate(workflow.created_at)}
        </div>
      </main>

      {/* Footer */}
      <footer className="portal-footer">
        <span>fornecido por</span>
        <img src="/logo-white.svg" alt="Mesaas" className="portal-footer-logo" />
      </footer>
    </div>
  );
}

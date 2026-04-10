import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { getIntegrationsMeta, getIntegracoesStatus, toggleIntegracao, getClientes, type Cliente } from '../../store';
import { sanitizeUrl } from '../../utils/security';

interface IntMeta { integracao_id: string; icon: string; label: string; desc: string; }

export default function IntegracoesPage() {
  const [meta, setMeta] = useState<IntMeta[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [m, statuses, c] = await Promise.all([
      getIntegrationsMeta(),
      getIntegracoesStatus(),
      getClientes(),
    ]);
    const map: Record<string, string> = {};
    statuses.forEach((s: any) => { map[s.integracao_id] = s.status; });
    setMeta(m);
    setStatusMap(map);
    setClientes(c);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleToggle = async (intId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'conectado' ? 'desconectado' : 'conectado';
    setToggling(intId);
    try {
      await toggleIntegracao(intId, newStatus as 'conectado' | 'desconectado');
      if (newStatus === 'conectado') toast.success('Integração conectada!');
      else toast.info('Integração desconectada.');
      await load();
    } catch (err: unknown) {
      toast.error('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'));
    } finally {
      setToggling(null);
    }
  };

  const notionConnected = statusMap['notion'] === 'conectado';
  const notionClientes = clientes.filter(c => c.notion_page_url);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}>
      <Spinner size="lg" />
    </div>
  );

  return (
    <div>
      <header className="header animate-up">
        <div className="header-title">
          <h1>Integrações</h1>
          <p>Conecte ferramentas externas ao CRM.</p>
        </div>
      </header>

      <div className="integrations-grid animate-up">
        {meta.map(int => {
          const status = statusMap[int.integracao_id] || 'desconectado';
          const connected = status === 'conectado';
          return (
            <div key={int.integracao_id} className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 180 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem', marginBottom: '1.5rem' }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: connected ? 'rgba(22,163,74,0.2)' : 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', color: connected ? '#22c55e' : 'var(--text-muted)' }}>
                  <i className={int.icon} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', marginBottom: '0.25rem' }}>{int.label}</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.4, margin: 0 }}>{int.desc}</p>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                <Badge variant={connected ? 'default' : 'secondary'}>
                  {connected ? 'Conectado' : 'Desconectado'}
                </Badge>
                <Button
                  variant={connected ? 'destructive' : 'default'}
                  onClick={() => handleToggle(int.integracao_id, status)}
                  disabled={toggling === int.integracao_id}
                  size="sm"
                >
                  {toggling === int.integracao_id && <Spinner size="sm" />}
                  {connected ? 'Desconectar' : 'Conectar'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {notionConnected && (
        <div className="card animate-up" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
              <i className="ph ph-book" />
            </div>
            <div>
              <h3 style={{ margin: 0 }}>Acesso Rápido - Notion</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>Páginas de clientes vinculadas ao Notion.</p>
            </div>
          </div>

          {notionClientes.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--surface-main)', borderRadius: 12, border: '1px dashed var(--border-color)' }}>
              <i className="ph ph-info" style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--text-light)', display: 'block' }} />
              <p>Nenhum cliente possui uma página do Notion vinculada.</p>
            </div>
          ) : (
            notionClientes.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-main)', padding: '1rem 1.25rem', borderRadius: 12, marginBottom: '0.5rem', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div className="avatar" style={{ background: c.cor, width: 32, height: 32, fontSize: '0.8rem' }}>{c.sigla}</div>
                  <div>
                    <strong style={{ display: 'block', color: 'var(--text-main)', fontSize: '0.95rem' }}>{c.nome}</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.plano || 'Sem plano definido'}</span>
                  </div>
                </div>
                <a
                  href={sanitizeUrl(c.notion_page_url || '')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                  style={{ textDecoration: 'none', padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                >
                  Abrir Página <i className="ph ph-arrow-square-out" style={{ fontSize: '0.75rem' }} />
                </a>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

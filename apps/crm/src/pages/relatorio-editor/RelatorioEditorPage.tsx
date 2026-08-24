// PR 1: visualização read-only do documento de blocos. O PR 2 adiciona a
// edição (drag, resize, drawer, autosave) em cima desta página.
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@/components/ui/spinner';
import { BlockRenderer } from '@mesaas/report-blocks/BlockRenderer';
import '@mesaas/report-blocks/styles.css';
import { getReportDoc } from '../../services/reportDocs';

export default function RelatorioEditorPage() {
  const { id } = useParams<{ id: string }>();

  const { data: doc, isLoading } = useQuery({
    queryKey: ['report-doc', id],
    queryFn: () => getReportDoc(id!),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
        <Spinner />
      </div>
    );
  }

  if (!doc || !doc.data_snapshot) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Relatório não encontrado.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      <header style={{ maxWidth: 880, margin: '0 auto 1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.35rem' }}>{doc.title}</h1>
        <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {doc.data_snapshot.period.label}
        </p>
      </header>
      <BlockRenderer layout={doc.layout} snapshot={doc.data_snapshot} mode="view" />
    </div>
  );
}

// Viewer read-only do relatório de blocos (spec §9): mesmo BlockRenderer do
// print/editor, accent do layout/snapshot congelado, sob o token do portal.
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { BlockRenderer } from '@mesaas/report-blocks/BlockRenderer';
import type { ReportDocSnapshot, ReportLayout } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';
import { useHub } from '../HubContext';
import { fetchReportDoc } from '../api';

export function RelatorioDocPage() {
  const { token } = useHub();
  const { workspace, docId } = useParams<{ workspace: string; token: string; docId: string }>();
  const navigate = useNavigate();
  const base = `/${workspace}/hub/${token}`;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-report-doc', token, docId],
    queryFn: () => fetchReportDoc(token, docId ?? ''),
    enabled: !!docId,
  });

  const doc = data?.doc;
  return (
    <div className="hub-fade-up">
      <div className="max-w-5xl mx-auto w-full mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(`${base}/relatorios`)}
          className="hub-back-link flex items-center gap-1.5 text-[13px] font-medium hub-tx3 transition-colors"
        >
          <ArrowLeft size={15} strokeWidth={2} />
          Relatórios
        </button>
        {doc && <span className="text-[13px] font-medium hub-txt">{doc.title}</span>}
      </div>
      {isLoading && (
        <div className="flex justify-center py-20">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      )}
      {isError && (
        <div className="max-w-5xl mx-auto py-20 text-center text-sm hub-tx2">
          Erro ao carregar o relatório.
        </div>
      )}
      {doc && doc.data_snapshot != null && (
        <div className="max-w-5xl mx-auto">
          <BlockRenderer
            layout={doc.layout as ReportLayout}
            snapshot={doc.data_snapshot as ReportDocSnapshot}
            mode="view"
          />
        </div>
      )}
    </div>
  );
}

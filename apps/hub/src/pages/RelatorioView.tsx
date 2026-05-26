import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchReportHtml, fetchReportPdfUrl } from '../api';

function formatMonth(month: string): string {
  const [year, mm] = month.split('-');
  const date = new Date(parseInt(year, 10), parseInt(mm, 10) - 1, 1);
  const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function RelatorioViewPage() {
  const { token } = useHub();
  const { workspace, month } = useParams<{ workspace: string; token: string; month: string }>();
  const navigate = useNavigate();
  const base = `/${workspace}/hub/${token}`;

  const { data: html, isLoading, isError } = useQuery({
    queryKey: ['hub-report-html', token, month],
    queryFn: () => fetchReportHtml(token, month ?? ''),
    enabled: !!month,
  });

  async function handleDownloadPdf() {
    if (!month) return;
    try {
      const { url } = await fetchReportPdfUrl(token, month);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-${month}.pdf`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      // Silently fail — user can retry
    }
  }

  return (
    <div className="hub-fade-up flex flex-col" style={{ minHeight: 'calc(100vh - 80px)' }}>
      {/* Toolbar */}
      <div className="max-w-5xl mx-auto w-full mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(`${base}/relatorios`)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-stone-500 hover:text-stone-900 transition-colors"
        >
          <ArrowLeft size={15} strokeWidth={2} />
          Relatórios
        </button>

        {month && (
          <span className="text-stone-300 select-none">/</span>
        )}

        {month && (
          <span className="text-[13px] font-medium text-stone-900">
            {formatMonth(month)}
          </span>
        )}

        <button
          type="button"
          onClick={handleDownloadPdf}
          className="ml-auto flex items-center gap-1.5 text-[12px] font-medium text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 transition-colors px-3 py-1.5 rounded-lg"
        >
          <Download size={13} strokeWidth={2} />
          Baixar PDF
        </button>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      )}

      {isError && (
        <div className="max-w-5xl mx-auto py-20 text-center text-sm text-stone-500">
          Erro ao carregar o relatório.
        </div>
      )}

      {html && !isLoading && (
        <iframe
          srcDoc={html}
          sandbox="allow-same-origin"
          style={{ width: '100%', flex: 1, minHeight: '80vh', border: 'none', borderRadius: '12px' }}
          title={month ? `Relatório ${formatMonth(month)}` : 'Relatório'}
        />
      )}
    </div>
  );
}

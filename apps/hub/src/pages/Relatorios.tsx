import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { FileText, Download, ExternalLink } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchReports, fetchReportPdfUrl, type HubReport } from '../api';

function formatMonth(month: string): string {
  // month is in format "YYYY-MM"
  const [year, mm] = month.split('-');
  const date = new Date(parseInt(year, 10), parseInt(mm, 10) - 1, 1);
  const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  // Capitalize first letter
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ReportCard({ report, base }: { report: HubReport; base: string }) {
  const navigate = useNavigate();
  const { token } = useHub();

  async function handleDownloadPdf(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const { url } = await fetchReportPdfUrl(token, report.month);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-${report.month}.pdf`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      // Silently fail — user can retry
    }
  }

  const isReady = report.status === 'ready';

  return (
    <div className="hub-card flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-stone-100 text-stone-500 flex-shrink-0">
          <FileText size={18} strokeWidth={1.75} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-stone-900 text-[15px] leading-tight">
            {formatMonth(report.month)}
          </p>
          {report.generated_at && (
            <p className="text-[11px] text-stone-400 mt-0.5">
              Gerado em{' '}
              {new Date(report.generated_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </p>
          )}
        </div>
        {isReady && (
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100 flex-shrink-0">
            Pronto
          </span>
        )}
      </div>

      {isReady && (
        <div className="flex gap-2 pt-1">
          {report.has_html && (
            <button
              type="button"
              onClick={() => navigate(`${base}/relatorios/${report.month}`)}
              className="flex items-center gap-1.5 text-[12px] font-medium text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 transition-colors px-3 py-1.5 rounded-lg"
            >
              <ExternalLink size={13} strokeWidth={2} />
              Ver online
            </button>
          )}
          {report.has_pdf && (
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="flex items-center gap-1.5 text-[12px] font-medium text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 transition-colors px-3 py-1.5 rounded-lg"
            >
              <Download size={13} strokeWidth={2} />
              Baixar PDF
            </button>
          )}
        </div>
      )}

      {!isReady && (
        <p className="text-[12px] text-stone-400">Em preparação...</p>
      )}
    </div>
  );
}

export function RelatoriosPage() {
  const { token } = useHub();
  const { workspace } = useParams<{ workspace: string; token: string }>();
  const base = `/${workspace}/hub/${token}`;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-reports', token],
    queryFn: () => fetchReports(token),
  });

  const reports = data?.reports ?? [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-5xl mx-auto py-20 text-center text-sm text-stone-500">
        Erro ao carregar relatórios.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto hub-fade-up">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">
          <span className="accent-bar" />Resultados mensais
        </p>
        <h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight text-stone-900">
          Relatórios
        </h2>
      </header>

      {reports.length === 0 ? (
        <p className="text-sm text-stone-500">Nenhum relatório disponível ainda.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map(report => (
            <ReportCard key={report.month} report={report} base={base} />
          ))}
        </div>
      )}
    </div>
  );
}

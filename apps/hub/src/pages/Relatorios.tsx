import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { useNavigate, useParams } from 'react-router-dom';
import { FileText, Download, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHub } from '../HubContext';
import { fetchReportList, fetchReportPdfUrl, type HubReportListItem } from '../api';

function formatMonth(month: string, lang: string = 'pt-BR'): string {
  // month is in format "YYYY-MM"
  const [year, mm] = month.split('-');
  const date = new Date(parseInt(year, 10), parseInt(mm, 10) - 1, 1);
  const label = date.toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  // Capitalize first letter
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type LegacyReport = Extract<HubReportListItem, { kind: 'legacy' }>;
type DocReport = Extract<HubReportListItem, { kind: 'doc' }>;

function DocCard({ doc, base }: { doc: DocReport; base: string }) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('hubReports');
  const dateLocale = i18n.language === 'en' ? 'en-US' : 'pt-BR';

  return (
    <div className="hub-card flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center w-10 h-10 rounded-xl hub-bg-soft hub-tx2 flex-shrink-0">
          <FileText size={18} strokeWidth={1.75} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium hub-txt text-[15px] leading-tight">{doc.title}</p>
          <p className="text-[11px] hub-tx3 mt-0.5">{formatMonth(doc.month, dateLocale)}</p>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => navigate(`${base}/relatorios/doc/${doc.id}`)}
          className="flex items-center gap-1.5 text-[12px] font-medium hub-tx2 hub-action-pill transition-colors px-3 py-1.5 rounded-lg"
        >
          <ExternalLink size={13} strokeWidth={2} />
          {t('actions.open', 'Abrir')}
        </button>
      </div>
    </div>
  );
}

function ReportCard({ report, base }: { report: LegacyReport; base: string }) {
  const navigate = useNavigate();
  const { token } = useHub();
  const { t, i18n } = useTranslation('hubReports');
  const dateLocale = i18n.language === 'en' ? 'en-US' : 'pt-BR';

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
        <span className="flex items-center justify-center w-10 h-10 rounded-xl hub-bg-soft hub-tx2 flex-shrink-0">
          <FileText size={18} strokeWidth={1.75} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium hub-txt text-[15px] leading-tight">
            {formatMonth(report.month, dateLocale)}
          </p>
          {report.generated_at && (
            <p className="text-[11px] hub-tx3 mt-0.5">
              {t('generatedAt', 'Gerado em')}{' '}
              {new Date(report.generated_at).toLocaleDateString(dateLocale, {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </p>
          )}
        </div>
        {isReady && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100 flex-shrink-0">
            {t('status.ready', 'Pronto')}
          </span>
        )}
      </div>

      {isReady && (
        <div className="flex gap-2 pt-1">
          {report.has_html && (
            <button
              type="button"
              onClick={() => navigate(`${base}/relatorios/${report.month}`)}
              className="flex items-center gap-1.5 text-[12px] font-medium hub-tx2 hub-action-pill transition-colors px-3 py-1.5 rounded-lg"
            >
              <ExternalLink size={13} strokeWidth={2} />
              {t('actions.viewOnline', 'Ver online')}
            </button>
          )}
          {report.has_pdf && (
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="flex items-center gap-1.5 text-[12px] font-medium hub-tx2 hub-action-pill transition-colors px-3 py-1.5 rounded-lg"
            >
              <Download size={13} strokeWidth={2} />
              {t('actions.downloadPdf', 'Baixar PDF')}
            </button>
          )}
        </div>
      )}

      {!isReady && (
        <p className="text-[12px] hub-tx3">{t('status.preparing', 'Em preparação...')}</p>
      )}
    </div>
  );
}

export function RelatoriosPage() {
  const { token } = useHub();
  const { workspace } = useParams<{ workspace: string; token: string }>();
  const base = `/${workspace}/hub/${token}`;
  const { t } = useTranslation('hubReports');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-report-list', token],
    queryFn: () => fetchReportList(token),
  });

  const items = data?.items ?? [];

  return (
    <div className="max-w-5xl mx-auto hub-fade-up">
      <PageHeader
        title={t('title', 'Relatórios')}
        description={t('description', 'Resultados e análises de desempenho.')}
      />

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : isError ? (
        <div className="py-20 text-center text-sm hub-tx2">
          {t('errors.loadList', 'Erro ao carregar relatórios.')}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm hub-tx2">
          {t('empty.noReports', 'Nenhum relatório disponível ainda.')}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) =>
            item.kind === 'doc' ? (
              <DocCard key={`doc-${item.id}`} doc={item} base={base} />
            ) : (
              <ReportCard key={`legacy-${item.month}`} report={item} base={base} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

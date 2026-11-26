import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import i18n from 'i18next';
import { Trans, useTranslation } from 'react-i18next';
import { getIntlLocale } from '@mesaas/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { getClientes } from '../../../store';
import { getInstagramSummary } from '../../../services/instagram';
import { getTikTokSummary } from '../../../services/tiktok';
import { getGoogleSummary } from '../../../services/google';
import {
  getClientReports,
  getReportDownloadUrl,
  sendReportEmail,
  type AnalyticsReport,
} from '../../../services/analytics';
import {
  deleteReportDoc,
  listReportDocs,
  type ReportDocListItem,
  type ReportPlatform,
} from '../../../services/reportDocs';
import { PLATFORM_NAMES } from '@mesaas/report-blocks/platform';
import { openExternalUrl } from '../../../utils/security';
import { openPdf, opensPdfInApp, pdfFilename } from '../../../utils/openPdf';
import { formatReportMonth } from '../contaFormat';
import { NewReportDialog } from './NewReportDialog';

// Mesmo corte do servidor (report-docs/tiktok-section.ts): revogada ou desconectada não entra.
const TIKTOK_NOT_CONNECTED = ['revoked', 'disconnected'];

function PlatformBadges({ platforms }: { platforms: ReportPlatform[] }) {
  return (
    <>
      {platforms.map((p) => (
        <Badge key={p} variant="neutral" size="sm">
          {PLATFORM_NAMES[p]}
        </Badge>
      ))}
    </>
  );
}

function reportStatusText(r: AnalyticsReport): { text: string; tone?: string } {
  switch (r.status) {
    case 'pending':
      return { text: i18n.t('analyticsAccount:reports.pending'), tone: 'phone-an-tone--warn' };
    case 'generating':
      return { text: i18n.t('analyticsAccount:reports.generating'), tone: 'phone-an-tone--muted' };
    case 'failed':
      return {
        text: i18n.t('analyticsAccount:reports.failed', {
          error: r.generation_error || i18n.t('analyticsAccount:reports.unknownError'),
        }),
        tone: 'phone-an-tone--down',
      };
    case 'skipped':
      return {
        text: i18n.t('analyticsAccount:reports.outOfPlanLong'),
        tone: 'phone-an-tone--muted',
      };
    default:
      return { text: i18n.t('analyticsAccount:reports.ready'), tone: 'phone-an-tone--up' };
  }
}

/**
 * The client analytics page's Relatórios tab (`/analytics/:id/relatorios`): the block
 * reports, then the legacy "Formato anterior" PDFs (download, e-mail, pending polling), and
 * the "Gerar relatório" dialog. Moved as-is from the Instagram page's "Relatórios Gerados"
 * card and ContaPhone's report lists. Desktop renders a card; phones render grouped lists
 * inside the shell's phone frame.
 */
export function ClientReportsPanel({ clientId }: { clientId: number }) {
  const { t } = useTranslation('analyticsAccount');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isPhone = !useIsDesktop(768);

  const [emailReportTarget, setEmailReportTarget] = useState<AnalyticsReport | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [newReportOpen, setNewReportOpen] = useState(false);
  // Which report row is currently being downloaded, so only that row spins.
  const [downloadingReportId, setDownloadingReportId] = useState<number | null>(null);
  // Phone action sheets.
  const [docTarget, setDocTarget] = useState<ReportDocListItem | null>(null);
  const [docToDelete, setDocToDelete] = useState<ReportDocListItem | null>(null);
  const [reportTarget, setReportTarget] = useState<AnalyticsReport | null>(null);

  // The e-mail dialog names the client and warns when its report e-mails are off.
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const cliente = clientes.find((c) => c.id === clientId);

  const { data: reportsData = [] } = useQuery({
    queryKey: ['analytics-reports', clientId],
    queryFn: () => getClientReports(clientId),
    refetchInterval: (query) => {
      const reports = query.state.data;
      if (reports?.some((r) => r.status === 'pending' || r.status === 'generating')) return 10000;
      return false;
    },
  });
  const { data: reportDocs = [] } = useQuery({
    queryKey: ['report-docs', clientId],
    queryFn: () => listReportDocs(clientId),
  });

  // Redes conectadas, para o "Plataformas" do dialog. Mesmas chaves do shell (compartilham o
  // cache). Desconhecido (carregando, ou erro que não é "não conectado") = undefined: o dialog
  // não manda `platforms` e o servidor usa todas as conectadas.
  const { features } = useWorkspaceLimits();
  const tiktokEnabled = features?.feature_tiktok === true;
  const igQuery = useQuery({
    queryKey: ['ig-summary', clientId],
    queryFn: () => getInstagramSummary(clientId),
  });
  const ttQuery = useQuery({
    // Same key and queryFn as the shell and TikTokSection, so the cache is shared.
    queryKey: ['ttSummary', clientId],
    queryFn: () => getTikTokSummary(clientId).catch(() => null),
    enabled: tiktokEnabled,
    retry: false,
  });
  // Google Meu Negócio: mesma chave e queryFn do shell e da seção do cliente (cache
  // compartilhado). Conta como conectado com alguma unidade que não esteja desconectada; um
  // erro lê como "sem unidades" (o servidor decide de novo na geração).
  const googleEnabled = features?.feature_google_business === true;
  const googleQuery = useQuery({
    queryKey: ['googleSummary', clientId],
    queryFn: () => getGoogleSummary(clientId),
    enabled: googleEnabled,
    retry: false,
  });
  const googleConnected =
    googleEnabled &&
    (googleQuery.data?.gmn?.locations ?? []).some((l) => l.status !== 'disconnected');
  const igTokenExpired =
    igQuery.error instanceof Error && igQuery.error.message === 'TOKEN_EXPIRED';
  const igKnown = !igQuery.isLoading && (!igQuery.isError || igTokenExpired);
  const connected: ReportPlatform[] | undefined =
    igKnown && !(tiktokEnabled && ttQuery.isLoading) && !(googleEnabled && googleQuery.isLoading)
      ? [
          ...(igQuery.data || igTokenExpired ? (['instagram'] as const) : []),
          ...(tiktokEnabled &&
          ttQuery.data &&
          !TIKTOK_NOT_CONNECTED.includes(ttQuery.data.account?.authorization_status)
            ? (['tiktok'] as const)
            : []),
          ...(googleConnected ? (['google'] as const) : []),
        ]
      : undefined;

  const handleConfirmSendEmail = async () => {
    if (!emailReportTarget) return;
    setSendingEmail(true);
    try {
      const result = await sendReportEmail(emailReportTarget.id);
      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success(t('reports.emailSent'));
      }
      qc.invalidateQueries({ queryKey: ['analytics-reports', clientId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('reports.emailError'));
    } finally {
      setSendingEmail(false);
      setEmailReportTarget(null);
    }
  };

  // `viaTap`: iOS Safari blocks a window.open that runs after an await (the user gesture
  // is gone), so phones get a toast whose "Abrir PDF" tap opens the signed URL instead.
  // Not location.assign: inside the native shell that would leave no way back. The iOS
  // app skips the toast: its share sheet needs no fresh tap (see openPdf).
  const handleDownloadReport = async (report: AnalyticsReport, viaTap = false) => {
    // Signing the URL takes a moment; without feedback the row looks inert and
    // gets clicked again. Every download button locks so the spinner on the
    // active row is the only thing that looks clickable.
    if (downloadingReportId !== null) return;
    setDownloadingReportId(report.id);
    // The phone's action sheet closes on tap, so the toast is the in-flight feedback.
    const toastId = viaTap ? toast.loading(t('reports.preparingPdf')) : undefined;
    try {
      const url = await getReportDownloadUrl(report.id);
      if (opensPdfInApp()) {
        if (toastId !== undefined) toast.dismiss(toastId);
        const title = [
          t('reports.pdfTitle'),
          cliente?.nome,
          formatReportMonth(report.report_month),
        ];
        await openPdf(url, pdfFilename(title.filter(Boolean).join(' ')));
      } else if (viaTap) {
        toast.success(t('reports.pdfReady'), {
          id: toastId,
          action: { label: t('reports.openPdf'), onClick: () => openExternalUrl(url) },
          duration: 15000,
        });
      } else openExternalUrl(url);
    } catch {
      toast.error(t('reports.downloadError'), { id: toastId });
    } finally {
      setDownloadingReportId(null);
    }
  };

  const deleteDoc = async (docId: string) => {
    try {
      await deleteReportDoc(docId);
      qc.invalidateQueries({ queryKey: ['report-docs', clientId] });
      toast.success(t('reports.deleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('reports.deleteError'));
    }
  };

  const emailDialog = (
    <AlertDialog
      open={emailReportTarget !== null}
      onOpenChange={(open) => {
        if (!open) setEmailReportTarget(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('reports.emailTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {emailReportTarget && (
              <>
                <Trans
                  t={t}
                  i18nKey="reports.emailBody"
                  values={{
                    month: formatReportMonth(emailReportTarget.report_month),
                    client: cliente?.nome ?? '',
                  }}
                  components={{ strong: <strong /> }}
                />
                {cliente?.send_report_email === false && (
                  <span
                    style={{
                      display: 'block',
                      marginTop: '0.5rem',
                      color: 'var(--warning)',
                      fontWeight: 600,
                    }}
                  >
                    {t('reports.emailOff')}
                  </span>
                )}
                {emailReportTarget.last_emailed_at && (
                  <span
                    style={{
                      display: 'block',
                      marginTop: '0.25rem',
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {t('reports.lastSent', {
                      date: new Date(emailReportTarget.last_emailed_at).toLocaleString(
                        getIntlLocale(),
                      ),
                    })}
                  </span>
                )}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sendingEmail}>{t('reports.cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={sendingEmail} onClick={handleConfirmSendEmail}>
            {sendingEmail ? t('reports.sending') : t('reports.send')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const newReportDialog = (
    <NewReportDialog
      open={newReportOpen}
      onOpenChange={setNewReportOpen}
      clientId={clientId}
      connected={connected}
    />
  );

  if (isPhone) {
    const reportActions: ActionSheetAction[] = reportTarget
      ? [
          ...(reportTarget.storage_path
            ? [
                {
                  label:
                    downloadingReportId === reportTarget.id
                      ? t('reports.downloading')
                      : t('reports.downloadPdf'),
                  disabled: downloadingReportId !== null,
                  onSelect: () => handleDownloadReport(reportTarget, true),
                },
              ]
            : []),
          { label: t('reports.sendByEmail'), onSelect: () => setEmailReportTarget(reportTarget) },
        ]
      : [];

    return (
      <>
        <GroupedList
          header={t('reports.generatedHeader')}
          footer={
            reportDocs.length === 0 && reportsData.length === 0 ? t('reports.none') : undefined
          }
        >
          <Cell
            icon={<Plus />}
            label={t('reports.generate')}
            onClick={() => setNewReportOpen(true)}
          />
          {reportDocs.map((doc) => (
            <Cell
              key={doc.id}
              icon={<FileText />}
              label={doc.title}
              subtitle={
                <span className="phone-an-cell-sub phone-an-cell-sub--wrap">
                  {new Date(doc.created_at).toLocaleDateString(getIntlLocale())}
                  {doc.platforms.map((p) => ` · ${PLATFORM_NAMES[p]}`).join('')}
                </span>
              }
              chevron
              aria-haspopup="dialog"
              onClick={() => setDocTarget(doc)}
            />
          ))}
        </GroupedList>
        {reportsData.length > 0 && (
          <GroupedList header={t('reports.previousFormat')}>
            {reportsData.map((r) => {
              const status = reportStatusText(r);
              const ready = r.status === 'ready';
              return (
                <Cell
                  key={r.id}
                  label={`${formatReportMonth(r.report_month)}${r.include_ai ? t('reports.aiSuffix') : ''}`}
                  subtitle={
                    <span className="phone-an-cell-sub phone-an-cell-sub--wrap">
                      <span className={status.tone}>{status.text}</span>
                      {r.generated_at &&
                        ` · ${new Date(r.generated_at).toLocaleDateString(getIntlLocale())}`}
                    </span>
                  }
                  chevron={ready}
                  aria-haspopup={ready ? 'dialog' : undefined}
                  onClick={ready ? () => setReportTarget(r) : undefined}
                />
              );
            })}
          </GroupedList>
        )}

        <ActionSheet
          open={docTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDocTarget(null);
          }}
          title={docTarget?.title ?? t('reports.pdfTitle')}
          actions={
            docTarget
              ? [
                  {
                    label: t('reports.open'),
                    onSelect: () => navigate(`/relatorios/${docTarget.id}`),
                  },
                  {
                    label: t('reports.delete'),
                    destructive: true,
                    onSelect: () => setDocToDelete(docTarget),
                  },
                ]
              : []
          }
        />

        <PhoneConfirmSheet
          open={docToDelete !== null}
          title={t('reports.deleteTitle')}
          message={t('reports.deleteMessage')}
          actions={[
            {
              label: t('reports.delete'),
              destructive: true,
              onSelect: () => {
                if (docToDelete) deleteDoc(docToDelete.id);
                setDocToDelete(null);
              },
            },
          ]}
          onCancel={() => setDocToDelete(null)}
        />

        <ActionSheet
          open={reportTarget !== null}
          onOpenChange={(open) => {
            if (!open) setReportTarget(null);
          }}
          title={
            reportTarget
              ? t('reports.reportOf', { month: formatReportMonth(reportTarget.report_month) })
              : ''
          }
          actions={reportActions}
        />

        {emailDialog}
        {newReportDialog}
      </>
    );
  }

  return (
    <>
      <div className="card animate-up">
        <div
          className="dashboard-hub-card-header"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <h3>{t('reports.generatedTitle')}</h3>
          <Button variant="outline" size="sm" onClick={() => setNewReportOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> {t('reports.generateShort')}
          </Button>
        </div>
        <div style={{ marginTop: '1rem' }}>
          {reportDocs.length === 0 && reportsData.length === 0 && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {t('reports.noneDesktop')}
            </p>
          )}
          {reportDocs.map((doc) => (
            <div
              key={doc.id}
              data-testid="report-doc-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0',
                borderBottom: '1px solid var(--border-color,rgba(0,0,0,0.06))',
              }}
            >
              <div>
                <strong>{doc.title}</strong>
                <span
                  style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}
                >
                  {new Date(doc.created_at).toLocaleDateString(getIntlLocale())}
                </span>
                <span style={{ display: 'inline-flex', gap: '0.25rem', marginLeft: '0.5rem' }}>
                  <PlatformBadges platforms={doc.platforms} />
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/relatorios/${doc.id}`)}
                >
                  {t('reports.open')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('reports.deleteAria')}
                  onClick={async () => {
                    if (!window.confirm(t('reports.deleteConfirm'))) return;
                    await deleteDoc(doc.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {reportsData.length > 0 && (
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginTop: reportDocs.length > 0 ? '1.25rem' : 0,
                marginBottom: '0.25rem',
              }}
            >
              {t('reports.previousFormat')}
            </p>
          )}
          {reportsData.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0',
                borderBottom: '1px solid var(--border-color,rgba(0,0,0,0.06))',
              }}
            >
              <div>
                <strong>{formatReportMonth(r.report_month)}</strong>
                {r.generated_at && (
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginLeft: '0.5rem',
                    }}
                  >
                    {new Date(r.generated_at).toLocaleDateString(getIntlLocale())}
                  </span>
                )}
                {r.include_ai && (
                  <span className="badge badge-neutral badge--sm" style={{ marginLeft: '0.5rem' }}>
                    {t('reports.ai')}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {r.status === 'pending' && (
                  <span className="badge badge-warning">{t('reports.pending')}</span>
                )}
                {r.status === 'generating' && (
                  <span className="badge badge-info">
                    <Spinner size="sm" /> {t('reports.generatingAscii')}
                  </span>
                )}
                {r.status === 'failed' && (
                  <span
                    className="badge badge-danger"
                    title={r.generation_error || t('reports.unknownError')}
                    style={{ cursor: 'help' }}
                  >
                    {t('reports.failedBadge')}
                  </span>
                )}
                {r.status === 'skipped' && (
                  <span
                    className="badge badge-neutral"
                    title={t('reports.skippedTitle')}
                    style={{ cursor: 'help' }}
                  >
                    {t('reports.outOfPlan')}
                  </span>
                )}
                {r.status === 'ready' && (
                  <>
                    <span className="badge badge-success">{t('reports.ready')}</span>
                    {r.storage_path && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={downloadingReportId !== null}
                        onClick={() => handleDownloadReport(r)}
                      >
                        {downloadingReportId === r.id ? (
                          <>
                            <Spinner size="sm" /> {t('reports.downloading')}
                          </>
                        ) : (
                          t('reports.downloadPdfArrow')
                        )}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setEmailReportTarget(r)}>
                      {t('reports.send')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {emailDialog}
      {newReportDialog}
    </>
  );
}

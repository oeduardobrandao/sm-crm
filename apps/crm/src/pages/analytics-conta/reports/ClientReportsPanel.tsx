import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
      return { text: 'Pendente', tone: 'phone-an-tone--warn' };
    case 'generating':
      return { text: 'Gerando…', tone: 'phone-an-tone--muted' };
    case 'failed':
      return {
        text: `Falha: ${r.generation_error || 'Erro desconhecido'}`,
        tone: 'phone-an-tone--down',
      };
    case 'skipped':
      return {
        text: 'Fora do plano: o plano do workspace não incluía relatórios de analytics no momento da geração.',
        tone: 'phone-an-tone--muted',
      };
    default:
      return { text: 'Pronto', tone: 'phone-an-tone--up' };
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
    queryKey: ['tt-summary', clientId],
    queryFn: () => getTikTokSummary(clientId),
    enabled: tiktokEnabled,
    retry: false,
  });
  const igTokenExpired =
    igQuery.error instanceof Error && igQuery.error.message === 'TOKEN_EXPIRED';
  const igKnown = !igQuery.isLoading && (!igQuery.isError || igTokenExpired);
  const connected: ReportPlatform[] | undefined =
    igKnown && !(tiktokEnabled && ttQuery.isLoading)
      ? [
          ...(igQuery.data || igTokenExpired ? (['instagram'] as const) : []),
          ...(tiktokEnabled &&
          ttQuery.data &&
          !TIKTOK_NOT_CONNECTED.includes(ttQuery.data.account?.authorization_status)
            ? (['tiktok'] as const)
            : []),
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
        toast.success('E-mail enviado com sucesso!');
      }
      qc.invalidateQueries({ queryKey: ['analytics-reports', clientId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar e-mail');
    } finally {
      setSendingEmail(false);
      setEmailReportTarget(null);
    }
  };

  // `viaTap`: iOS Safari blocks a window.open that runs after an await (the user gesture
  // is gone), so phones get a toast whose "Abrir PDF" tap opens the signed URL instead.
  // Not location.assign: inside the native shell that would leave no way back.
  const handleDownloadReport = async (reportId: number, viaTap = false) => {
    // Signing the URL takes a moment; without feedback the row looks inert and
    // gets clicked again. Every download button locks so the spinner on the
    // active row is the only thing that looks clickable.
    if (downloadingReportId !== null) return;
    setDownloadingReportId(reportId);
    // The phone's action sheet closes on tap, so the toast is the in-flight feedback.
    const toastId = viaTap ? toast.loading('Preparando PDF…') : undefined;
    try {
      const url = await getReportDownloadUrl(reportId);
      if (viaTap) {
        toast.success('PDF pronto.', {
          id: toastId,
          action: { label: 'Abrir PDF', onClick: () => openExternalUrl(url) },
          duration: 15000,
        });
      } else openExternalUrl(url);
    } catch {
      toast.error('Erro ao baixar relatório', { id: toastId });
    } finally {
      setDownloadingReportId(null);
    }
  };

  const deleteDoc = async (docId: string) => {
    try {
      await deleteReportDoc(docId);
      qc.invalidateQueries({ queryKey: ['report-docs', clientId] });
      toast.success('Relatório excluído.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir relatório');
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
          <AlertDialogTitle>Enviar relatório por e-mail</AlertDialogTitle>
          <AlertDialogDescription>
            {emailReportTarget && (
              <>
                Enviar o relatório de{' '}
                <strong>{formatReportMonth(emailReportTarget.report_month)}</strong> por e-mail para
                o cliente <strong>{cliente?.nome}</strong>?
                {cliente?.send_report_email === false && (
                  <span
                    style={{
                      display: 'block',
                      marginTop: '0.5rem',
                      color: 'var(--warning)',
                      fontWeight: 600,
                    }}
                  >
                    Atenção: este cliente tem o envio de relatórios por e-mail desativado.
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
                    Último envio:{' '}
                    {new Date(emailReportTarget.last_emailed_at).toLocaleString('pt-BR')}
                  </span>
                )}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sendingEmail}>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={sendingEmail} onClick={handleConfirmSendEmail}>
            {sendingEmail ? 'Enviando...' : 'Enviar'}
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
                  label: downloadingReportId === reportTarget.id ? 'Baixando…' : 'Baixar PDF',
                  disabled: downloadingReportId !== null,
                  onSelect: () => handleDownloadReport(reportTarget.id, true),
                },
              ]
            : []),
          { label: 'Enviar por e-mail', onSelect: () => setEmailReportTarget(reportTarget) },
        ]
      : [];

    return (
      <>
        <GroupedList
          header="Relatórios gerados"
          footer={
            reportDocs.length === 0 && reportsData.length === 0
              ? 'Nenhum relatório gerado ainda.'
              : undefined
          }
        >
          <Cell icon={<Plus />} label="Gerar relatório" onClick={() => setNewReportOpen(true)} />
          {reportDocs.map((doc) => (
            <Cell
              key={doc.id}
              icon={<FileText />}
              label={doc.title}
              subtitle={
                <span className="phone-an-cell-sub phone-an-cell-sub--wrap">
                  {new Date(doc.created_at).toLocaleDateString('pt-BR')}
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
          <GroupedList header="Formato anterior">
            {reportsData.map((r) => {
              const status = reportStatusText(r);
              const ready = r.status === 'ready';
              return (
                <Cell
                  key={r.id}
                  label={`${formatReportMonth(r.report_month)}${r.include_ai ? ' · IA' : ''}`}
                  subtitle={
                    <span className="phone-an-cell-sub phone-an-cell-sub--wrap">
                      <span className={status.tone}>{status.text}</span>
                      {r.generated_at &&
                        ` · ${new Date(r.generated_at).toLocaleDateString('pt-BR')}`}
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
          title={docTarget?.title ?? 'Relatório'}
          actions={
            docTarget
              ? [
                  { label: 'Abrir', onSelect: () => navigate(`/relatorios/${docTarget.id}`) },
                  {
                    label: 'Excluir',
                    destructive: true,
                    onSelect: () => setDocToDelete(docTarget),
                  },
                ]
              : []
          }
        />

        <PhoneConfirmSheet
          open={docToDelete !== null}
          title="Excluir este relatório?"
          message="O PDF exportado também é removido."
          actions={[
            {
              label: 'Excluir',
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
          title={reportTarget ? `Relatório de ${formatReportMonth(reportTarget.report_month)}` : ''}
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
          <h3>Relatórios Gerados</h3>
          <Button variant="outline" size="sm" onClick={() => setNewReportOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Gerar
          </Button>
        </div>
        <div style={{ marginTop: '1rem' }}>
          {reportDocs.length === 0 && reportsData.length === 0 && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Nenhum relatório gerado ainda. Clique em "Gerar" para criar o primeiro.
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
                  {new Date(doc.created_at).toLocaleDateString('pt-BR')}
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
                  Abrir
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Excluir relatório"
                  onClick={async () => {
                    if (
                      !window.confirm('Excluir este relatório? O PDF exportado também é removido.')
                    )
                      return;
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
              Formato anterior
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
                    {new Date(r.generated_at).toLocaleDateString('pt-BR')}
                  </span>
                )}
                {r.include_ai && (
                  <span className="badge badge-neutral badge--sm" style={{ marginLeft: '0.5rem' }}>
                    IA
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {r.status === 'pending' && <span className="badge badge-warning">Pendente</span>}
                {r.status === 'generating' && (
                  <span className="badge badge-info">
                    <Spinner size="sm" /> Gerando...
                  </span>
                )}
                {r.status === 'failed' && (
                  <span
                    className="badge badge-danger"
                    title={r.generation_error || 'Erro desconhecido'}
                    style={{ cursor: 'help' }}
                  >
                    Falha
                  </span>
                )}
                {r.status === 'skipped' && (
                  <span
                    className="badge badge-neutral"
                    title="Não gerado: o plano do workspace não incluía relatórios de analytics no momento da geração."
                    style={{ cursor: 'help' }}
                  >
                    Fora do plano
                  </span>
                )}
                {r.status === 'ready' && (
                  <>
                    <span className="badge badge-success">Pronto</span>
                    {r.storage_path && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={downloadingReportId !== null}
                        onClick={() => handleDownloadReport(r.id)}
                      >
                        {downloadingReportId === r.id ? (
                          <>
                            <Spinner size="sm" /> Baixando…
                          </>
                        ) : (
                          '↓ Baixar PDF'
                        )}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setEmailReportTarget(r)}>
                      Enviar
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

import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
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
import { statusTag as statusTagOf, useSeusClientes } from './useSeusClientes';

/** "Seus clientes": matriz do relatório mensal e das pendências do Hub por
 * cliente, cada uma com um interruptor geral — workspaces.send_report_email /
 * workspaces.send_client_event_emails — e um por cliente —
 * clientes.send_report_email / clientes.send_event_email. Um cliente que já
 * se descadastrou do digest de pendências (clientes.event_email_unsub_at)
 * tem o interruptor daquela coluna esmaecido; reativar exige confirmação num
 * AlertDialog, nunca um toggle direto.
 *
 * Renderizada só para `configuracoes:ver` (o gate da SEÇÃO fica em
 * NotificacoesTab) -- mas os `updateCliente`/`updateWorkspaceBranding` abaixo
 * escrevem em `clientes`/`workspaces`, tabelas com RLS tenant-only (sem
 * predicado de módulo/role). Um papel custom com `configuracoes:ver` mas sem
 * `clientes:editar` passava no gate da seção e conseguia mutar preferências de
 * entrega de qualquer cliente -- os switches abaixo são o único limite de
 * autorização real para essa escrita, daí o segundo gate aqui (Task 14,
 * revisão externa round 3, P1). */
export default function SeusClientesSection() {
  const { t } = useTranslation('settings');
  const {
    loading,
    canEditClients,
    masterEnabled,
    masterEventEnabled,
    search,
    setSearch,
    filtered,
    confirmReactivateId,
    setConfirmReactivateId,
    confirmCliente,
    handleConfirmReactivate,
    saveMaster,
    saveMasterEvent,
    changeClienteReport,
    changeClienteEvent,
  } = useSeusClientes();

  if (loading) {
    return (
      <SkeletonStatus className="card animate-up">
        <div className="mb-4 flex flex-col gap-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
        <div className="divide-y divide-[color:var(--border-color)]">
          {['40%', '52%', '34%', '46%', '38%'].map((w) => (
            <div key={w} className="grid grid-cols-[1fr_170px_170px] items-center gap-2 py-3">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5" style={{ width: w }} />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <span className="flex justify-center">
                <Skeleton className="h-5 w-9 rounded-full" />
              </span>
              <span className="flex justify-center">
                <Skeleton className="h-5 w-9 rounded-full" />
              </span>
            </div>
          ))}
        </div>
      </SkeletonStatus>
    );
  }

  return (
    <div className="card animate-up">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{t('notifications.clientes.title')}</h2>
        <p className="text-sm text-[color:var(--text-muted)]">
          {t('notifications.clientes.description')}
        </p>
        {!canEditClients && (
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">{t('shared.readOnly')}</p>
        )}
      </div>

      <div className="grid grid-cols-[1fr_170px_170px] items-start gap-2 pb-2">
        <span />
        <div className="text-center">
          <div className="text-xs font-medium text-[color:var(--text-muted)]">
            {t('notifications.clientes.monthlyReport')}
          </div>
          <div className="text-xs text-[color:var(--text-muted)]">
            {t('notifications.clientes.monthlyReportHint')}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs font-medium text-[color:var(--text-muted)]">
            {t('notifications.clientes.hubPending')}
          </div>
          <div className="text-xs text-[color:var(--text-muted)]">
            {t('notifications.clientes.hubPendingHint')}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_170px_170px] items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] p-3">
        <span className="font-medium">{t('notifications.clientes.allClients')}</span>
        <span className="flex justify-center">
          <Switch
            aria-label={t('notifications.clientes.reportAllAria')}
            checked={masterEnabled}
            disabled={!canEditClients}
            onCheckedChange={(v) => saveMaster(v)}
          />
        </span>
        <span className="flex justify-center">
          <Switch
            aria-label={t('notifications.clientes.pendingAllAria')}
            checked={masterEventEnabled}
            disabled={!canEditClients}
            onCheckedChange={(v) => saveMasterEvent(v)}
          />
        </span>
      </div>

      <div className="mt-4">
        <Input
          type="text"
          placeholder={t('notifications.clientes.searchPlaceholder')}
          aria-label={t('notifications.clientes.searchAria')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 && (
        <p className="mt-4 text-center text-sm text-[color:var(--text-muted)]">
          {t('notifications.clientes.empty')}
        </p>
      )}

      <div className="mt-2 divide-y divide-[color:var(--border-color)]">
        {filtered.map((cliente) => {
          const hasEmail = !!cliente.email;
          const unsubbed = !!cliente.event_email_unsub_at;
          // Clientes homônimos: o e-mail (ou, sem ele, o id) desambigua o
          // nome acessível de cada linha.
          const identifiedName =
            cliente.id != null
              ? t('notifications.clientes.identifiedName', { name: cliente.nome, id: cliente.id })
              : cliente.nome;
          const statusTag = statusTagOf(cliente.status);
          return (
            <div
              key={cliente.id}
              className="grid grid-cols-[1fr_170px_170px] items-center gap-2 py-3"
            >
              <div>
                <div className="font-medium">
                  {cliente.nome}
                  {statusTag && (
                    <span className="ml-1 text-xs font-normal text-[color:var(--text-muted)]">
                      {statusTag}
                    </span>
                  )}
                </div>
                <div className="text-sm text-[color:var(--text-muted)]">
                  {hasEmail ? cliente.email : t('notifications.clientes.noEmail')}
                </div>
              </div>
              <span className="flex justify-center">
                {hasEmail ? (
                  <Switch
                    aria-label={t('notifications.clientes.reportAria', {
                      name: cliente.nome,
                      email: cliente.email,
                    })}
                    checked={cliente.send_report_email ?? false}
                    disabled={!canEditClients}
                    onCheckedChange={(v) => changeClienteReport(cliente, v)}
                  />
                ) : (
                  <span
                    className="text-center text-[color:var(--text-muted)]"
                    title={t('notifications.clientes.noEmailTitle')}
                    aria-label={t('notifications.clientes.noEmailReportAria', {
                      name: identifiedName,
                    })}
                  >
                    ·
                  </span>
                )}
              </span>
              <span className="flex flex-col items-center justify-center gap-0.5">
                {hasEmail ? (
                  <>
                    <Switch
                      aria-label={t('notifications.clientes.pendingAria', {
                        name: cliente.nome,
                        email: cliente.email,
                      })}
                      checked={cliente.send_event_email ?? false}
                      // O esmaecimento de `unsubbed` é só VISUAL: um controle
                      // realmente desabilitado não recebe clique nenhum, e
                      // reativar precisa do clique para abrir o AlertDialog de
                      // confirmação. `disabled` fica reservado ao gate de
                      // permissão (Task 14) -- aí não há mutação a autorizar,
                      // reativação inclusive, então bloquear o clique é o
                      // comportamento certo.
                      className={unsubbed ? 'opacity-60' : undefined}
                      disabled={!canEditClients}
                      onCheckedChange={(v) => changeClienteEvent(cliente, v)}
                    />
                    {unsubbed && (
                      // --warning não tem contraparte de texto acessível (o
                      // mesmo problema documentado para --danger/--danger-text
                      // no DESIGN_SYSTEM.md) — usa --text-muted, já AA neste
                      // arquivo, em vez de colorir a nota.
                      <span className="text-center text-xs leading-tight text-[color:var(--text-muted)]">
                        {t('notifications.clientes.unsubbed')}
                      </span>
                    )}
                  </>
                ) : (
                  <span
                    className="text-center text-[color:var(--text-muted)]"
                    title={t('notifications.clientes.noEmailTitle')}
                    aria-label={t('notifications.clientes.noEmailPendingAria', {
                      name: identifiedName,
                    })}
                  >
                    ·
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-sm text-[color:var(--text-muted)]">
        {t('notifications.clientes.footer')}
      </p>

      <AlertDialog
        open={confirmReactivateId != null}
        onOpenChange={(open) => {
          if (!open) setConfirmReactivateId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmCliente
                ? t('notifications.clientes.reactivateTitleFor', { name: confirmCliente.nome })
                : t('notifications.clientes.reactivateTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('notifications.clientes.reactivateBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmReactivate}>
              {t('notifications.clientes.reactivate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

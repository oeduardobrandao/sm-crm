import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Eye,
  ToggleLeft,
  ToggleRight,
  Plus,
  CalendarClock,
  RefreshCw,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { differenceInCalendarDays, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { openExternalUrl } from '@/utils/security';
import {
  getHubToken,
  createHubToken,
  setHubTokenActive,
  extendHubToken,
  rotateHubToken,
  invalidateHubTokenQueries,
  getWorkspaceSlug,
} from '@/store';
import { captureEvent } from '@/lib/analytics';
import { useEntitlements } from '@/hooks/useEntitlements';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { HubRoleGate } from './HubRoleGate';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

// Raw Postgres error text must never reach the user.
function mapTokenError(e: { message?: string }): string {
  const m = e?.message ?? '';
  if (m.includes('forbidden')) return 'Sem permissão para este cliente.';
  if (m.includes('not_found')) return 'Link não encontrado.';
  return 'Não foi possível concluir a ação.';
}

export default function AcessoPage() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const qc = useQueryClient();
  const contaId = cliente.conta_id;

  // The DB gates client_hub_tokens inserts on feature_hub_portal. Reading the flag up
  // front turns what used to be a raw "feature_disabled:…" error into an upgrade nudge.
  // hasFeature is true while entitlements load, so the paywall never flashes.
  const { hasFeature } = useEntitlements();
  const hubPortalEnabled = hasFeature('feature_hub_portal');

  const { data: tokenData } = useQuery({
    queryKey: ['hub-token', clienteId],
    queryFn: () => getHubToken(clienteId),
  });

  // Ported from HubClienteTab.tsx (see git history at d30adeea), where this was a
  // page-wide query — this is the only one of the five portal screens that builds
  // the portal URL, so it is the only one that still needs the workspace slug.
  const { data: workspaceSlug } = useQuery({
    queryKey: ['workspace-slug'],
    queryFn: getWorkspaceSlug,
  });

  const hubUrl =
    tokenData && workspaceSlug
      ? `${window.location.origin}/${workspaceSlug}/hub/${tokenData.token}`
      : '';

  const expiresAt = tokenData ? new Date(tokenData.expires_at) : null;
  const daysLeft = expiresAt ? differenceInCalendarDays(expiresAt, new Date()) : null;
  // Classification keys off the real instant (matches the server's `expires_at > now()`
  // check exactly) — differenceInCalendarDays truncates to calendar-day boundaries, so a
  // token that lapsed earlier today would otherwise read daysLeft === 0 and look healthy
  // until midnight. daysLeft is still used below for the friendlier "Expira em N dias" label.
  const isExpired = expiresAt !== null && expiresAt.getTime() <= Date.now();
  const isNearExpiry = !isExpired && daysLeft !== null && daysLeft <= 30;
  // Auto-renew throttles at 350d, so a live link never lands in this range.
  // The rescue only surfaces for genuinely dormant clients.
  const showRescue = isExpired || isNearExpiry;

  const [extending, setExtending] = useState(false);
  const [rotating, setRotating] = useState(false);

  async function toggleActive() {
    if (!tokenData) return;
    await setHubTokenActive(tokenData.id, !tokenData.is_active);
    invalidateHubTokenQueries(qc, clienteId);
    toast.success(tokenData.is_active ? 'Acesso desativado.' : 'Acesso reativado.');
  }

  async function copyLink() {
    await navigator.clipboard.writeText(hubUrl);
    toast.success('Link copiado!');
    captureEvent('hub_link_copied', { cliente_id: clienteId });
  }

  async function handleExtend() {
    if (!tokenData) return;
    setExtending(true);
    try {
      await extendHubToken(tokenData.id);
      invalidateHubTokenQueries(qc, clienteId);
      toast.success('Link renovado por mais 1 ano.');
    } catch (e: any) {
      toast.error(mapTokenError(e));
    } finally {
      setExtending(false);
    }
  }

  async function handleRotate() {
    if (!tokenData) return;
    setRotating(true);
    try {
      await rotateHubToken(tokenData.id);
      invalidateHubTokenQueries(qc, clienteId);
      toast.success('Novo link gerado. Envie-o ao cliente — o anterior parou de funcionar.');
    } catch (e: any) {
      toast.error(mapTokenError(e));
    } finally {
      setRotating(false);
    }
  }

  if (!contaId || !workspaceSlug) return null;

  return (
    <div className="hub-page">
      <header className="hub-page__head">
        <div>
          <h2 className="hub-page__title">Acesso</h2>
          <p className="hub-page__sub">
            Gerencie o link permanente de acesso do cliente ao portal.
          </p>
        </div>
      </header>
      <HubRoleGate>
        <section>
          <h3 className="font-semibold mb-3">Acesso do Cliente</h3>
          {tokenData ? (
            <>
              <div className="hub-access">
                <code className="hub-access__url text-xs bg-muted px-3 py-2 rounded-lg truncate">
                  {hubUrl}
                </code>
                <div className="hub-access__actions">
                  <div className="hub-access__secondary-actions">
                    <Button size="sm" variant="outline" onClick={copyLink}>
                      <Copy size={14} className="mr-1.5" /> Copiar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openExternalUrl(hubUrl)}>
                      <Eye size={14} className="mr-1.5" /> Preview
                    </Button>
                  </div>
                  <div className="hub-access__primary-actions">
                    <Button
                      size="sm"
                      variant={tokenData.is_active ? 'destructive' : 'default'}
                      onClick={toggleActive}
                    >
                      {tokenData.is_active ? (
                        <>
                          <ToggleRight size={14} className="mr-1.5" /> Desativar
                        </>
                      ) : (
                        <>
                          <ToggleLeft size={14} className="mr-1.5" /> Ativar
                        </>
                      )}
                    </Button>

                    {showRescue && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleExtend}
                        disabled={extending}
                      >
                        <CalendarClock size={14} className="mr-1.5" /> Estender +1 ano
                      </Button>
                    )}

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" disabled={rotating}>
                          <RefreshCw size={14} className="mr-1.5" /> Gerar novo link
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Gerar um novo link?</AlertDialogTitle>
                          <AlertDialogDescription>
                            O link atual para de funcionar imediatamente. O cliente perde o acesso
                            até você enviar o novo link. Esta ação não pode ser desfeita.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={handleRotate}>Confirmar</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>

              {expiresAt && (
                <p
                  className={
                    isExpired
                      ? 'w-full text-xs font-medium text-destructive mt-2'
                      : isNearExpiry
                        ? 'w-full text-xs font-medium text-amber-600 mt-2'
                        : 'w-full text-xs text-muted-foreground mt-2'
                  }
                >
                  <CalendarClock size={12} className="mr-1 inline" />
                  {isExpired ? (
                    <>
                      <span className="mr-1.5 rounded bg-destructive/10 px-1.5 py-0.5 uppercase">
                        Expirado
                      </span>
                      Expirou em {format(expiresAt, 'dd/MM/yyyy', { locale: ptBR })}
                    </>
                  ) : isNearExpiry ? (
                    <>
                      Expira em {daysLeft} dias ({format(expiresAt, 'dd/MM/yyyy', { locale: ptBR })}
                      )
                    </>
                  ) : (
                    <>Expira em {format(expiresAt, 'dd/MM/yyyy', { locale: ptBR })}</>
                  )}
                </p>
              )}
            </>
          ) : !hubPortalEnabled ? (
            <div className="hub-access__upgrade rounded-xl border border-dashed border-border p-6 text-center">
              <Lock size={18} className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                O Portal do Cliente faz parte dos planos pagos.
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Faça upgrade para gerar um link de acesso e entregar aprovações, briefing, postagens
                e ideias em um portal com a sua marca.
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => {
                  captureEvent('hub_upgrade_prompt_clicked', { cliente_id: clienteId });
                  window.location.href = '/configuracao/cobranca';
                }}
              >
                Ver planos
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">Nenhum link gerado ainda.</p>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await createHubToken(clienteId, contaId);
                    invalidateHubTokenQueries(qc, clienteId);
                    toast.success('Link gerado!');
                  } catch (e: any) {
                    // Entitlements can go stale between load and click — fall back to the
                    // upgrade toast rather than leaking the raw Postgres message.
                    if (!handleEntitlementMutationError(e, contaId ?? null))
                      toast.error(mapTokenError(e));
                  }
                }}
              >
                <Plus size={14} className="mr-1.5" /> Gerar link
              </Button>
            </div>
          )}
        </section>
      </HubRoleGate>
    </div>
  );
}

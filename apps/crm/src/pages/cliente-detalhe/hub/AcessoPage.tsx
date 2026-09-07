import { useState, type ReactNode } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  Copy,
  Eye,
  ToggleLeft,
  ToggleRight,
  Plus,
  CalendarClock,
  RefreshCw,
  Lock,
  Lightbulb,
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
  type PortalFill,
} from '@/store';
import { captureEvent } from '@/lib/analytics';
import { useEntitlements } from '@/hooks/useEntitlements';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { HubRoleGate, useHubPortalDataEnabled } from './HubRoleGate';
import { usePortalFill } from './usePortalFill';
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

  // Tri-state: só `can('configuracoes','editar') === true` libera a busca. Enquanto a
  // membership não resolve ('unknown') as queries ficam desligadas — o viewer ainda pode
  // vir a ser um agent, e o bearer token do portal não pode vazar para ele.
  const canLoadPortalData = useHubPortalDataEnabled();

  // An agent never sees the token (HubRoleGate below withholds it) — don't fetch the
  // portal bearer token just to discard it at render. Before the split, HubClienteTab
  // returned RoleRestrictionNotice before HubTab (and this query) ever mounted; disabling
  // it here restores that.
  const { data: tokenData } = useQuery({
    queryKey: ['hub-token', clienteId],
    queryFn: () => getHubToken(clienteId),
    enabled: canLoadPortalData,
  });

  // Ported from HubClienteTab.tsx (see git history at d30adeea), where this was a
  // page-wide query — this is the only one of the five portal screens that builds
  // the portal URL, so it is the only one that still needs the workspace slug.
  // Same reasoning as hub-token above: an agent never needs it.
  const { data: workspaceSlug } = useQuery({
    queryKey: ['workspace-slug'],
    queryFn: getWorkspaceSlug,
    enabled: canLoadPortalData,
  });

  // Backs the "O que o cliente vê" panel. Same gating as the two queries above:
  // usePortalFill withholds the fetch itself for a restricted agent.
  const fillQuery = usePortalFill(clienteId);

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
      toast.success('Novo link gerado. Envie-o ao cliente. O anterior parou de funcionar.');
    } catch (e: any) {
      toast.error(mapTokenError(e));
    } finally {
      setRotating(false);
    }
  }

  if (!contaId) return null;

  // For an allowed role, also wait for workspaceSlug before rendering (avoids a flash of
  // "Nenhum link gerado ainda." before the slug resolves). A restricted agent — and a
  // viewer whose membership is still 'unknown' — skips this: workspaceSlug's query is
  // disabled above and never resolves, but HubRoleGate below shows the notice (or the
  // spinner) regardless, so it must not be blocked on a query that never fires for it.
  if (canLoadPortalData && !workspaceSlug) return null;

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
        <div className="hub-acesso__grid">
          <div className="hub-acesso__main">
            <section>
              <h3 className="font-semibold mb-3">Acesso do Cliente</h3>
              {tokenData ? (
                <div className="hub-access">
                  <div className="hub-access__status">
                    <span
                      className={
                        tokenData.is_active
                          ? 'hub-access__chip hub-access__chip--active'
                          : 'hub-access__chip hub-access__chip--inactive'
                      }
                    >
                      {tokenData.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                    {expiresAt && (
                      <span
                        className={
                          isExpired
                            ? 'text-xs font-medium text-destructive'
                            : isNearExpiry
                              ? 'text-xs font-medium text-amber-600'
                              : 'text-xs text-muted-foreground'
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
                            Expira em {daysLeft} dias (
                            {format(expiresAt, 'dd/MM/yyyy', { locale: ptBR })})
                          </>
                        ) : (
                          <>Expira em {format(expiresAt, 'dd/MM/yyyy', { locale: ptBR })}</>
                        )}
                      </span>
                    )}
                  </div>

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
              ) : !hubPortalEnabled ? (
                <div className="hub-access__upgrade rounded-xl border border-dashed border-border p-6 text-center">
                  <Lock size={18} className="mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">
                    O Portal do Cliente faz parte dos planos pagos.
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    Faça upgrade para gerar um link de acesso e entregar aprovações, briefing,
                    postagens e ideias em um portal com a sua marca.
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

            <NewIdeasRow query={fillQuery} />
          </div>

          <aside className="hub-acesso__panel">
            <h3 className="font-semibold mb-3">O que o cliente vê</h3>
            <FillRow testId="fill-briefing" label="Briefing" to="../briefing" query={fillQuery}>
              <FillValue query={fillQuery}>
                {fillQuery.data &&
                  (fillQuery.data.briefingTotal === 0 ? (
                    <span className="hub-fill__empty">vazia</span>
                  ) : (
                    `${fillQuery.data.briefingAnswered} de ${fillQuery.data.briefingTotal} respondidas`
                  ))}
              </FillValue>
            </FillRow>
            <FillRow testId="fill-marca" label="Marca" to="../marca" query={fillQuery}>
              <FillValue query={fillQuery}>
                {fillQuery.data &&
                  (!fillQuery.data.hasBrand && fillQuery.data.brandFiles === 0 ? (
                    <span className="hub-fill__empty">vazia</span>
                  ) : fillQuery.data.brandFiles > 0 ? (
                    `${fillQuery.data.brandFiles} ${fillQuery.data.brandFiles === 1 ? 'arquivo' : 'arquivos'}`
                  ) : (
                    'Marca configurada'
                  ))}
              </FillValue>
            </FillRow>
            <FillRow testId="fill-paginas" label="Páginas" to="../paginas" query={fillQuery}>
              <FillValue query={fillQuery}>
                {fillQuery.data &&
                  (fillQuery.data.pages === 0 ? (
                    <span className="hub-fill__empty">vazia</span>
                  ) : (
                    `${fillQuery.data.pages} ${fillQuery.data.pages === 1 ? 'página' : 'páginas'}`
                  ))}
              </FillValue>
            </FillRow>
          </aside>
        </div>
      </HubRoleGate>
    </div>
  );
}

/** Dash while the count is still loading OR failed to load. Never "vazia" for either --
 * that word asserts the section is empty, which is only true once the count resolves. */
function FillValue({
  query,
  children,
}: {
  query: UseQueryResult<PortalFill>;
  children: ReactNode;
}) {
  if (!query.isSuccess) return <span className="hub-fill__pending">–</span>;
  return <>{children}</>;
}

/**
 * One row of the "O que o cliente vê" panel. A pending value (still loading, or the
 * count failed) doesn't become a Link — there's nothing conclusive to click through to
 * yet, and for the error case specifically, turning a failed request into a normal-looking
 * navigable row would hide the failure.
 */
function FillRow({
  testId,
  label,
  to,
  query,
  children,
}: {
  testId: string;
  label: string;
  to: string;
  query: UseQueryResult<PortalFill>;
  children: ReactNode;
}) {
  const pending = !query.isSuccess;
  const content = (
    <>
      <span className="hub-fill__label">{label}</span>
      <span className="hub-fill__value">{children}</span>
    </>
  );
  return (
    <div className="hub-fill__row" data-testid={testId}>
      {pending ? (
        <span className="hub-fill__row-inner">{content}</span>
      ) : (
        <Link to={to} relative="path" className="hub-fill__row-inner">
          {content}
        </Link>
      )}
    </div>
  );
}

/** Ideias novas sem resposta: a call-to-action row under the link card, not one of the
 * panel's "seções" (it has no dedicated portal tab of its own the way Briefing/Marca/
 * Páginas do — it points at the Ideias tab's unanswered slice). Hidden once resolved to
 * zero: unlike the panel's rows, there's nothing to review, so a persistent "0" line
 * would just be noise. */
function NewIdeasRow({ query }: { query: UseQueryResult<PortalFill> }) {
  if (query.isLoading || query.isError) {
    return (
      <p className="hub-acesso__ideas mt-1 text-sm text-muted-foreground">
        Ideias novas sem resposta: <span className="hub-fill__pending">–</span>
      </p>
    );
  }

  const count = query.data?.newIdeasWithoutReply ?? 0;
  if (count === 0) return null;

  return (
    <Link
      to="../ideias"
      relative="path"
      className="hub-acesso__ideas hub-acesso__ideas--alert mt-1"
    >
      <Lightbulb size={14} className="mr-1.5 inline" />
      {count} {count === 1 ? 'ideia nova' : 'ideias novas'} sem resposta
    </Link>
  );
}

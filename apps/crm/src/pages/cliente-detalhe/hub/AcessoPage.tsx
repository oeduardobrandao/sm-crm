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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
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
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { useClientePhoneHeader } from '../phone/ClientePhoneChrome';
import '../phone/clienteDetalhePhone.css';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';
import { compactHubToken } from '@/lib/hubLinks';

// Raw Postgres error text must never reach the user.
function mapTokenError(e: { message?: string }, t: TFunction<'clientHub'>): string {
  const m = e?.message ?? '';
  if (m.includes('forbidden')) return t('acesso.errors.forbidden');
  if (m.includes('not_found')) return t('acesso.errors.notFound');
  return t('acesso.errors.generic');
}

export default function AcessoPage() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const qc = useQueryClient();
  const contaId = cliente.conta_id;
  const { t } = useTranslation('clientHub');
  const dateLocale = useDateFnsLocale();

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
  //
  // `data` alone can't tell "still loading" apart from "resolved to null" -- both
  // `workspaces.slug` and `contas.slug` are nullable columns (trigger + one-time
  // backfill, not a NOT NULL constraint), so `null` is a legitimate resolved value,
  // not just a loading placeholder. `isPending` is the query's own loading signal
  // (stays true the whole time for a query that never resolves, flips to false the
  // instant it settles, success or error) -- branch on that instead of on truthiness.
  const workspaceSlugQuery = useQuery({
    queryKey: ['workspace-slug'],
    queryFn: getWorkspaceSlug,
    enabled: canLoadPortalData,
  });
  const workspaceSlug = workspaceSlugQuery.data;

  // Backs the "O que o cliente vê" panel. Same gating as the two queries above:
  // usePortalFill withholds the fetch itself for a restricted agent.
  const fillQuery = usePortalFill(clienteId);

  const hubUrl =
    tokenData && workspaceSlug
      ? `${window.location.origin}/${workspaceSlug}/hub/${compactHubToken(tokenData.token)}`
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
  const isPhone = !useIsDesktop(768);
  const [confirm, setConfirm] = useState<'rotate' | 'deactivate' | null>(null);
  useClientePhoneHeader({
    subtitle: t('acesso.subtitle'),
  });

  async function toggleActive() {
    if (!tokenData) return;
    await setHubTokenActive(tokenData.id, !tokenData.is_active);
    invalidateHubTokenQueries(qc, clienteId);
    toast.success(
      tokenData.is_active ? t('acesso.toast.deactivated') : t('acesso.toast.reactivated'),
    );
  }

  async function copyLink() {
    await navigator.clipboard.writeText(hubUrl);
    toast.success(t('acesso.toast.copied'));
    captureEvent('hub_link_copied', { cliente_id: clienteId });
  }

  async function handleExtend() {
    if (!tokenData) return;
    setExtending(true);
    try {
      await extendHubToken(tokenData.id);
      invalidateHubTokenQueries(qc, clienteId);
      toast.success(t('acesso.toast.extended'));
    } catch (e: any) {
      toast.error(mapTokenError(e, t));
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
      toast.success(t('acesso.toast.rotated'));
    } catch (e: any) {
      toast.error(mapTokenError(e, t));
    } finally {
      setRotating(false);
    }
  }

  if (!contaId) return null;

  // For an allowed role, also wait for workspaceSlug to settle before rendering (avoids
  // a flash of "Nenhum link gerado ainda." before the slug resolves). A restricted agent
  // — and a viewer whose membership is still 'unknown' — skips this: workspaceSlug's
  // query is disabled above and never resolves, but HubRoleGate below shows the notice
  // (or the spinner) regardless, so it must not be blocked on a query that never fires
  // for it. `isPending` -- not the truthiness of `workspaceSlug` -- is what "still
  // loading" means here: once the query settles (even to a resolved `null`), the page
  // must render its header and everything that doesn't depend on the slug, rather than
  // staying blank forever. See Finding 1 in task-9's fix round.
  if (canLoadPortalData && workspaceSlugQuery.isPending) return null;

  async function handleCreate() {
    try {
      await createHubToken(clienteId, contaId!);
      invalidateHubTokenQueries(qc, clienteId);
      toast.success(t('acesso.toast.created'));
    } catch (e: any) {
      // Entitlements can go stale between load and click — fall back to the
      // upgrade toast rather than leaking the raw Postgres message.
      if (!handleEntitlementMutationError(e, contaId ?? null)) toast.error(mapTokenError(e, t));
    }
  }

  const expiresDate = expiresAt
    ? format(expiresAt, t('shared.dateShort'), { locale: dateLocale })
    : null;

  if (isPhone) {
    const fill = fillQuery.data;
    const fillValue = (text: string) => (fillQuery.isSuccess ? text : '–');
    const fillTo = (segment: string) =>
      fillQuery.isSuccess ? `/clientes/${clienteId}/hub/${segment}` : undefined;
    const expiryText = expiresDate
      ? isExpired
        ? t('acesso.expiredOn', { date: expiresDate })
        : isNearExpiry
          ? t('acesso.expiresInDays', { count: daysLeft ?? 0, date: expiresDate })
          : t('acesso.expiresOn', { date: expiresDate })
      : null;
    const newIdeas = fill?.newIdeasWithoutReply ?? 0;
    return (
      <div className="phone-cli-acesso">
        <HubRoleGate>
          {tokenData ? (
            <>
              <section className="phone-cli-card" aria-label={t('acesso.sectionTitle')}>
                <p className="phone-cli-acesso__status">
                  <span
                    className="phone-cli-chip"
                    data-tone={tokenData.is_active && !isExpired ? 'success' : 'danger'}
                  >
                    {isExpired
                      ? t('acesso.status.expired')
                      : tokenData.is_active
                        ? t('acesso.status.active')
                        : t('acesso.status.inactive')}
                  </span>
                  {expiryText && (
                    <span
                      className="phone-cli-acesso__expiry"
                      data-tone={isExpired ? 'danger' : isNearExpiry ? 'warning' : undefined}
                    >
                      <CalendarClock aria-hidden="true" />
                      {expiryText}
                    </span>
                  )}
                </p>
                {workspaceSlug ? (
                  <code className="phone-cli-acesso__url">{hubUrl}</code>
                ) : (
                  <p className="phone-cli-acesso__error" data-testid="hub-slug-missing">
                    {t('acesso.slugMissing')}
                  </p>
                )}
              </section>
              {workspaceSlug && (
                <GroupedList aria-label={t('acesso.portalLinkAria')}>
                  <Cell label={t('acesso.copy')} icon={<Copy />} onClick={() => void copyLink()} />
                  <Cell
                    label={t('acesso.preview')}
                    icon={<Eye />}
                    onClick={() => openExternalUrl(hubUrl)}
                  />
                </GroupedList>
              )}
              <GroupedList aria-label={t('acesso.linkActionsAria')}>
                {showRescue && (
                  <Cell
                    label={t('acesso.extend')}
                    icon={<CalendarClock />}
                    disabled={extending}
                    onClick={() => void handleExtend()}
                  />
                )}
                {tokenData.is_active ? (
                  <Cell
                    label={t('acesso.deactivate')}
                    icon={<ToggleRight />}
                    destructive
                    onClick={() => setConfirm('deactivate')}
                  />
                ) : (
                  <Cell
                    label={t('acesso.activate')}
                    icon={<ToggleLeft />}
                    onClick={() => void toggleActive()}
                  />
                )}
                <Cell
                  label={t('acesso.rotate')}
                  icon={<RefreshCw />}
                  destructive
                  disabled={rotating}
                  onClick={() => setConfirm('rotate')}
                />
              </GroupedList>
            </>
          ) : !hubPortalEnabled ? (
            <section className="phone-cli-card phone-cli-acesso__upgrade">
              <Lock aria-hidden="true" />
              <p className="phone-cli-acesso__upgrade-title">{t('acesso.upgradeTitle')}</p>
              <p className="phone-cli-acesso__upgrade-text">{t('acesso.upgradeText')}</p>
              <button
                type="button"
                className="phone-cli-button"
                onClick={() => {
                  captureEvent('hub_upgrade_prompt_clicked', { cliente_id: clienteId });
                  window.location.href = '/configuracao/cobranca';
                }}
              >
                {t('acesso.seePlans')}
              </button>
            </section>
          ) : (
            <GroupedList footer={t('acesso.noLink')} aria-label={t('acesso.sectionTitle')}>
              <Cell
                label={t('acesso.generate')}
                icon={<Plus />}
                onClick={() => void handleCreate()}
              />
            </GroupedList>
          )}

          {fillQuery.isLoading || fillQuery.isError ? (
            <GroupedList aria-label={t('acesso.newIdeasLabel')}>
              <Cell label={t('acesso.newIdeasLabel')} value="–" />
            </GroupedList>
          ) : newIdeas > 0 ? (
            <GroupedList aria-label={t('acesso.newIdeasLabel')}>
              <Cell
                label={t('acesso.newIdeas', { count: newIdeas })}
                icon={<Lightbulb />}
                to={`/clientes/${clienteId}/hub/ideias`}
              />
            </GroupedList>
          ) : null}

          <GroupedList header={t('acesso.fill.header')}>
            <Cell
              data-testid="fill-briefing"
              label={t('acesso.fill.briefing')}
              value={fillValue(
                fill
                  ? fill.briefingTotal === 0
                    ? t('acesso.fill.empty')
                    : t('acesso.fill.briefingAnswered', {
                        answered: fill.briefingAnswered,
                        total: fill.briefingTotal,
                      })
                  : '',
              )}
              to={fillTo('briefing')}
            />
            <Cell
              data-testid="fill-marca"
              label={t('acesso.fill.brand')}
              value={fillValue(
                fill
                  ? !fill.hasBrand && fill.brandFiles === 0
                    ? t('acesso.fill.empty')
                    : fill.brandFiles > 0
                      ? t('acesso.fill.brandFiles', { count: fill.brandFiles })
                      : t('acesso.fill.brandConfigured')
                  : '',
              )}
              to={fillTo('marca')}
            />
            <Cell
              data-testid="fill-paginas"
              label={t('acesso.fill.pages')}
              value={fillValue(
                fill
                  ? fill.pages === 0
                    ? t('acesso.fill.empty')
                    : t('acesso.fill.pageCount', { count: fill.pages })
                  : '',
              )}
              to={fillTo('paginas')}
            />
          </GroupedList>
        </HubRoleGate>

        <PhoneConfirmSheet
          open={confirm === 'rotate'}
          title={t('acesso.rotateConfirm.title')}
          message={t('acesso.rotateConfirm.message')}
          actions={[
            {
              label: t('actions.confirm'),
              destructive: true,
              onSelect: () => {
                setConfirm(null);
                void handleRotate();
              },
            },
          ]}
          onCancel={() => setConfirm(null)}
        />
        <PhoneConfirmSheet
          open={confirm === 'deactivate'}
          title={t('acesso.deactivateConfirm.title')}
          message={t('acesso.deactivateConfirm.message')}
          actions={[
            {
              label: t('acesso.deactivate'),
              destructive: true,
              onSelect: () => {
                setConfirm(null);
                void toggleActive();
              },
            },
          ]}
          onCancel={() => setConfirm(null)}
        />
      </div>
    );
  }

  return (
    <div className="hub-page">
      <header className="hub-page__head">
        <div>
          <h2 className="hub-page__title">{t('acesso.title')}</h2>
          <p className="hub-page__sub">{t('acesso.subtitle')}</p>
        </div>
      </header>
      <HubRoleGate>
        <div className="hub-acesso__grid">
          <div className="hub-acesso__main">
            <section>
              <h3 className="font-semibold mb-3">{t('acesso.sectionTitle')}</h3>
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
                      {tokenData.is_active
                        ? t('acesso.status.active')
                        : t('acesso.status.inactive')}
                    </span>
                    {expiresDate && (
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
                              {t('acesso.status.expired')}
                            </span>
                            {t('acesso.expiredOn', { date: expiresDate })}
                          </>
                        ) : isNearExpiry ? (
                          t('acesso.expiresInDays', { count: daysLeft ?? 0, date: expiresDate })
                        ) : (
                          t('acesso.expiresOn', { date: expiresDate })
                        )}
                      </span>
                    )}
                  </div>

                  {workspaceSlug ? (
                    <code className="hub-access__url text-xs bg-muted px-3 py-2 rounded-lg truncate">
                      {hubUrl}
                    </code>
                  ) : (
                    // workspaceSlug resolved to null (nullable column, no NOT NULL
                    // constraint -- see Finding 1). The token itself is fine; only the
                    // URL can't be assembled, so say that instead of hiding everything.
                    <p
                      className="text-xs font-medium text-destructive"
                      data-testid="hub-slug-missing"
                    >
                      {t('acesso.slugMissing')}
                    </p>
                  )}

                  <div className="hub-access__actions">
                    <div className="hub-access__secondary-actions">
                      {workspaceSlug && (
                        <>
                          <Button size="sm" variant="outline" onClick={copyLink}>
                            <Copy size={14} className="mr-1.5" /> {t('acesso.copy')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openExternalUrl(hubUrl)}
                          >
                            <Eye size={14} className="mr-1.5" /> {t('acesso.preview')}
                          </Button>
                        </>
                      )}
                    </div>
                    <div className="hub-access__primary-actions">
                      <Button
                        size="sm"
                        variant={tokenData.is_active ? 'destructive' : 'default'}
                        onClick={toggleActive}
                      >
                        {tokenData.is_active ? (
                          <>
                            <ToggleRight size={14} className="mr-1.5" /> {t('acesso.deactivate')}
                          </>
                        ) : (
                          <>
                            <ToggleLeft size={14} className="mr-1.5" /> {t('acesso.activate')}
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
                          <CalendarClock size={14} className="mr-1.5" /> {t('acesso.extend')}
                        </Button>
                      )}

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive" disabled={rotating}>
                            <RefreshCw size={14} className="mr-1.5" /> {t('acesso.rotate')}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('acesso.rotateConfirm.title')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('acesso.rotateConfirm.message')}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
                            <AlertDialogAction onClick={handleRotate}>
                              {t('actions.confirm')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ) : !hubPortalEnabled ? (
                <div className="hub-access__upgrade rounded-xl border border-dashed border-border p-6 text-center">
                  <Lock size={18} className="mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">{t('acesso.upgradeTitle')}</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    {t('acesso.upgradeText')}
                  </p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      captureEvent('hub_upgrade_prompt_clicked', { cliente_id: clienteId });
                      window.location.href = '/configuracao/cobranca';
                    }}
                  >
                    {t('acesso.seePlans')}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground">{t('acesso.noLink')}</p>
                  <Button size="sm" onClick={handleCreate}>
                    <Plus size={14} className="mr-1.5" /> {t('acesso.generate')}
                  </Button>
                </div>
              )}
            </section>

            <NewIdeasRow query={fillQuery} />
          </div>

          <aside className="hub-acesso__panel">
            <h3 className="font-semibold mb-3">{t('acesso.fill.header')}</h3>
            <FillRow
              testId="fill-briefing"
              label={t('acesso.fill.briefing')}
              to="../briefing"
              query={fillQuery}
            >
              <FillValue query={fillQuery}>
                {fillQuery.data &&
                  (fillQuery.data.briefingTotal === 0 ? (
                    <span className="hub-fill__empty">{t('acesso.fill.empty')}</span>
                  ) : (
                    t('acesso.fill.briefingAnswered', {
                      answered: fillQuery.data.briefingAnswered,
                      total: fillQuery.data.briefingTotal,
                    })
                  ))}
              </FillValue>
            </FillRow>
            <FillRow
              testId="fill-marca"
              label={t('acesso.fill.brand')}
              to="../marca"
              query={fillQuery}
            >
              <FillValue query={fillQuery}>
                {fillQuery.data &&
                  (!fillQuery.data.hasBrand && fillQuery.data.brandFiles === 0 ? (
                    <span className="hub-fill__empty">{t('acesso.fill.empty')}</span>
                  ) : fillQuery.data.brandFiles > 0 ? (
                    t('acesso.fill.brandFiles', { count: fillQuery.data.brandFiles })
                  ) : (
                    t('acesso.fill.brandConfigured')
                  ))}
              </FillValue>
            </FillRow>
            <FillRow
              testId="fill-paginas"
              label={t('acesso.fill.pages')}
              to="../paginas"
              query={fillQuery}
            >
              <FillValue query={fillQuery}>
                {fillQuery.data &&
                  (fillQuery.data.pages === 0 ? (
                    <span className="hub-fill__empty">{t('acesso.fill.empty')}</span>
                  ) : (
                    t('acesso.fill.pageCount', { count: fillQuery.data.pages })
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
  const { t } = useTranslation('clientHub');
  if (query.isLoading || query.isError) {
    return (
      <p className="hub-acesso__ideas mt-1 text-sm text-muted-foreground">
        {t('acesso.newIdeasPrefix')} <span className="hub-fill__pending">–</span>
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
      {t('acesso.newIdeas', { count })}
    </Link>
  );
}

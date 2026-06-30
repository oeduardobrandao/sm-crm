import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  listActivePlans,
  getWorkspaceSubscription,
  getEffectivePlanId,
  getWorkspaceSeats,
  startCheckout,
  changeSeats,
  openBillingPortal,
  type BillingInterval,
  type BillingPlan,
} from '@/services/billing';
import { isInternalPlan, resolveCurrentPlanId, isPlanVisible, canUpgradeTo } from './plan-display';
import { computeSeatCost, clampSeats } from './seat-pricing';
import './cobranca.css';

const RECOMMENDED_ID = 'agency';

/** plans.price_brl is stored in centavos (e.g. 9990 = R$ 99,90). */
function formatBRL(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function planFeatures(p: BillingPlan): string[] {
  const out: string[] = ['Tudo incluído'];
  out.push(
    p.max_clients == null
      ? 'Clientes ilimitados'
      : `${p.max_clients} ${p.max_clients === 1 ? 'cliente' : 'clientes'}`,
  );
  const seats = p.included_seats;
  out.push(
    seats == null
      ? 'Usuários ilimitados'
      : `${seats} ${seats === 1 ? 'usuário incluído' : 'usuários incluídos'}`,
  );
  const addon = p.seat_addon_brl;
  if (addon != null && addon > 0) out.push(`+${formatBRL(addon)}/usuário extra`);
  return out;
}

export default function CobrancaPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const [promo, setPromo] = useState('');
  // Per-plan selected TOTAL seats on the upgrade cards (keyed by plan id).
  const [seatSel, setSeatSel] = useState<Record<string, number>>({});
  // Selected TOTAL seats on the active-subscription control. null = default to current.
  const [activeSeats, setActiveSeats] = useState<number | null>(null);

  const isOwner = role === 'owner';
  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: listActivePlans,
    enabled: isOwner,
  });
  const { data: subscription, refetch: refetchSub } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: getWorkspaceSubscription,
    enabled: isOwner,
  });
  // Source of truth for the workspace's plan, incl. comp overrides (e.g. Lifetime)
  // that have no Stripe subscription and would otherwise read as Free.
  const { data: effectivePlanId, refetch: refetchEffectivePlan } = useQuery({
    queryKey: ['billing', 'effective-plan'],
    queryFn: getEffectivePlanId,
    enabled: isOwner,
  });

  // Server-computed seat block (included/purchased/effective/used) — the floor for
  // the in-app remove path and the backing for the active-subscriber control.
  const { data: seats } = useQuery({
    queryKey: ['workspace-limits', 'seats'],
    queryFn: getWorkspaceSeats,
    enabled: isOwner,
  });

  // Handle the Checkout return once on mount (see git history for why deps are empty).
  useEffect(() => {
    const status = searchParams.get('status');
    if (!status) return;
    if (status === 'success') {
      toast.success('Pagamento confirmado! Atualizando seu plano…');
      let tries = 0;
      const id = window.setInterval(() => {
        tries += 1;
        refetchSub();
        refetchEffectivePlan();
        if (tries >= 5) window.clearInterval(id);
      }, 2000);
      setSearchParams({}, { replace: true });
      return () => window.clearInterval(id);
    }
    toast('Checkout cancelado.');
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const annualSavingsPct = useMemo(() => {
    let best = 0;
    for (const p of plans ?? []) {
      if (p.price_brl && p.price_brl_annual) {
        const pct = Math.round((1 - p.price_brl_annual / (p.price_brl * 12)) * 100);
        if (pct > best) best = pct;
      }
    }
    return best;
  }, [plans]);

  if (!isOwner) {
    return (
      <div className="page-content" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="header">
          <div className="header-title">
            <h1>Plano &amp; Cobrança</h1>
          </div>
        </div>
        <div className="card">
          <p style={{ color: 'var(--text-muted)' }}>
            Apenas o proprietário da conta pode gerenciar a assinatura.
          </p>
        </div>
      </div>
    );
  }

  const hasActiveSub = subscription?.status === 'active' || subscription?.status === 'trialing';
  const currentPlanId = resolveCurrentPlanId(effectivePlanId, subscription?.plan_id);
  const currentPlan = plans?.find((p) => p.id === currentPlanId);
  const visiblePlans = (plans ?? []).filter((p) => isPlanVisible(p.id, currentPlanId));

  function seatsFor(p: BillingPlan): number {
    const floor = p.included_seats ?? 0;
    return seatSel[p.id] ?? floor;
  }

  function adjustSeats(p: BillingPlan, delta: number) {
    setSeatSel((prev) => {
      const current = prev[p.id] ?? p.included_seats ?? 0;
      // At checkout there is no existing sub, so the currentSeats floor is 0;
      // clampSeats keeps the value at or above the included base.
      const next = clampSeats(current + delta, p.included_seats, 0);
      return { ...prev, [p.id]: next };
    });
  }

  async function handleUpgrade(planId: string) {
    const plan = plans?.find((p) => p.id === planId);
    const extraSeats = plan ? Math.max(0, seatsFor(plan) - (plan.included_seats ?? 0)) : 0;
    setBusy(planId);
    try {
      const url = await startCheckout(planId, interval, promo.trim() || undefined, extraSeats);
      window.location.assign(url);
    } catch (err) {
      toast.error('Erro ao iniciar checkout: ' + (err as Error).message);
      setBusy(null);
    }
  }

  // Active-subscriber TOTAL seats. effective = included + purchased; default the
  // stepper to that, with the remove-floor at max(included, used) so you can never
  // drop below seats already in use.
  const includedSeats = seats?.included ?? null;
  const totalSeats = seats?.effective ?? (seats ? (seats.included ?? 0) + seats.purchased : 0);
  const seatFloor = Math.max(includedSeats ?? 0, seats?.used ?? 0);
  const selectedActiveSeats = activeSeats ?? totalSeats;

  function adjustActiveSeats(delta: number) {
    setActiveSeats((prev) => {
      const current = prev ?? totalSeats;
      // floor = max(included, used): never below what's already in use.
      return clampSeats(current + delta, includedSeats, seats?.used ?? 0);
    });
  }

  async function handleSeatChange() {
    const extra = Math.max(0, selectedActiveSeats - (includedSeats ?? 0));
    const delta = selectedActiveSeats - totalSeats;
    if (delta === 0) return;
    const verb = delta > 0 ? 'adicionar' : 'remover';
    const ok = window.confirm(
      `Você vai ${verb} ${Math.abs(delta)} assento(s). O valor será ajustado proporcionalmente (pró-rata) no seu próximo ciclo. Confirmar?`,
    );
    if (!ok) return;
    setBusy('seats');
    try {
      await changeSeats(extra);
      await queryClient.invalidateQueries({ queryKey: ['workspace-limits'] });
      setActiveSeats(null);
      toast.success('Assentos atualizados.');
    } catch (err) {
      toast.error('Erro ao atualizar assentos: ' + (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleManage() {
    setBusy('portal');
    try {
      const url = await openBillingPortal();
      window.location.assign(url);
    } catch (err) {
      toast.error('Erro ao abrir portal: ' + (err as Error).message);
      setBusy(null);
    }
  }

  function renderCta(p: BillingPlan) {
    if (p.id === currentPlanId) {
      return <span className="plan-cta__static">Plano atual</span>;
    }
    if (canUpgradeTo(p.id, currentPlanId, hasActiveSub)) {
      return (
        <button
          className="btn-primary"
          onClick={() => handleUpgrade(p.id)}
          disabled={busy === p.id}
        >
          {busy === p.id ? 'Aguarde…' : 'Fazer upgrade'}
        </button>
      );
    }
    return null;
  }

  return (
    <div className="page-content" style={{ maxWidth: 1040, margin: '0 auto' }}>
      <div className="header">
        <div className="header-title">
          <h1>Plano &amp; Cobrança</h1>
        </div>
      </div>

      {hasActiveSub && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="billing-current">
            <div>
              <span className="billing-current__label">Seu plano</span>
              <div className="billing-current__plan">
                <span className="billing-current__name">{currentPlan?.name ?? currentPlanId}</span>
                <span
                  className={`badge ${subscription?.status === 'past_due' ? 'badge-warning' : 'badge-success'}`}
                >
                  {subscription?.status === 'trialing'
                    ? 'Teste'
                    : subscription?.status === 'past_due'
                      ? 'Pagamento pendente'
                      : 'Ativo'}
                </span>
              </div>
              {subscription?.current_period_end && (
                <div className="billing-current__meta">
                  {subscription.cancel_at_period_end ? 'Cancela em ' : 'Renova em '}
                  {formatDate(subscription.current_period_end)}
                </div>
              )}
            </div>
            <button className="btn-secondary" onClick={handleManage} disabled={busy === 'portal'}>
              <i className="ph ph-gear-six" aria-hidden="true" />
              {busy === 'portal' ? 'Aguarde…' : 'Gerenciar assinatura'}
            </button>
          </div>

          {seats != null && (
            <div className="seat-selector" data-testid="active-seat-selector">
              <span className="seat-selector__label">
                Usuários ({seats.used} em uso)
              </span>
              <div className="seat-selector__control">
                <button
                  type="button"
                  className="seat-selector__btn"
                  aria-label="Remover assento"
                  onClick={() => adjustActiveSeats(-1)}
                  disabled={selectedActiveSeats <= seatFloor || busy === 'seats'}
                >
                  <i className="ph ph-minus" aria-hidden="true" />
                </button>
                <span
                  className="seat-selector__readout"
                  data-testid="active-seat-count"
                  aria-live="polite"
                >
                  {selectedActiveSeats}
                </span>
                <button
                  type="button"
                  className="seat-selector__btn"
                  aria-label="Adicionar assento"
                  onClick={() => adjustActiveSeats(1)}
                  disabled={busy === 'seats'}
                >
                  <i className="ph ph-plus" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleSeatChange}
                  disabled={busy === 'seats' || selectedActiveSeats === totalSeats}
                >
                  {busy === 'seats' ? 'Aguarde…' : 'Atualizar assentos'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="billing-toolbar">
        <div className="billing-toggle" role="group" aria-label="Período de cobrança">
          <button aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>
            Mensal
          </button>
          <button aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>
            Anual
          </button>
        </div>
        {annualSavingsPct > 0 && (
          <span className="billing-save-hint">
            <i className="ph ph-tag" aria-hidden="true" />
            Economize até {annualSavingsPct}% no anual
          </span>
        )}
        <div className="billing-promo">
          <label htmlFor="promo-code">Tem um código promocional?</label>
          <input
            id="promo-code"
            type="text"
            value={promo}
            onChange={(e) => setPromo(e.target.value)}
            placeholder="Código"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="plan-grid">
        {plansLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="plan-card plan-skeleton"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="sk" style={{ height: 18, width: '40%' }} />
                <div className="sk" style={{ height: 30, width: '55%', marginTop: 8 }} />
                <div className="sk" style={{ height: 12, width: '85%', marginTop: 16 }} />
                <div className="sk" style={{ height: 12, width: '70%', marginTop: 8 }} />
                <div className="sk" style={{ height: 12, width: '78%', marginTop: 8 }} />
                <div className="sk" style={{ height: 38, width: '100%', marginTop: 'auto' }} />
              </div>
            ))
          : visiblePlans.map((p, i) => {
              const isYear = interval === 'year';
              const monthly =
                isYear && p.price_brl_annual != null ? p.price_brl_annual / 12 : p.price_brl;
              const isCurrent = p.id === currentPlanId;
              const isReco = p.id === RECOMMENDED_ID && !isCurrent;
              const isInternal = isInternalPlan(p.id);
              return (
                <div
                  key={p.id}
                  className={`plan-card${isCurrent ? ' is-current' : ''}${isReco ? ' is-recommended' : ''}${isInternal ? ' is-lifetime' : ''}`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="plan-card__top">
                    <span className="plan-name">{p.name}</span>
                    {isCurrent ? (
                      <span className="plan-tag plan-tag--current">
                        {isInternal && <i className="ph ph-crown-simple" aria-hidden="true" />}
                        Plano atual
                      </span>
                    ) : isReco ? (
                      <span className="plan-tag plan-tag--reco">Recomendado</span>
                    ) : null}
                  </div>

                  <div>
                    {!isInternal && isYear && monthly != null && monthly > 0 && (
                      <div className="plan-annual-lead">em 12x de</div>
                    )}
                    <div className="plan-price">
                      {isInternal ? (
                        <span className="plan-price__note">Plano exclusivo</span>
                      ) : monthly != null && monthly > 0 ? (
                        <>
                          <span className="plan-price__amount">{formatBRL(monthly)}</span>
                          {!isYear && <span className="plan-price__period">/mês</span>}
                        </>
                      ) : (
                        <span className="plan-price__free">Grátis</span>
                      )}
                    </div>
                  </div>

                  <ul className="plan-features">
                    {planFeatures(p).map((f) => (
                      <li key={f}>
                        <i className="ph ph-check" aria-hidden="true" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {canUpgradeTo(p.id, currentPlanId, hasActiveSub) &&
                    (() => {
                      const selected = seatsFor(p);
                      const base =
                        isYear && p.price_brl_annual != null ? p.price_brl_annual : (p.price_brl ?? 0);
                      const cost = computeSeatCost({
                        basePriceCentavos: base,
                        includedSeats: p.included_seats,
                        selectedSeats: selected,
                        seatAddonCentavos: p.seat_addon_brl ?? 0,
                        interval,
                      });
                      return (
                        <>
                          <div className="seat-selector" data-testid="seat-selector">
                            <span className="seat-selector__label">Usuários</span>
                            <div className="seat-selector__control">
                              <button
                                type="button"
                                className="seat-selector__btn"
                                aria-label="Remover assento"
                                onClick={() => adjustSeats(p, -1)}
                                disabled={selected <= (p.included_seats ?? 0)}
                              >
                                <i className="ph ph-minus" aria-hidden="true" />
                              </button>
                              <span
                                className="seat-selector__readout"
                                data-testid="seat-count"
                                aria-live="polite"
                              >
                                {selected}
                              </span>
                              <button
                                type="button"
                                className="seat-selector__btn"
                                aria-label="Adicionar assento"
                                onClick={() => adjustSeats(p, 1)}
                              >
                                <i className="ph ph-plus" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                          <div className="plan-cost-breakdown">
                            <div className="plan-cost-breakdown__row">
                              <span>Base</span>
                              <span>{formatBRL(base)}</span>
                            </div>
                            {cost.extraSeats > 0 && (
                              <div className="plan-cost-breakdown__row">
                                <span>
                                  {cost.extraSeats}{' '}
                                  {cost.extraSeats === 1 ? 'usuário extra' : 'usuários extras'}{' '}
                                  × {formatBRL(p.seat_addon_brl ?? 0)}
                                </span>
                                <span data-testid="seat-extra-cost">
                                  {formatBRL(cost.extraCostCentavos)}
                                </span>
                              </div>
                            )}
                            <div className="plan-cost-breakdown__row plan-cost-breakdown__total">
                              <span>Total{isYear ? '/ano' : '/mês'}</span>
                              <span data-testid="plan-total-cost">
                                {formatBRL(cost.totalCentavos)}
                              </span>
                            </div>
                          </div>
                        </>
                      );
                    })()}

                  <div className="plan-cta">{renderCta(p)}</div>
                </div>
              );
            })}
      </div>
    </div>
  );
}

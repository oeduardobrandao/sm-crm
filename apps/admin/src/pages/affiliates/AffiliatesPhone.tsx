import { HandCoins, Percent } from 'lucide-react';
import { Cell, FormRow, GroupedList } from '@mesaas/ios-kit';
import { affiliateDetailPath } from '../../lib/routes';
import { formatMoney } from '../../lib/subscription';
import { formatRateBps, STRIPE_STATE_LABEL, stripeConnectState } from '../../lib/affiliates';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { AdminFormSheet } from '../../components/shell/AdminFormSheet';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Skeleton } from '../../components/ui/skeleton';
import { AffiliateAvatar } from './affiliate-view';
import { perReferralCents, summarizeRules } from './commission-rules';
import type { AffiliatesViewProps } from './AffiliatesDesktop';

const RULES_FORM_ID = 'commission-rules-form';

export function AffiliatesPhone({
  affiliates,
  rules,
  isLoading,
  isError,
  onRetry,
  totals,
  editor,
  rulesOpen,
  onRulesOpenChange,
}: AffiliatesViewProps) {
  const close = (open: boolean) => {
    if (!open) editor.discard();
    onRulesOpenChange(open);
  };

  return (
    <div>
      <PageHeader
        title="Afiliados"
        description={
          affiliates.length > 0
            ? `${affiliates.length} afiliados · ${formatMoney(totals.available)} disponível para repasse`
            : 'Programa de afiliados'
        }
      />

      {rules.length > 0 && (
        <GroupedList
          aria-label="Regras do programa"
          footer="Comissão sobre pagamentos Stripe, repasse mensal por Stripe Connect."
        >
          <Cell
            icon={<Percent />}
            iconColor="hsl(var(--primary))"
            label="Tabela de comissões"
            subtitle={summarizeRules(rules)}
            chevron
            onClick={() => onRulesOpenChange(true)}
          />
        </GroupedList>
      )}

      {isLoading ? (
        <GlassPanel>
          <div className="flex flex-col gap-3 pt-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-44" />
          </div>
        </GlassPanel>
      ) : isError ? (
        <GlassPanel flush>
          <ErrorState message="Não foi possível carregar os afiliados." onRetry={onRetry} />
        </GlassPanel>
      ) : affiliates.length === 0 ? (
        <GlassPanel flush>
          <EmptyState
            icon={HandCoins}
            title="Nenhum afiliado ainda"
            description="Os cadastros feitos em /afiliados aparecem aqui."
          />
        </GlassPanel>
      ) : (
        <GroupedList header="Por saldo disponível">
          {affiliates.map((a) => {
            const state = stripeConnectState(a);
            return (
              <Cell
                key={a.id}
                to={affiliateDetailPath(a.id)}
                icon={<AffiliateAvatar name={a.nome} size={30} />}
                label={a.nome}
                subtitle={
                  <>
                    <span className="block">
                      {a.summary.referrals_count} indicações · {a.summary.paying_count} assinantes
                    </span>
                    <span className="block">
                      {a.status === 'suspended' && (
                        <span
                          className="font-semibold"
                          style={{ color: 'var(--phone-destructive)' }}
                        >
                          Suspenso ·{' '}
                        </span>
                      )}
                      <span>{STRIPE_STATE_LABEL[state]}</span>
                    </span>
                  </>
                }
                value={formatMoney(a.summary.available_cents)}
              />
            );
          })}
        </GroupedList>
      )}

      <AdminFormSheet
        open={rulesOpen}
        onOpenChange={close}
        title="Comissões"
        description="Percentual sobre os primeiros meses pagos de cada indicado (cartão, Stripe). Mudanças valem para os próximos pagamentos."
        formId={RULES_FORM_ID}
        submitting={editor.isPending}
      >
        <form
          id={RULES_FORM_ID}
          onSubmit={(e) => {
            e.preventDefault();
            void editor.submitAll(rules).then((ok) => {
              if (ok) onRulesOpenChange(false);
            });
          }}
        >
          {rules.map((r) => {
            const v = editor.valueOf(r);
            const info = r.configured
              ? `${formatMoney(perReferralCents(r))} por indicado · ${formatRateBps(r.rate_bps)} × ${r.months} meses`
              : 'Sem comissão';
            return (
              <GroupedList
                key={r.plan_id}
                header={`${r.plan_name} · ${formatMoney(r.price_brl ?? 0)}/mês`}
                headerAs="h3"
                footer={editor.isDirty(r) ? `Não salvo · ${info}` : info}
              >
                <FormRow
                  label="Comissão"
                  input={{
                    'aria-label': `Comissão do plano ${r.plan_name}`,
                    inputMode: 'decimal',
                    value: v.rate,
                    onChange: (e) => editor.setField(r, 'rate', e.target.value),
                  }}
                />
                <FormRow
                  label="Meses"
                  input={{
                    'aria-label': `Meses do plano ${r.plan_name}`,
                    inputMode: 'numeric',
                    value: v.months,
                    onChange: (e) => editor.setField(r, 'months', e.target.value),
                  }}
                />
              </GroupedList>
            );
          })}
        </form>
      </AdminFormSheet>
    </div>
  );
}

import { Plus } from 'lucide-react';
import { Cell, GroupedList, PhoneIconButton } from '@mesaas/ios-kit';
import type { Plan } from '../../lib/api';
import { getPlanColor } from '../../lib/plan-colors';
import { PageHeader } from '../../components/PageHeader';
import { Badge } from '../../components/ui/badge';
import {
  featureSummary,
  planLimits,
  planPrice,
  plansSummary,
  workspaceCountLabel,
} from './plan-summary';

interface PlansPhoneProps {
  plans: Plan[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (plan: Plan) => void;
}

export function PlansPhone({ plans, isLoading, onCreate, onEdit }: PlansPhoneProps) {
  return (
    <div>
      <PageHeader
        title="Planos"
        description={isLoading ? undefined : plansSummary(plans)}
        phoneActions={
          <PhoneIconButton label="Novo plano" variant="ink" onClick={onCreate}>
            <Plus aria-hidden="true" />
          </PhoneIconButton>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum plano cadastrado.</p>
      ) : (
        <GroupedList aria-label="Planos">
          {plans.map((plan) => {
            const price = planPrice(plan);
            return (
              <Cell
                key={plan.id}
                label={
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {plan.name}
                    {plan.is_default && (
                      <Badge variant="success" size="sm">
                        PADRÃO
                      </Badge>
                    )}
                    {plan.pagarme_12x_enabled && (
                      <Badge variant="info" size="sm">
                        12X
                      </Badge>
                    )}
                    {!plan.is_active && (
                      <Badge variant="danger" size="sm">
                        INATIVO
                      </Badge>
                    )}
                  </span>
                }
                subtitle={
                  <span className="block whitespace-normal">
                    <span className="block">
                      {price.main}
                      {price.suffix} · {workspaceCountLabel(plan.workspace_count)}
                    </span>
                    <span className="block">
                      {planLimits(plan).join(' · ')} · {featureSummary(plan)}
                    </span>
                  </span>
                }
                icon={<span className="block size-2.5 rounded-full bg-white" />}
                iconColor={getPlanColor(plan.name)}
                onClick={() => onEdit(plan)}
                chevron
              />
            );
          })}
        </GroupedList>
      )}
    </div>
  );
}

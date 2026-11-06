import { Check, Plus } from 'lucide-react';
import type { Plan } from '../../lib/api';
import { FEATURE_FLAG_KEYS } from '../../lib/api';
import { getPlanColor } from '../../lib/plan-colors';
import { PageHeader } from '../../components/PageHeader';
import { RowButton } from '../../components/RowLink';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import {
  enabledFeatureCount,
  featureSummary,
  planLimits,
  planPrice,
  plansSummary,
  workspaceCountLabel,
} from './plan-summary';

interface PlansDesktopProps {
  plans: Plan[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (plan: Plan) => void;
}

export function PlansDesktop({ plans, isLoading, onCreate, onEdit }: PlansDesktopProps) {
  return (
    <div>
      <PageHeader
        title="Planos"
        description={isLoading ? 'Gerencie os planos' : plansSummary(plans)}
        actions={
          <Button onClick={onCreate}>
            <Plus aria-hidden="true" /> Novo plano
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-muted-foreground">Carregando…</p>
      ) : plans.length === 0 ? (
        <p className="text-muted-foreground">Nenhum plano cadastrado.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, onEdit }: { plan: Plan; onEdit: (p: Plan) => void }) {
  const color = getPlanColor(plan.name);
  const price = planPrice(plan);
  const enabled = enabledFeatureCount(plan);
  const percent = Math.round((enabled / FEATURE_FLAG_KEYS.length) * 100);

  return (
    <Card className="relative flex flex-col gap-4 p-5 transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary/50">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <RowButton
          onClick={() => onEdit(plan)}
          className="text-[17px] font-semibold after:absolute after:inset-0 after:rounded-[18px] after:content-['']"
        >
          {plan.name}
        </RowButton>
        {plan.is_default && <Badge variant="success">PADRÃO</Badge>}
        {plan.pagarme_12x_enabled && <Badge variant="info">12X</Badge>}
        {!plan.is_active && <Badge variant="danger">INATIVO</Badge>}
      </div>

      <p className="text-muted-foreground">
        <span className="font-sf text-[28px] font-bold leading-none text-foreground">
          {price.main}
        </span>
        {price.suffix && <span className="ml-1 text-sm">{price.suffix}</span>}
      </p>

      <ul className="flex flex-col gap-1.5 text-sm">
        {planLimits(plan).map((limit) => (
          <li key={limit} className="flex items-center gap-2">
            <Check size={14} className="shrink-0 text-success" aria-hidden="true" />
            {limit}
          </li>
        ))}
      </ul>

      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">{featureSummary(plan)}</p>
        <div
          role="progressbar"
          aria-label="Funcionalidades ativas"
          aria-valuemin={0}
          aria-valuemax={FEATURE_FLAG_KEYS.length}
          aria-valuenow={enabled}
          className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${percent}%`, backgroundColor: color }}
          />
        </div>
      </div>

      <p className="mt-auto border-t border-border pt-3 text-sm text-muted-foreground">
        {workspaceCountLabel(plan.workspace_count)}
      </p>
    </Card>
  );
}

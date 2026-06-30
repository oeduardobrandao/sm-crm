import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  type Plan,
  RESOURCE_LIMIT_KEYS,
  RESOURCE_LIMIT_LABELS,
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_LABELS,
  RATE_LIMIT_KEYS,
  RATE_LIMIT_LABELS,
} from '../lib/api';
import { getPlanColor } from '../lib/plan-colors';
import {
  type FormState,
  emptyFormState,
  planToForm,
  formToPayload,
  parseIntInput,
} from './plan-form';

export default function PlansPage() {
  const queryClient = useQueryClient();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyFormState);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const createMutation = useMutation({
    mutationFn: () => createPlan(formToPayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      toast.success('Plan created');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => updatePlan({ plan_id: editingPlan!.id, ...formToPayload(form) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      toast.success('Plan updated');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (planId: string) => deletePlan(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      toast.success('Plan deleted');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingPlan(null);
    setForm(emptyFormState());
    setShowForm(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setForm(planToForm(plan));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingPlan(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPlan) updateMutation.mutate();
    else createMutation.mutate();
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h1 className="font-sf text-2xl font-bold mb-1">Plans</h1>
          <p className="text-sm text-muted-foreground">Manage plan templates</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors"
        >
          <Plus size={16} /> New Plan
        </button>
      </div>

      {isLoading ? (
        <p className="text-dim-foreground">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(data?.plans || []).map((plan) => (
            <PlanCard key={plan.id} plan={plan} onEdit={openEdit} />
          ))}
        </div>
      )}

      {showForm && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={closeForm}
        >
          <div
            className="bg-card border border-border rounded-2xl p-5 md:p-8 w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4 md:mx-0"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-sf text-lg font-bold mb-6">
              {editingPlan ? `Edit: ${editingPlan.name}` : 'New Plan'}
            </h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex items-end gap-4">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={form.is_default}
                      onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
                      className="rounded"
                    />
                    Default
                  </label>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                      className="rounded"
                    />
                    Active
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Monthly price (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.price_brl_input}
                    onChange={(e) => setForm((f) => ({ ...f, price_brl_input: e.target.value }))}
                    placeholder="99.90"
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Annual price (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.price_brl_annual_input}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, price_brl_annual_input: e.target.value }))
                    }
                    placeholder="959.00"
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Sort order
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={form.sort_order ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, sort_order: parseIntInput(e.target.value) }))
                    }
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Stripe Product ID
                  </label>
                  <input
                    type="text"
                    value={form.stripe_product_id}
                    onChange={(e) => setForm((f) => ({ ...f, stripe_product_id: e.target.value }))}
                    placeholder="prod_..."
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Stripe Price ID (monthly)
                  </label>
                  <input
                    type="text"
                    value={form.stripe_price_id}
                    onChange={(e) => setForm((f) => ({ ...f, stripe_price_id: e.target.value }))}
                    placeholder="price_..."
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Stripe Price ID (annual)
                  </label>
                  <input
                    type="text"
                    value={form.stripe_price_id_annual}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, stripe_price_id_annual: e.target.value }))
                    }
                    placeholder="price_..."
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <NumberFieldGroup
                title="Resource Limits"
                keys={RESOURCE_LIMIT_KEYS as unknown as string[]}
                labels={RESOURCE_LIMIT_LABELS}
                values={form.resources}
                onChange={(key, val: number | null) =>
                  setForm((f) => ({ ...f, resources: { ...f.resources, [key]: val } }))
                }
              />

              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Feature Flags
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {FEATURE_FLAG_KEYS.map((key) => (
                    <div
                      key={key}
                      className="flex justify-between items-center bg-secondary/50 rounded-lg px-3 py-1.5"
                    >
                      <span className="text-xs text-muted-foreground">
                        {FEATURE_FLAG_LABELS[key]}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            features: { ...f.features, [key]: !f.features[key] },
                          }))
                        }
                        className={`text-xs font-medium ${form.features[key] ? 'text-success' : 'text-destructive'}`}
                      >
                        {form.features[key] ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <NumberFieldGroup
                title="Rate Limits"
                keys={RATE_LIMIT_KEYS as unknown as string[]}
                labels={RATE_LIMIT_LABELS}
                values={form.rates}
                onChange={(key, val: number | null) =>
                  setForm((f) => ({ ...f, rates: { ...f.rates, [key]: val } }))
                }
              />

              <div className="flex gap-3 mt-2">
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
                >
                  {editingPlan ? 'Update' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:border-primary transition-colors"
                >
                  Cancel
                </button>
                {editingPlan && editingPlan.workspace_count === 0 && (
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(editingPlan.id)}
                    disabled={deleteMutation.isPending}
                    className="px-4 py-2.5 rounded-lg border border-destructive/30 text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, onEdit }: { plan: Plan; onEdit: (p: Plan) => void }) {
  const enabledFeatures = FEATURE_FLAG_KEYS.filter((k) => plan[k]);

  return (
    <div
      className="bg-card border border-border rounded-2xl p-6 relative border-l-[3px]"
      style={{ borderLeftColor: getPlanColor(plan.name) }}
    >
      <div className="flex justify-between items-center mb-4">
        <span className="text-lg font-bold" style={{ color: getPlanColor(plan.name) }}>
          {plan.name}
        </span>
        <div className="flex items-center gap-2">
          {plan.is_default && (
            <span className="text-[0.65rem] font-semibold uppercase px-2 py-0.5 rounded-sm bg-success/15 text-success">
              DEFAULT
            </span>
          )}
          {!plan.is_active && (
            <span className="text-[0.65rem] font-semibold uppercase px-2 py-0.5 rounded-sm bg-destructive/15 text-destructive">
              INACTIVE
            </span>
          )}
          <button
            onClick={() => onEdit(plan)}
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            <Pencil size={14} />
          </button>
        </div>
      </div>

      {plan.price_brl != null && (
        <p className="text-sm text-muted-foreground mb-3">
          R$ {(plan.price_brl / 100).toFixed(2)}/mo
          {plan.price_brl_annual != null && (
            <span className="text-dim-foreground">
              {' '}
              · R$ {(plan.price_brl_annual / 100).toFixed(2)}/yr
            </span>
          )}
        </p>
      )}

      <p className="text-[0.75rem] text-muted-foreground uppercase tracking-wider mb-2">
        Key Limits
      </p>
      <div className="flex flex-col gap-0.5 mb-3 text-sm text-muted-foreground">
        <div>
          Clients: <span className="text-foreground font-sf">{plan.max_clients ?? '∞'}</span>
        </div>
        <div>
          Members: <span className="text-foreground font-sf">{plan.max_team_members ?? '∞'}</span>
        </div>
        <div>
          Instagram:{' '}
          <span className="text-foreground font-sf">{plan.max_instagram_accounts ?? '∞'}</span>
        </div>
        <div>
          Storage:{' '}
          <span className="text-foreground font-sf">
            {plan.storage_quota_bytes != null
              ? `${Math.round(plan.storage_quota_bytes / 1048576)} MB`
              : '∞'}
          </span>
        </div>
      </div>

      <p className="text-[0.75rem] text-muted-foreground uppercase tracking-wider mb-2">
        Features ({enabledFeatures.length}/{FEATURE_FLAG_KEYS.length})
      </p>
      <div className="flex flex-wrap gap-1 mb-4">
        {enabledFeatures.map((k) => (
          <span key={k} className="text-[0.6rem] px-1.5 py-0.5 rounded bg-success/10 text-success">
            {FEATURE_FLAG_LABELS[k]}
          </span>
        ))}
        {enabledFeatures.length === 0 && (
          <span className="text-[0.65rem] text-dim-foreground">None</span>
        )}
      </div>

      <div className="pt-3 border-t border-border text-dim-foreground text-sm">
        {plan.workspace_count} workspaces
      </div>
    </div>
  );
}

function NumberFieldGroup({
  title,
  keys,
  labels,
  values,
  onChange,
}: {
  title: string;
  keys: string[];
  labels: Record<string, string>;
  values: Record<string, number | null>;
  onChange: (key: string, val: number | null) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {title}
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {keys.map((key) => (
          <div key={key}>
            <label className="block text-xs text-dim-foreground mb-1">{labels[key]}</label>
            <input
              type="number"
              value={values[key] ?? ''}
              placeholder="∞"
              onChange={(e) => {
                const v = e.target.value;
                onChange(key, v === '' ? null : parseInt(v, 10));
              }}
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  listPlans, createPlan, updatePlan, deletePlan,
  type Plan,
  RESOURCE_LIMIT_KEYS, RESOURCE_LIMIT_LABELS,
  FEATURE_FLAG_KEYS, FEATURE_FLAG_LABELS,
  RATE_LIMIT_KEYS, RATE_LIMIT_LABELS,
} from '../lib/api';

const DEFAULT_RESOURCES: Record<string, number> = {
  max_clients: 5, max_team_members: 3, max_instagram_accounts: 1,
  storage_quota_bytes: 524288000, max_leads: 100, max_hub_tokens: 3,
  max_workflow_templates: 5, max_active_workflows_per_client: 3,
  max_custom_properties_per_template: 5, max_posts_per_workflow: 20,
  max_workspaces_per_user: 1,
};

const DEFAULT_FEATURES: Record<string, boolean> = Object.fromEntries(
  FEATURE_FLAG_KEYS.map((k) => [k, false])
);

const DEFAULT_RATES: Record<string, number> = {
  rate_instagram_syncs_per_day: 5,
  rate_ai_analyses_per_month: 10,
  rate_report_generations_per_month: 10,
};

interface FormState {
  name: string;
  resources: Record<string, number | null>;
  features: Record<string, boolean>;
  rates: Record<string, number | null>;
  is_default: boolean;
  is_active: boolean;
}

function planToForm(plan: Plan): FormState {
  const resources: Record<string, number | null> = {};
  for (const k of RESOURCE_LIMIT_KEYS) resources[k] = (plan[k] as number | null);
  const features: Record<string, boolean> = {};
  for (const k of FEATURE_FLAG_KEYS) features[k] = (plan[k] as boolean) ?? false;
  const rates: Record<string, number | null> = {};
  for (const k of RATE_LIMIT_KEYS) rates[k] = (plan[k] as number | null);
  return { name: plan.name, resources, features, rates, is_default: plan.is_default, is_active: plan.is_active };
}

function formToPayload(form: FormState): Record<string, unknown> {
  return { name: form.name, is_default: form.is_default, is_active: form.is_active, ...form.resources, ...form.features, ...form.rates };
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: '', resources: { ...DEFAULT_RESOURCES }, features: { ...DEFAULT_FEATURES },
    rates: { ...DEFAULT_RATES }, is_default: false, is_active: true,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const createMutation = useMutation({
    mutationFn: () => createPlan(formToPayload(form)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] }); toast.success('Plan created'); closeForm(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => updatePlan({ plan_id: editingPlan!.id, ...formToPayload(form) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] }); toast.success('Plan updated'); closeForm(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (planId: string) => deletePlan(planId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] }); toast.success('Plan deleted'); closeForm(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingPlan(null);
    setForm({ name: '', resources: { ...DEFAULT_RESOURCES }, features: { ...DEFAULT_FEATURES }, rates: { ...DEFAULT_RATES }, is_default: false, is_active: true });
    setShowForm(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setForm(planToForm(plan));
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditingPlan(null); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPlan) updateMutation.mutate(); else createMutation.mutate();
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h1 className="font-['Playfair_Display'] text-2xl font-bold mb-1">Plans</h1>
          <p className="text-sm text-[#9ca3af]">Manage plan templates</p>
        </div>
        <button onClick={openCreate} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors">
          <Plus size={16} /> New Plan
        </button>
      </div>

      {isLoading ? (
        <p className="text-[#4b5563]">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(data?.plans || []).map((plan) => (
            <PlanCard key={plan.id} plan={plan} onEdit={openEdit} />
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeForm}>
          <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5 md:p-8 w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4 md:mx-0" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-['Playfair_Display'] text-lg font-bold mb-6">
              {editingPlan ? `Edit: ${editingPlan.name}` : 'New Plan'}
            </h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#9ca3af] uppercase tracking-wider mb-1.5">Name</label>
                  <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required
                    className="w-full px-3 py-2 rounded-lg bg-[#1e2430] border border-transparent text-sm font-['DM_Mono'] text-[#e8eaf0] focus:outline-none focus:border-[#eab308]" />
                </div>
                <div className="flex items-end gap-4">
                  <label className="flex items-center gap-2 text-sm text-[#9ca3af]">
                    <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} className="rounded" />
                    Default
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[#9ca3af]">
                    <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="rounded" />
                    Active
                  </label>
                </div>
              </div>

              <NumberFieldGroup
                title="Resource Limits"
                keys={RESOURCE_LIMIT_KEYS as unknown as string[]}
                labels={RESOURCE_LIMIT_LABELS}
                values={form.resources}
                onChange={(key, val: number | null) => setForm((f) => ({ ...f, resources: { ...f.resources, [key]: val } }))}
              />

              <div>
                <label className="block text-xs font-medium text-[#9ca3af] uppercase tracking-wider mb-2">Feature Flags</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {FEATURE_FLAG_KEYS.map((key) => (
                    <div key={key} className="flex justify-between items-center bg-[#1e2430]/50 rounded-lg px-3 py-1.5">
                      <span className="text-xs text-[#9ca3af]">{FEATURE_FLAG_LABELS[key]}</span>
                      <button type="button"
                        onClick={() => setForm((f) => ({ ...f, features: { ...f.features, [key]: !f.features[key] } }))}
                        className={`text-xs font-medium ${form.features[key] ? 'text-[#3ecf8e]' : 'text-[#f55a42]'}`}>
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
                onChange={(key, val: number | null) => setForm((f) => ({ ...f, rates: { ...f.rates, [key]: val } }))}
              />

              <div className="flex gap-3 mt-2">
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors disabled:opacity-50">
                  {editingPlan ? 'Update' : 'Create'}
                </button>
                <button type="button" onClick={closeForm}
                  className="px-4 py-2.5 rounded-lg border border-[#1e2430] text-sm text-[#9ca3af] hover:border-[#eab308] transition-colors">
                  Cancel
                </button>
                {editingPlan && editingPlan.workspace_count === 0 && (
                  <button type="button" onClick={() => deleteMutation.mutate(editingPlan.id)} disabled={deleteMutation.isPending}
                    className="px-4 py-2.5 rounded-lg border border-[#f55a42]/30 text-sm text-[#f55a42] hover:bg-[#f55a42]/10 transition-colors disabled:opacity-50">
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
    <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-6 relative">
      <div className="flex justify-between items-center mb-4">
        <span className="text-lg font-bold">{plan.name}</span>
        <div className="flex items-center gap-2">
          {plan.is_default && (
            <span className="text-[0.65rem] font-semibold uppercase px-2 py-0.5 rounded-sm bg-[#3ecf8e]/15 text-[#3ecf8e]">DEFAULT</span>
          )}
          {!plan.is_active && (
            <span className="text-[0.65rem] font-semibold uppercase px-2 py-0.5 rounded-sm bg-[#f55a42]/15 text-[#f55a42]">INACTIVE</span>
          )}
          <button onClick={() => onEdit(plan)} className="text-[#9ca3af] hover:text-[#eab308] transition-colors">
            <Pencil size={14} />
          </button>
        </div>
      </div>

      {plan.price_brl != null && (
        <p className="text-sm text-[#9ca3af] mb-3">
          R$ {(plan.price_brl / 100).toFixed(2)}/mo
          {plan.price_brl_annual != null && <span className="text-[#4b5563]"> · R$ {(plan.price_brl_annual / 100).toFixed(2)}/yr</span>}
        </p>
      )}

      <p className="text-[0.75rem] text-[#9ca3af] uppercase tracking-wider mb-2">Key Limits</p>
      <div className="flex flex-col gap-0.5 mb-3 text-sm text-[#9ca3af]">
        <div>Clients: <span className="text-[#e8eaf0] font-['DM_Mono']">{plan.max_clients ?? '∞'}</span></div>
        <div>Members: <span className="text-[#e8eaf0] font-['DM_Mono']">{plan.max_team_members ?? '∞'}</span></div>
        <div>Instagram: <span className="text-[#e8eaf0] font-['DM_Mono']">{plan.max_instagram_accounts ?? '∞'}</span></div>
        <div>Storage: <span className="text-[#e8eaf0] font-['DM_Mono']">{plan.storage_quota_bytes != null ? `${Math.round(plan.storage_quota_bytes / 1048576)} MB` : '∞'}</span></div>
      </div>

      <p className="text-[0.75rem] text-[#9ca3af] uppercase tracking-wider mb-2">Features ({enabledFeatures.length}/{FEATURE_FLAG_KEYS.length})</p>
      <div className="flex flex-wrap gap-1 mb-4">
        {enabledFeatures.map((k) => (
          <span key={k} className="text-[0.6rem] px-1.5 py-0.5 rounded bg-[#3ecf8e]/10 text-[#3ecf8e]">
            {FEATURE_FLAG_LABELS[k]}
          </span>
        ))}
        {enabledFeatures.length === 0 && <span className="text-[0.65rem] text-[#4b5563]">None</span>}
      </div>

      <div className="pt-3 border-t border-[#1e2430] text-[#4b5563] text-sm">
        {plan.workspace_count} workspaces
      </div>
    </div>
  );
}

function NumberFieldGroup({ title, keys, labels, values, onChange }: {
  title: string;
  keys: string[];
  labels: Record<string, string>;
  values: Record<string, number | null>;
  onChange: (key: string, val: number | null) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[#9ca3af] uppercase tracking-wider mb-2">{title}</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {keys.map((key) => (
          <div key={key}>
            <label className="block text-xs text-[#4b5563] mb-1">{labels[key]}</label>
            <input type="number" value={values[key] ?? ''}
              placeholder="∞"
              onChange={(e) => {
                const v = e.target.value;
                onChange(key, v === '' ? null : parseInt(v, 10));
              }}
              className="w-full px-3 py-2 rounded-lg bg-[#1e2430] border border-transparent text-sm font-['DM_Mono'] text-[#e8eaf0] placeholder-[#4b5563] focus:outline-none focus:border-[#eab308]" />
          </div>
        ))}
      </div>
    </div>
  );
}

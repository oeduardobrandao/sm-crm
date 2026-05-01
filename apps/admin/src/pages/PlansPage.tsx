import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { listPlans, createPlan, updatePlan, deletePlan, type Plan } from '../lib/api';

const RESOURCE_LABELS: Record<string, string> = {
  max_clients: 'Clients',
  max_members: 'Members',
  max_instagram_accounts: 'Instagram',
  max_storage_mb: 'Storage (MB)',
};

const FEATURE_LABELS: Record<string, string> = {
  analytics: 'Analytics',
  post_express: 'Post Express',
  briefing: 'Briefing',
  ideias: 'Ideias',
};

const DEFAULT_RESOURCES = { max_clients: 5, max_members: 3, max_instagram_accounts: 1, max_storage_mb: 500 };
const DEFAULT_FEATURES = { analytics: false, post_express: false, briefing: true, ideias: false };

interface FormState {
  name: string;
  resource_limits: Record<string, number>;
  feature_flags: Record<string, boolean>;
  is_default: boolean;
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: '',
    resource_limits: { ...DEFAULT_RESOURCES },
    feature_flags: { ...DEFAULT_FEATURES },
    is_default: false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const createMutation = useMutation({
    mutationFn: () => createPlan(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      toast.success('Plan created');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => updatePlan({ plan_id: editingPlan!.id, ...form }),
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
    setForm({ name: '', resource_limits: { ...DEFAULT_RESOURCES }, feature_flags: { ...DEFAULT_FEATURES }, is_default: false });
    setShowForm(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setForm({
      name: plan.name,
      resource_limits: { ...plan.resource_limits },
      feature_flags: { ...plan.feature_flags },
      is_default: plan.is_default,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingPlan(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPlan) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="font-['Playfair_Display'] text-2xl font-bold mb-1">Plans</h1>
          <p className="text-sm text-[#9ca3af]">Manage plan templates</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors"
        >
          <Plus size={16} /> New Plan
        </button>
      </div>

      {isLoading ? (
        <p className="text-[#4b5563]">Loading...</p>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {(data?.plans || []).map((plan) => (
            <div key={plan.id} className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-6 relative">
              <div className="flex justify-between items-center mb-4">
                <span className="text-lg font-bold">{plan.name}</span>
                <div className="flex items-center gap-2">
                  {plan.is_default && (
                    <span className="text-[0.65rem] font-semibold uppercase px-2 py-0.5 rounded-sm bg-[#3ecf8e]/15 text-[#3ecf8e]">
                      DEFAULT
                    </span>
                  )}
                  <button onClick={() => openEdit(plan)} className="text-[#9ca3af] hover:text-[#eab308] transition-colors">
                    <Pencil size={14} />
                  </button>
                </div>
              </div>

              <p className="text-[0.75rem] text-[#9ca3af] uppercase tracking-wider mb-2">Limits</p>
              <div className="flex flex-col gap-1 mb-4 text-sm text-[#9ca3af]">
                {Object.entries(RESOURCE_LABELS).map(([key, label]) => (
                  <div key={key}>
                    {label}: <span className="text-[#e8eaf0] font-['DM_Mono']">{plan.resource_limits[key] ?? '—'}</span>
                  </div>
                ))}
              </div>

              <p className="text-[0.75rem] text-[#9ca3af] uppercase tracking-wider mb-2">Features</p>
              <div className="flex flex-col gap-1 mb-4 text-sm text-[#9ca3af]">
                {Object.entries(FEATURE_LABELS).map(([key, label]) => (
                  <div key={key}>
                    {label}: <span className={plan.feature_flags[key] ? 'text-[#3ecf8e]' : 'text-[#f55a42]'}>
                      {plan.feature_flags[key] ? 'ON' : 'OFF'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-[#1e2430] text-[#4b5563] text-sm">
                {plan.workspace_count} workspaces
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeForm}>
          <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-8 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-['Playfair_Display'] text-lg font-bold mb-6">
              {editingPlan ? `Edit: ${editingPlan.name}` : 'New Plan'}
            </h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div>
                <label className="block text-xs font-medium text-[#9ca3af] uppercase tracking-wider mb-1.5">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-[#1e2430] border border-transparent text-sm font-['DM_Mono'] text-[#e8eaf0] focus:outline-none focus:border-[#eab308]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9ca3af] uppercase tracking-wider mb-2">Resource Limits</label>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(RESOURCE_LABELS).map(([key, label]) => (
                    <div key={key}>
                      <label className="block text-xs text-[#4b5563] mb-1">{label}</label>
                      <input
                        type="number"
                        value={form.resource_limits[key] ?? 0}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            resource_limits: { ...f.resource_limits, [key]: parseInt(e.target.value, 10) || 0 },
                          }))
                        }
                        className="w-full px-3 py-2 rounded-lg bg-[#1e2430] border border-transparent text-sm font-['DM_Mono'] text-[#e8eaf0] focus:outline-none focus:border-[#eab308]"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9ca3af] uppercase tracking-wider mb-2">Feature Flags</label>
                <div className="flex flex-col gap-2">
                  {Object.entries(FEATURE_LABELS).map(([key, label]) => (
                    <div key={key} className="flex justify-between items-center">
                      <span className="text-sm text-[#9ca3af]">{label}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            feature_flags: { ...f.feature_flags, [key]: !f.feature_flags[key] },
                          }))
                        }
                        className={`text-sm font-medium ${form.feature_flags[key] ? 'text-[#3ecf8e]' : 'text-[#f55a42]'}`}
                      >
                        {form.feature_flags[key] ? '● ON' : '● OFF'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_default"
                  checked={form.is_default}
                  onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="is_default" className="text-sm text-[#9ca3af]">Default plan for new workspaces</label>
              </div>

              <div className="flex gap-3 mt-2">
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors disabled:opacity-50"
                >
                  {editingPlan ? 'Update' : 'Create'}
                </button>
                <button type="button" onClick={closeForm} className="px-4 py-2.5 rounded-lg border border-[#1e2430] text-sm text-[#9ca3af] hover:border-[#eab308] transition-colors">
                  Cancel
                </button>
                {editingPlan && editingPlan.workspace_count === 0 && (
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(editingPlan.id)}
                    disabled={deleteMutation.isPending}
                    className="px-4 py-2.5 rounded-lg border border-[#f55a42]/30 text-sm text-[#f55a42] hover:bg-[#f55a42]/10 transition-colors disabled:opacity-50"
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

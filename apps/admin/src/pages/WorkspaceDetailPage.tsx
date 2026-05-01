import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import {
  getWorkspace, listPlans, setWorkspacePlan,
  setWorkspaceOverrides, clearWorkspaceOverrides,
} from '../lib/api';

const RESOURCE_LABELS: Record<string, string> = {
  max_clients: 'Max Clients',
  max_members: 'Max Members',
  max_instagram_accounts: 'Max Instagram',
  max_storage_mb: 'Storage (MB)',
};

const FEATURE_LABELS: Record<string, string> = {
  analytics: 'Analytics',
  post_express: 'Post Express',
  briefing: 'Briefing',
  ideias: 'Ideias',
};

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'workspace', id],
    queryFn: () => getWorkspace(id!),
    enabled: !!id,
  });

  const { data: plansData } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const [resourceEdits, setResourceEdits] = useState<Record<string, string>>({});
  const [featureEdits, setFeatureEdits] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');

  useEffect(() => {
    if (data) {
      setSelectedPlanId(data.plan?.id || '');
      setNotes(data.override?.notes || '');
      const rEdits: Record<string, string> = {};
      if (data.resolved_limits) {
        for (const [k, v] of Object.entries(data.resolved_limits)) {
          rEdits[k] = String(v);
        }
      }
      setResourceEdits(rEdits);

      const fEdits: Record<string, boolean> = {};
      if (data.resolved_features) {
        for (const [k, v] of Object.entries(data.resolved_features)) {
          fEdits[k] = v;
        }
      }
      setFeatureEdits(fEdits);
    }
  }, [data]);

  const setPlanMutation = useMutation({
    mutationFn: (planId: string) => setWorkspacePlan(id!, planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Plan updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveOverridesMutation = useMutation({
    mutationFn: () => {
      const plan = plansData?.plans?.find((p) => p.id === selectedPlanId);
      if (!plan) throw new Error('No plan selected');

      const resOverrides: Record<string, number> = {};
      for (const [k, v] of Object.entries(resourceEdits)) {
        const parsed = parseInt(v, 10);
        if (!isNaN(parsed) && parsed !== plan.resource_limits[k]) {
          resOverrides[k] = parsed;
        }
      }

      const featOverrides: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(featureEdits)) {
        if (v !== plan.feature_flags[k]) {
          featOverrides[k] = v;
        }
      }

      return setWorkspaceOverrides({
        workspace_id: id!,
        resource_overrides: Object.keys(resOverrides).length > 0 ? resOverrides : undefined,
        feature_overrides: Object.keys(featOverrides).length > 0 ? featOverrides : undefined,
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Overrides saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearWorkspaceOverrides(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Overrides cleared');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !data) {
    return <p className="text-[#4b5563]">Loading...</p>;
  }

  const plan = plansData?.plans?.find((p) => p.id === selectedPlanId);

  const isOverridden = (key: string, type: 'resource' | 'feature') => {
    if (!data.override) return false;
    if (type === 'resource') return data.override.resource_overrides?.[key] !== undefined;
    return data.override.feature_overrides?.[key] !== undefined;
  };

  return (
    <div>
      <button onClick={() => navigate('/admin/workspaces')} className="flex items-center gap-2 text-sm text-[#9ca3af] hover:text-[#eab308] mb-4 transition-colors">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 bg-[#1e2430] rounded-xl flex items-center justify-center text-lg font-bold text-[#eab308]">
          {data.workspace.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <h1 className="font-['Playfair_Display'] text-xl font-bold">{data.workspace.name}</h1>
          <p className="text-sm text-[#9ca3af]">
            Owner: {data.owner?.email || '—'} · Created {new Date(data.workspace.created_at).toLocaleDateString('pt-BR')}
          </p>
        </div>

        <select
          value={selectedPlanId}
          onChange={(e) => {
            setSelectedPlanId(e.target.value);
            setPlanMutation.mutate(e.target.value);
          }}
          className="px-3 py-2 rounded-lg bg-[#12151a] border border-[#1e2430] text-sm text-[#e8eaf0] focus:outline-none focus:border-[#eab308]"
        >
          <option value="">No plan</option>
          {plansData?.plans?.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
          <h2 className="font-semibold mb-4">Resource Limits</h2>
          <div className="flex flex-col gap-3">
            {Object.entries(RESOURCE_LABELS).map(([key, label]) => (
              <div key={key} className="flex justify-between items-center">
                <span className="text-sm text-[#9ca3af]">{label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={resourceEdits[key] ?? ''}
                    onChange={(e) => setResourceEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                    className={`w-20 px-2 py-1 rounded text-right font-['DM_Mono'] text-sm bg-[#1e2430] border focus:outline-none focus:border-[#eab308] ${
                      isOverridden(key, 'resource') ? 'border-[#eab308]/30 text-[#eab308]' : 'border-transparent text-[#e8eaf0]'
                    }`}
                  />
                  <span className={`text-[0.7rem] ${isOverridden(key, 'resource') ? 'text-[#f5a342]' : 'text-[#4b5563]'}`}>
                    {isOverridden(key, 'resource')
                      ? `override (plan: ${plan?.resource_limits[key] ?? '—'})`
                      : `plan: ${plan?.resource_limits[key] ?? '—'}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
          <h2 className="font-semibold mb-4">Feature Flags</h2>
          <div className="flex flex-col gap-3">
            {Object.entries(FEATURE_LABELS).map(([key, label]) => (
              <div key={key} className="flex justify-between items-center">
                <span className="text-sm text-[#9ca3af]">{label}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFeatureEdits((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className={`text-sm font-medium ${featureEdits[key] ? 'text-[#3ecf8e]' : 'text-[#f55a42]'}`}
                  >
                    {featureEdits[key] ? '● ON' : '● OFF'}
                  </button>
                  <span className={`text-[0.7rem] ${isOverridden(key, 'feature') ? 'text-[#f5a342]' : 'text-[#4b5563]'}`}>
                    {isOverridden(key, 'feature')
                      ? `override (plan: ${plan?.feature_flags[key] ? 'ON' : 'OFF'})`
                      : 'plan'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5 mb-6">
        <h2 className="font-semibold mb-3">Notes</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Admin notes..."
          rows={2}
          className="w-full px-3 py-2 rounded-lg bg-[#1e2430] border border-transparent text-sm text-[#e8eaf0] placeholder-[#4b5563] focus:outline-none focus:border-[#eab308] resize-none"
        />
      </div>

      <div className="flex gap-3 mb-8">
        <button
          onClick={() => saveOverridesMutation.mutate()}
          disabled={saveOverridesMutation.isPending}
          className="px-6 py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors disabled:opacity-50"
        >
          {saveOverridesMutation.isPending ? 'Saving...' : 'Save Overrides'}
        </button>
        <button
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          className="px-6 py-2.5 rounded-lg border border-[#1e2430] text-sm text-[#9ca3af] hover:border-[#eab308] hover:text-[#eab308] transition-colors disabled:opacity-50"
        >
          Reset to Plan Defaults
        </button>
      </div>

      <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
        <h2 className="font-semibold mb-4">Members ({data.members.length})</h2>

        <div className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-2 text-[0.7rem] text-[#9ca3af] uppercase tracking-wider pb-3 border-b border-[#1e2430]">
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Joined</span>
        </div>

        {data.members.map((m) => (
          <div key={m.user_id} className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-2 py-2.5 border-b border-[#1e2430]/50 text-sm">
            <span>{m.name}</span>
            <span className="text-[#9ca3af]">{m.email}</span>
            <span className={m.role === 'owner' ? 'text-[#eab308]' : 'text-[#9ca3af]'}>{m.role}</span>
            <span className="text-[#9ca3af]">
              {new Date(m.joined_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import {
  getWorkspace, listPlans, setWorkspacePlan,
  setWorkspaceOverrides, clearWorkspaceOverrides,
  RESOURCE_LIMIT_KEYS, RESOURCE_LIMIT_LABELS,
  FEATURE_FLAG_KEYS, FEATURE_FLAG_LABELS,
  RATE_LIMIT_KEYS, RATE_LIMIT_LABELS,
} from '../lib/api';

const ALL_LIMIT_KEYS = [...RESOURCE_LIMIT_KEYS, ...RATE_LIMIT_KEYS];
const ALL_LIMIT_LABELS = { ...RESOURCE_LIMIT_LABELS, ...RATE_LIMIT_LABELS };

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
          rEdits[k] = v != null ? String(v) : '';
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
      for (const key of ALL_LIMIT_KEYS) {
        const parsed = parseInt(resourceEdits[key], 10);
        const planVal = (plan[key as keyof typeof plan] as number | null) ?? 0;
        if (!isNaN(parsed) && parsed !== planVal) {
          resOverrides[key] = parsed;
        }
      }

      const featOverrides: Record<string, boolean> = {};
      for (const key of FEATURE_FLAG_KEYS) {
        const planVal = (plan[key] as boolean) ?? false;
        if (featureEdits[key] !== planVal) {
          featOverrides[key] = featureEdits[key];
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
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <button onClick={() => navigate('/admin/workspaces')} className="flex items-center gap-2 text-sm text-[#9ca3af] hover:text-[#eab308] mb-4 transition-colors">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex min-w-0 flex-col gap-4 mb-8 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="w-12 h-12 bg-[#1e2430] rounded-xl flex items-center justify-center text-lg font-bold text-[#eab308] shrink-0">
            {data.workspace.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="font-['Playfair_Display'] text-xl font-bold break-words">{data.workspace.name}</h1>
            <p className="text-sm text-[#9ca3af] truncate">
              Owner: {data.owner?.email || '—'} · Created {new Date(data.workspace.created_at).toLocaleDateString('pt-BR')}
            </p>
          </div>
        </div>

        <select
          value={selectedPlanId}
          onChange={(e) => {
            setSelectedPlanId(e.target.value);
            setPlanMutation.mutate(e.target.value);
          }}
          className="w-full min-w-0 max-w-full rounded-lg border border-[#1e2430] bg-[#12151a] px-3 py-2 text-sm text-[#e8eaf0] focus:border-[#eab308] focus:outline-none sm:w-auto"
        >
          <option value="">No plan</option>
          {plansData?.plans?.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="grid min-w-0 max-w-full grid-cols-1 gap-6 mb-6 md:grid-cols-2">
        <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5 min-w-0">
          <h2 className="font-semibold mb-4">Resource Limits</h2>
          <div className="flex flex-col gap-2">
            {RESOURCE_LIMIT_KEYS.map((key) => (
              <LimitRow key={key} label={RESOURCE_LIMIT_LABELS[key]} fieldKey={key}
                value={resourceEdits[key] ?? ''} planValue={plan ? (plan[key] as number | null) : null}
                isOverridden={isOverridden(key, 'resource')}
                onChange={(val) => setResourceEdits((prev) => ({ ...prev, [key]: val }))} />
            ))}
          </div>

          <h3 className="font-semibold mt-5 mb-3 text-sm text-[#9ca3af]">Rate Limits</h3>
          <div className="flex flex-col gap-2">
            {RATE_LIMIT_KEYS.map((key) => (
              <LimitRow key={key} label={RATE_LIMIT_LABELS[key]} fieldKey={key}
                value={resourceEdits[key] ?? ''} planValue={plan ? (plan[key] as number | null) : null}
                isOverridden={isOverridden(key, 'resource')}
                onChange={(val) => setResourceEdits((prev) => ({ ...prev, [key]: val }))} />
            ))}
          </div>
        </div>

        <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5 min-w-0 overflow-hidden">
          <h2 className="font-semibold mb-4">Feature Flags</h2>
          <div className="flex flex-col gap-2">
            {FEATURE_FLAG_KEYS.map((key) => (
              <div key={key} className="flex items-center justify-between gap-2 overflow-hidden">
                <span className="text-sm text-[#9ca3af] truncate">{FEATURE_FLAG_LABELS[key]}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setFeatureEdits((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className={`text-sm font-medium ${featureEdits[key] ? 'text-[#3ecf8e]' : 'text-[#f55a42]'}`}
                  >
                    {featureEdits[key] ? 'ON' : 'OFF'}
                  </button>
                  {isOverridden(key, 'feature') && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#f5a342] shrink-0" title={`override (plan: ${plan?.[key] ? 'ON' : 'OFF'})`} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="min-w-0 bg-[#12151a] border border-[#1e2430] rounded-2xl p-5 mb-6">
        <h2 className="font-semibold mb-3">Notes</h2>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Admin notes..." rows={2}
          className="w-full px-3 py-2 rounded-lg bg-[#1e2430] border border-transparent text-sm text-[#e8eaf0] placeholder-[#4b5563] focus:outline-none focus:border-[#eab308] resize-none" />
      </div>

      <div className="flex min-w-0 flex-col gap-3 mb-8 sm:flex-row">
        <button onClick={() => saveOverridesMutation.mutate()} disabled={saveOverridesMutation.isPending}
          className="w-full px-6 py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors disabled:opacity-50 sm:w-auto">
          {saveOverridesMutation.isPending ? 'Saving...' : 'Save Overrides'}
        </button>
        <button onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending}
          className="w-full px-6 py-2.5 rounded-lg border border-[#1e2430] text-sm text-[#9ca3af] hover:border-[#eab308] hover:text-[#eab308] transition-colors disabled:opacity-50 sm:w-auto">
          Reset to Plan Defaults
        </button>
      </div>

      <div className="min-w-0 overflow-hidden bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
        <h2 className="font-semibold mb-4">Members ({data.members.length})</h2>
        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[2fr_2fr_1fr_1fr] gap-2 text-[0.7rem] text-[#9ca3af] uppercase tracking-wider pb-3 border-b border-[#1e2430]">
          <span>Name</span><span>Email</span><span>Role</span><span>Joined</span>
        </div>
        {data.members.map((m) => (
          <div key={m.user_id} className="min-w-0 border-b border-[#1e2430]/50 py-2.5 md:grid md:grid-cols-[2fr_2fr_1fr_1fr] md:gap-2">
            {/* Mobile card */}
            <div className="flex min-w-0 items-center justify-between gap-3 md:hidden">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm">{m.name}</span>
                <span className="truncate text-xs text-[#9ca3af]">{m.email}</span>
              </div>
              <span className={`shrink-0 text-xs font-medium ${m.role === 'owner' ? 'text-[#eab308]' : 'text-[#9ca3af]'}`}>{m.role}</span>
            </div>
            {/* Desktop row */}
            <span className="hidden truncate text-sm md:inline">{m.name}</span>
            <span className="hidden truncate text-sm text-[#9ca3af] md:inline">{m.email}</span>
            <span className={`hidden md:inline text-sm ${m.role === 'owner' ? 'text-[#eab308]' : 'text-[#9ca3af]'}`}>{m.role}</span>
            <span className="hidden md:inline text-sm text-[#9ca3af]">{new Date(m.joined_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LimitRow({ label, fieldKey, value, planValue, isOverridden, onChange }: {
  label: string; fieldKey: string; value: string; planValue: number | null;
  isOverridden: boolean; onChange: (val: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="text-sm text-[#9ca3af] truncate">{label}</span>
      <div className="flex items-center gap-2 shrink-0">
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)}
          className={`w-20 px-2 py-1 rounded text-right font-['DM_Mono'] text-sm bg-[#1e2430] border focus:outline-none focus:border-[#eab308] ${
            isOverridden ? 'border-[#eab308]/30 text-[#eab308]' : 'border-transparent text-[#e8eaf0]'
          }`} />
        {isOverridden ? (
          <span className="w-1.5 h-1.5 rounded-full bg-[#f5a342] shrink-0" title={`plan: ${planValue ?? '—'}`} />
        ) : (
          <span className="text-[0.7rem] text-[#4b5563] hidden sm:inline whitespace-nowrap">plan: {planValue ?? '—'}</span>
        )}
      </div>
    </div>
  );
}

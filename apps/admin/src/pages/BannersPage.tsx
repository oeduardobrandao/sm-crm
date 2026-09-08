import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  listBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  listPlans,
  listWorkspaces,
  type GlobalBanner,
} from '../lib/api';
import { TargetPicker } from '../components/TargetPicker';
import { RowButton } from '../components/RowLink';

const BANNER_TYPES = ['info', 'warning', 'critical'] as const;
const STATUSES = ['draft', 'active', 'archived'] as const;

const TYPE_LABELS: Record<string, string> = {
  info: 'Informativo',
  warning: 'Aviso',
  critical: 'Crítico',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  archived: 'Arquivado',
};

const TYPE_COLORS: Record<string, { accent: string; bg: string }> = {
  info: { accent: '#42c8f5', bg: 'rgba(66,200,245,0.18)' },
  warning: { accent: '#f5a342', bg: 'rgba(245,163,66,0.22)' },
  critical: { accent: '#f55a42', bg: 'rgba(245,90,66,0.25)' },
};

interface FormState {
  type: 'info' | 'warning' | 'critical';
  content: string;
  link: string;
  custom_color: string;
  target_mode: 'all' | 'plan' | 'workspace';
  target_plan_ids: string[];
  target_workspace_ids: string[];
  dismissible: boolean;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active' | 'archived';
}

const EMPTY_FORM: FormState = {
  type: 'info',
  content: '',
  link: '',
  custom_color: '',
  target_mode: 'all',
  target_plan_ids: [],
  target_workspace_ids: [],
  dismissible: true,
  starts_at: '',
  ends_at: '',
  status: 'draft',
};

function bannerToForm(b: GlobalBanner): FormState {
  return {
    type: b.type,
    content: b.content,
    link: b.link || '',
    custom_color: b.custom_color || '',
    target_mode: b.target_mode,
    target_plan_ids: b.target_plan_ids || [],
    target_workspace_ids: b.target_workspace_ids || [],
    dismissible: b.dismissible,
    starts_at: b.starts_at ? b.starts_at.slice(0, 16) : '',
    ends_at: b.ends_at ? b.ends_at.slice(0, 16) : '',
    status: b.status,
  };
}

function formToPayload(form: FormState): Record<string, unknown> {
  return {
    type: form.type,
    content: form.content,
    link: form.link || null,
    custom_color: form.custom_color || null,
    target_mode: form.target_mode,
    target_plan_ids: form.target_mode === 'plan' ? form.target_plan_ids : null,
    target_workspace_ids: form.target_mode === 'workspace' ? form.target_workspace_ids : null,
    dismissible: form.dismissible,
    starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
    ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
    status: form.status,
  };
}

export default function BannersPage() {
  const queryClient = useQueryClient();
  const [editingBanner, setEditingBanner] = useState<GlobalBanner | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'banners', statusFilter],
    queryFn: () => listBanners(statusFilter ? { status: statusFilter } : undefined),
  });

  const { data: plansData } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const { data: workspacesData } = useQuery({
    queryKey: ['admin', 'workspaces-all'],
    queryFn: () => listWorkspaces({ limit: 500 }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'banners'] });

  const createMut = useMutation({
    mutationFn: () => createBanner(formToPayload(form)),
    onSuccess: () => {
      invalidate();
      toast.success('Banner criado');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updateBanner({ banner_id: editingBanner!.id, ...formToPayload(form) }),
    onSuccess: () => {
      invalidate();
      toast.success('Banner atualizado');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteBanner(id),
    onSuccess: () => {
      invalidate();
      toast.success('Banner excluído');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingBanner(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  };

  const openEdit = (b: GlobalBanner) => {
    setEditingBanner(b);
    setForm(bannerToForm(b));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingBanner(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingBanner) updateMut.mutate();
    else createMut.mutate();
  };

  const banners = (data?.banners || []).filter(
    (b) => !search || b.content.toLowerCase().includes(search.toLowerCase()),
  );

  const isExpired = (b: GlobalBanner) =>
    b.status === 'active' && b.ends_at && new Date(b.ends_at) < new Date();

  const getStatusBadge = (b: GlobalBanner) => {
    if (isExpired(b)) return { label: 'EXPIRADO', cls: 'text-dim-foreground bg-secondary' };
    if (b.status === 'active') return { label: 'ATIVO', cls: 'text-success bg-success/15' };
    if (b.status === 'draft')
      return { label: 'RASCUNHO', cls: 'text-muted-foreground bg-secondary' };
    return { label: 'ARQUIVADO', cls: 'text-dim-foreground bg-secondary' };
  };

  const formatSchedule = (b: GlobalBanner) => {
    const fmt = (s: string) =>
      new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const start = b.starts_at ? fmt(b.starts_at) : 'Agora';
    const end = b.ends_at ? fmt(b.ends_at) : '∞';
    return `${start} → ${end}`;
  };

  const getTargetLabel = (b: GlobalBanner) => {
    if (b.target_mode === 'all') return 'Todos os workspaces';
    if (b.target_mode === 'plan') {
      const names = (b.target_plan_ids || []).map((pid) => {
        const p = plansData?.plans?.find((pl) => pl.id === pid);
        return p?.name || pid;
      });
      return names.join(', ');
    }
    return `${(b.target_workspace_ids || []).length} workspaces`;
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h1 className="font-sf text-2xl font-bold mb-1">Banners</h1>
          <p className="text-sm text-muted-foreground">Gerencie os avisos globais</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors"
        >
          <Plus size={16} /> Novo banner
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Buscar banners…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground focus:outline-none focus:border-primary"
        >
          <option value="">Todos os status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="hidden md:grid grid-cols-[2fr_0.7fr_1fr_1fr_0.7fr_0.5fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Conteúdo</span>
          <span>Tipo</span>
          <span>Público</span>
          <span>Agendamento</span>
          <span>Status</span>
          <span></span>
        </div>

        {isLoading ? (
          <p className="text-sm text-dim-foreground py-4">Carregando…</p>
        ) : banners.length === 0 ? (
          <p className="text-sm text-dim-foreground py-4">Nenhum banner encontrado.</p>
        ) : (
          banners.map((b) => {
            const tc = TYPE_COLORS[b.type];
            const badge = getStatusBadge(b);
            return (
              <div
                key={b.id}
                onClick={() => openEdit(b)}
                className={`cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50 py-3 -mx-5 px-5 ${b.status === 'draft' ? 'opacity-50' : ''}`}
              >
                {/* Mobile card */}
                <div className="md:hidden flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <RowButton onClick={() => openEdit(b)} className="truncate text-sm">
                      {b.content.slice(0, 60)}
                      {b.content.length > 60 ? '...' : ''}
                    </RowButton>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span
                      className="text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm"
                      style={{ color: tc.accent, backgroundColor: tc.bg }}
                    >
                      {TYPE_LABELS[b.type]}
                    </span>
                    <span>{getTargetLabel(b)}</span>
                    <span
                      className={`text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                </div>
                {/* Desktop row */}
                <div className="hidden md:grid grid-cols-[2fr_0.7fr_1fr_1fr_0.7fr_0.5fr] gap-2 items-center">
                  <div className="min-w-0">
                    <RowButton
                      onClick={() => openEdit(b)}
                      className="block max-w-full truncate text-sm"
                    >
                      {b.content.slice(0, 80)}
                      {b.content.length > 80 ? '...' : ''}
                    </RowButton>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {getTargetLabel(b)}
                    </div>
                  </div>
                  <span
                    className="text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm w-fit"
                    style={{ color: tc.accent, backgroundColor: tc.bg }}
                  >
                    {TYPE_LABELS[b.type]}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {b.target_mode === 'all'
                      ? 'Todos'
                      : b.target_mode === 'plan'
                        ? 'Plano'
                        : 'Workspace'}
                  </span>
                  <span className="text-sm text-muted-foreground">{formatSchedule(b)}</span>
                  <span
                    className={`text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm w-fit ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                  <span className="text-muted-foreground hover:text-primary">
                    <Pencil size={14} />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

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
              {editingBanner ? 'Editar banner' : 'Novo banner'}
            </h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Conteúdo (Markdown)
                </label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                  required
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Link (opcional)
                  </label>
                  <input
                    type="text"
                    value={form.link}
                    onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
                    placeholder="https://..."
                    pattern="https://.*|/(?![/\\]).*"
                    title="https://… ou um caminho iniciado por /"
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Cor personalizada (opcional)
                  </label>
                  <input
                    type="text"
                    value={form.custom_color}
                    onChange={(e) => setForm((f) => ({ ...f, custom_color: e.target.value }))}
                    placeholder="#ff5500"
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Tipo
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, type: e.target.value as FormState['type'] }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm text-foreground focus:outline-none focus:border-primary"
                  >
                    {BANNER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, status: e.target.value as FormState['status'] }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm text-foreground focus:outline-none focus:border-primary"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <TargetPicker
                value={{
                  target_mode: form.target_mode,
                  target_plan_ids: form.target_plan_ids,
                  target_workspace_ids: form.target_workspace_ids,
                }}
                plans={plansData?.plans}
                workspaces={workspacesData?.workspaces}
                onChange={(next) => setForm((f) => ({ ...f, ...next }))}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Início (opcional)
                  </label>
                  <input
                    type="datetime-local"
                    value={form.starts_at}
                    onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Fim (opcional)
                  </label>
                  <input
                    type="datetime-local"
                    value={form.ends_at}
                    onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.dismissible}
                  onChange={(e) => setForm((f) => ({ ...f, dismissible: e.target.checked }))}
                  className="rounded"
                />
                Pode ser fechado
              </label>

              {/* Live preview */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Prévia
                </label>
                <BannerPreview
                  type={form.type}
                  content={form.content}
                  customColor={form.custom_color}
                  link={form.link}
                  dismissible={form.dismissible}
                />
              </div>

              <div className="flex gap-3 mt-2">
                <button
                  type="submit"
                  disabled={createMut.isPending || updateMut.isPending}
                  className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
                >
                  {editingBanner ? 'Atualizar' : 'Criar'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:border-primary transition-colors"
                >
                  Cancelar
                </button>
                {editingBanner && editingBanner.status === 'draft' && (
                  <button
                    type="button"
                    onClick={() => deleteMut.mutate(editingBanner.id)}
                    disabled={deleteMut.isPending}
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

function BannerPreview({
  type,
  content,
  customColor,
  link,
  dismissible,
}: {
  type: string;
  content: string;
  customColor: string;
  link: string;
  dismissible: boolean;
}) {
  const tc = TYPE_COLORS[type] || TYPE_COLORS.info;
  const accent = customColor || tc.accent;
  const bg = customColor ? `${customColor}14` : tc.bg;

  return (
    <div
      style={{ background: bg, borderBottom: `1px solid ${accent}33` }}
      className="rounded-lg px-4 py-2.5 flex items-center gap-2"
    >
      <div className="flex-1 text-center text-sm text-foreground">
        {content || 'Prévia do banner…'}
        {link && (
          <span style={{ color: accent }} className="ml-1 underline text-sm">
            Link
          </span>
        )}
      </div>
      {dismissible && <span className="text-muted-foreground text-lg cursor-default">×</span>}
    </div>
  );
}

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Upload, Loader2, GripVertical, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PopupCard, defaultSecondaryLabel } from '@mesaas/ui/PopupCard';
import {
  listPopups,
  createPopup,
  updatePopup,
  deletePopup,
  listPlans,
  listWorkspaces,
  type GlobalPopup,
} from '../lib/api';
import { uploadInlineImage, resolveInlineImageUrls } from '../lib/inline-image';
import { sanitizeExternalUrl } from '../lib/security';
import { TargetPicker } from '../components/TargetPicker';
import {
  MAX_PAGES,
  addPage,
  emptyForm,
  formToPayload,
  movePage,
  pageHasContent,
  popupToForm,
  removePage,
  validateForm,
  withRequireAck,
  type PageForm,
  type PopupFormErrors,
  type PopupFormState,
} from './popup-form';

const STATUSES = ['draft', 'active', 'archived'] as const;
const INPUT =
  'w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-sf text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary';
const LABEL = 'block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5';

/** Espelha o sanitizeUrl do CRM (apps/crm/src/utils/security.ts): `//host` (protocol-relative)
 *  vira '#'; caminhos internos (`/`, `./`, `../`, `#`) passam direto; o resto vai para
 *  sanitizeExternalUrl (só http(s) sem credenciais). */
function previewHref(href: string): string {
  if (href.startsWith('//')) return '#';
  if (
    href.startsWith('/') ||
    href.startsWith('./') ||
    href.startsWith('../') ||
    href.startsWith('#')
  ) {
    return href;
  }
  return sanitizeExternalUrl(href);
}

const DARK_VARS = {
  '--card-bg': '#12151a',
  '--text-main': '#e8eaf0',
  '--text-muted': '#9ca3af',
  '--border-color': '#1e2430',
  '--cta-bg': '#e8eaf0',
  '--cta-fg': '#12151a',
} as React.CSSProperties;

export default function PopupsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<GlobalPopup | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'popups', statusFilter],
    queryFn: () => listPopups(statusFilter ? { status: statusFilter } : undefined),
  });
  const { data: plansData } = useQuery({ queryKey: ['admin', 'plans'], queryFn: listPlans });
  const { data: workspacesData } = useQuery({
    queryKey: ['admin', 'workspaces-all'],
    queryFn: () => listWorkspaces({ limit: 500 }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'popups'] });
  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const popups = (data?.popups || []).filter(
    (p) => !search || p.pages.some((pg) => pg.title.toLowerCase().includes(search.toLowerCase())),
  );

  const isExpired = (p: GlobalPopup) =>
    p.status === 'active' && p.ends_at && new Date(p.ends_at) < new Date();

  const badge = (p: GlobalPopup) => {
    if (isExpired(p)) return { label: 'EXPIRED', cls: 'text-dim-foreground bg-secondary' };
    if (p.status === 'active') return { label: 'ACTIVE', cls: 'text-success bg-success/15' };
    if (p.status === 'draft') return { label: 'DRAFT', cls: 'text-muted-foreground bg-secondary' };
    return { label: 'ARCHIVED', cls: 'text-dim-foreground bg-secondary' };
  };

  const schedule = (p: GlobalPopup) => {
    const fmt = (s: string) =>
      new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    return `${p.starts_at ? fmt(p.starts_at) : 'Now'} → ${p.ends_at ? fmt(p.ends_at) : '∞'}`;
  };

  const targetLabel = (p: GlobalPopup) => {
    if (p.target_mode === 'all') return 'All workspaces';
    if (p.target_mode === 'plan') {
      return (p.target_plan_ids || [])
        .map((id) => plansData?.plans?.find((pl) => pl.id === id)?.name || id)
        .join(', ');
    }
    return `${(p.target_workspace_ids || []).length} workspaces`;
  };

  const frequencyLabel = (p: GlobalPopup) =>
    `${p.frequency === 'once' ? 'Once' : 'Until CTA'}${p.require_ack ? ' · ack' : ''}`;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h1 className="font-sf text-2xl font-bold mb-1">Popups</h1>
          <p className="text-sm text-muted-foreground">
            Modal announcements shown at most once per session inside the CRM
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors"
        >
          <Plus size={16} /> New Popup
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search popups..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground focus:outline-none focus:border-primary"
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="hidden md:grid grid-cols-[2fr_0.8fr_1fr_1fr_0.7fr_0.4fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Title</span>
          <span>Frequency</span>
          <span>Target</span>
          <span>Schedule</span>
          <span>Status</span>
          <span></span>
        </div>

        {isLoading ? (
          <p className="text-sm text-dim-foreground py-4">Loading...</p>
        ) : popups.length === 0 ? (
          <p className="text-sm text-dim-foreground py-4">No popups found.</p>
        ) : (
          popups.map((p) => {
            const b = badge(p);
            const first = p.pages[0];
            const metrics = `seen ${p.counts.seen} · closed ${p.counts.closed} · cta ${p.counts.cta} · ack ${p.counts.ack}`;
            return (
              <div
                key={p.id}
                onClick={() => {
                  setEditing(p);
                  setShowForm(true);
                }}
                className={`cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50 py-3 -mx-5 px-5 min-w-0 md:grid md:grid-cols-[2fr_0.8fr_1fr_1fr_0.7fr_0.4fr] md:gap-2 md:items-center ${p.status === 'draft' ? 'opacity-50' : ''}`}
              >
                <div className="min-w-0 flex items-center gap-3">
                  <PageThumb imageKey={first?.image_key ?? null} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      <span className="truncate">{first?.title}</span>
                      {p.pages.length > 1 && (
                        <span className="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-sm bg-secondary text-muted-foreground shrink-0">
                          {p.pages.length} pages
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">{metrics}</div>
                  </div>
                </div>
                {/* Mobile: os mesmos nós viram uma linha de meta; `md:contents` devolve cada
                    span à sua coluna do grid no desktop, sem duplicar texto algum. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:mt-0 md:contents">
                  <span className="md:text-sm">{frequencyLabel(p)}</span>
                  <span className="md:text-sm md:truncate">{targetLabel(p)}</span>
                  <span className="hidden md:block md:text-sm">{schedule(p)}</span>
                  <span
                    className={`text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm w-fit ${b.cls}`}
                  >
                    {b.label}
                  </span>
                  <span className="hidden md:block text-muted-foreground hover:text-primary">
                    <Pencil size={14} />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showForm && (
        <PopupEditor
          popup={editing}
          plans={plansData?.plans}
          workspaces={workspacesData?.workspaces}
          onClose={closeForm}
          onSaved={() => {
            invalidate();
            closeForm();
          }}
        />
      )}
    </div>
  );
}

function PageThumb({ imageKey }: { imageKey: string | null }) {
  const { data: url } = useQuery({
    queryKey: ['admin', 'popup-thumb', imageKey],
    queryFn: () => resolveInlineImageUrls([imageKey!]).then((m) => m[imageKey!] ?? ''),
    enabled: Boolean(imageKey),
    staleTime: 30 * 60 * 1000,
  });
  return (
    <div className="w-9 h-6 rounded bg-secondary shrink-0 overflow-hidden">
      {url && <img src={url} alt="" className="w-full h-full object-cover" />}
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────

interface EditorProps {
  popup: GlobalPopup | null;
  plans: { id: string; name: string }[] | undefined;
  workspaces: { id: string; name: string }[] | undefined;
  onClose: () => void;
  onSaved: () => void;
}

function PopupEditor({ popup, plans, workspaces, onClose, onSaved }: EditorProps) {
  const [form, setForm] = useState<PopupFormState>(() =>
    popup ? popupToForm(popup) : emptyForm(),
  );
  const [selected, setSelected] = useState(0);
  const [errors, setErrors] = useState<PopupFormErrors | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const page = form.pages[Math.min(selected, form.pages.length - 1)];
  const pageIndex = form.pages.indexOf(page);

  const imageKeys = useMemo(
    () => form.pages.map((p) => p.image_key).filter((k): k is string => Boolean(k)),
    [form.pages],
  );
  const { data: imageUrls } = useQuery({
    queryKey: ['admin', 'popup-images', imageKeys],
    queryFn: () => resolveInlineImageUrls(imageKeys),
    enabled: imageKeys.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  const createMut = useMutation({
    mutationFn: () => createPopup(formToPayload(form)),
    onSuccess: () => {
      toast.success('Popup created');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const updateMut = useMutation({
    mutationFn: () => updatePopup({ popup_id: popup!.id, ...formToPayload(form) }),
    onSuccess: () => {
      toast.success('Popup updated');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const deleteMut = useMutation({
    mutationFn: () => deletePopup(popup!.id),
    onSuccess: () => {
      toast.success('Popup deleted');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updatePage = (patch: Partial<PageForm>) => {
    setForm((f) => ({
      ...f,
      pages: f.pages.map((p, i) => (i === pageIndex ? { ...p, ...patch } : p)),
    }));
    setErrors(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateForm(form);
    setErrors(errs);
    if (errs) {
      const firstPage = Object.keys(errs.pages).map(Number)[0];
      if (firstPage !== undefined) setSelected(firstPage);
      return;
    }
    if (popup) updateMut.mutate();
    else createMut.mutate();
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const r = await uploadInlineImage(file);
      updatePage({ image_key: r.r2Key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleRemovePage = (index: number) => {
    if (form.pages.length <= 1) return;
    if (pageHasContent(form.pages[index]) && !window.confirm('Remove this page and its content?'))
      return;
    setForm((f) => removePage(f, index));
    setSelected((s) => (index < s ? s - 1 : Math.min(s, form.pages.length - 2)));
    setErrors(null);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = form.pages.findIndex((p) => p.key === active.id);
    const to = form.pages.findIndex((p) => p.key === over.id);
    if (from < 0 || to < 0) return;
    setForm((f) => movePage(f, from, to));
    setSelected(to);
    setErrors(null);
  };

  useEffect(() => {
    if (selected > form.pages.length - 1) setSelected(form.pages.length - 1);
  }, [form.pages.length, selected]);

  const hasCta = Boolean(form.cta_label.trim() && form.cta_url.trim());
  const secondaryLabel =
    form.secondary_label.trim() || defaultSecondaryLabel(form.require_ack, hasCta);
  const pending = createMut.isPending || updateMut.isPending;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-[1.15fr_0.85fr]">
          {/* ── Coluna do formulário ── */}
          <div className="p-5 md:p-7 flex flex-col gap-5 md:border-r border-border">
            <h2 className="font-sf text-lg font-bold">{popup ? 'Edit Popup' : 'New Popup'}</h2>

            <div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={form.pages.map((p) => p.key)}
                  strategy={horizontalListSortingStrategy}
                >
                  <div
                    role="tablist"
                    aria-label="Pages"
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    {form.pages.map((p, i) => (
                      <PageTab
                        key={p.key}
                        page={p}
                        index={i}
                        active={i === pageIndex}
                        hasError={Boolean(errors?.pages[i])}
                        canRemove={form.pages.length > 1}
                        onSelect={() => setSelected(i)}
                        onRemove={() => handleRemovePage(i)}
                      />
                    ))}
                    {form.pages.length < MAX_PAGES && (
                      <button
                        type="button"
                        onClick={() => {
                          setForm((f) => addPage(f));
                          setSelected(form.pages.length);
                          setErrors(null);
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary"
                      >
                        + Page
                      </button>
                    )}
                  </div>
                </SortableContext>
              </DndContext>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="popup-title" className={LABEL}>
                  Title
                </label>
                <input
                  id="popup-title"
                  className={INPUT}
                  value={page.title}
                  maxLength={120}
                  onChange={(e) => updatePage({ title: e.target.value })}
                />
                {errors?.pages[pageIndex]?.title && (
                  <p className="text-xs text-destructive mt-1">{errors.pages[pageIndex].title}</p>
                )}
              </div>
              <div>
                <label htmlFor="popup-eyebrow" className={LABEL}>
                  Eyebrow (optional)
                </label>
                <input
                  id="popup-eyebrow"
                  className={INPUT}
                  value={page.eyebrow}
                  maxLength={60}
                  onChange={(e) => updatePage({ eyebrow: e.target.value })}
                />
                {errors?.pages[pageIndex]?.eyebrow && (
                  <p className="text-xs text-destructive mt-1">{errors.pages[pageIndex].eyebrow}</p>
                )}
              </div>
            </div>

            <div>
              <label className={LABEL}>Image (optional, 16:9 recommended, up to 10 MB)</label>
              <div className="flex items-center gap-3 border border-dashed border-border rounded-lg px-3 py-2">
                <div className="w-16 h-10 rounded bg-secondary overflow-hidden shrink-0">
                  {page.image_key && imageUrls?.[page.image_key] && (
                    <img
                      src={imageUrls[page.image_key]}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:border-primary disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Upload size={14} />
                  )}
                  {uploading ? 'Uploading...' : page.image_key ? 'Replace' : 'Upload'}
                </button>
                {page.image_key && (
                  <button
                    type="button"
                    onClick={() => updatePage({ image_key: '' })}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="popup-body" className={LABEL}>
                Body (Markdown)
              </label>
              <textarea
                id="popup-body"
                rows={4}
                maxLength={2000}
                value={page.body}
                onChange={(e) => updatePage({ body: e.target.value })}
                className={`${INPUT} resize-none`}
              />
              {errors?.pages[pageIndex]?.body && (
                <p className="text-xs text-destructive mt-1">{errors.pages[pageIndex].body}</p>
              )}
            </div>

            <div className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground border-t border-border pt-4">
              Popup settings (apply to all pages)
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="popup-cta-label" className={LABEL}>
                  CTA label
                </label>
                <input
                  id="popup-cta-label"
                  className={INPUT}
                  maxLength={40}
                  value={form.cta_label}
                  onChange={(e) => setForm((f) => ({ ...f, cta_label: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="popup-cta-url" className={LABEL}>
                  CTA URL
                </label>
                <input
                  id="popup-cta-url"
                  className={INPUT}
                  placeholder="/ajuda/... or https://..."
                  value={form.cta_url}
                  onChange={(e) => setForm((f) => ({ ...f, cta_url: e.target.value }))}
                />
              </div>
            </div>
            {errors?.cta && <p className="text-xs text-destructive -mt-3">{errors.cta}</p>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="popup-secondary" className={LABEL}>
                  Secondary label
                </label>
                <input
                  id="popup-secondary"
                  className={INPUT}
                  maxLength={40}
                  value={form.secondary_label}
                  placeholder={defaultSecondaryLabel(form.require_ack, hasCta)}
                  onChange={(e) => setForm((f) => ({ ...f, secondary_label: e.target.value }))}
                />
              </div>
              <div>
                <label className={LABEL}>CTA style</label>
                <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                  {(['ink', 'brand'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, cta_style: s }))}
                      className={`flex-1 px-3 py-2 ${form.cta_style === s ? 'bg-card font-semibold text-foreground' : 'text-muted-foreground'}`}
                    >
                      {s === 'ink' ? 'Ink' : 'Brand yellow'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className={LABEL}>Frequency</label>
              <div className="flex gap-4 text-sm text-muted-foreground">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="frequency"
                    checked={form.frequency === 'once'}
                    onChange={() => setForm((f) => ({ ...f, frequency: 'once' }))}
                  />
                  Once per user
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="frequency"
                    checked={form.frequency === 'until_cta'}
                    disabled={form.require_ack}
                    onChange={() => setForm((f) => ({ ...f, frequency: 'until_cta' }))}
                  />
                  Every session until CTA
                </label>
              </div>
              {errors?.frequency && (
                <p className="text-xs text-destructive mt-1">{errors.frequency}</p>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={form.require_ack}
                onChange={(e) => setForm((f) => withRequireAck(f, e.target.checked))}
                className="rounded"
              />
              Require acknowledgement (no X, no click-outside, no Esc)
            </label>

            <div>
              <TargetPicker
                value={{
                  target_mode: form.target_mode,
                  target_plan_ids: form.target_plan_ids,
                  target_workspace_ids: form.target_workspace_ids,
                }}
                plans={plans}
                workspaces={workspaces}
                onChange={(next) => setForm((f) => ({ ...f, ...next }))}
              />
              {errors?.target && <p className="text-xs text-destructive mt-1">{errors.target}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="popup-starts" className={LABEL}>
                  Starts at (optional)
                </label>
                <input
                  id="popup-starts"
                  type="datetime-local"
                  className={INPUT}
                  value={form.starts_at}
                  onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="popup-ends" className={LABEL}>
                  Ends at (optional)
                </label>
                <input
                  id="popup-ends"
                  type="datetime-local"
                  className={INPUT}
                  value={form.ends_at}
                  onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                />
                {errors?.schedule && (
                  <p className="text-xs text-destructive mt-1">{errors.schedule}</p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="popup-status" className={LABEL}>
                Status
              </label>
              <select
                id="popup-status"
                className={INPUT}
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as PopupFormState['status'] }))
                }
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Coluna do preview ── */}
          <div className="bg-secondary/40 p-5 md:p-7 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className={LABEL}>Live preview</span>
              <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                {(['light', 'dark'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTheme(t)}
                    className={`px-3 py-1 ${theme === t ? 'bg-card font-semibold text-foreground' : 'text-muted-foreground'}`}
                  >
                    {t === 'light' ? 'Light' : 'Dark'}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="md:sticky md:top-4 flex justify-center rounded-xl p-4"
              style={
                theme === 'dark'
                  ? { ...DARK_VARS, background: '#0a0c0f' }
                  : { background: '#eef0f3' }
              }
            >
              <PopupCard
                pages={form.pages.map((p) => ({
                  title: p.title || 'Title',
                  eyebrow: p.eyebrow || null,
                  body: p.body || 'Body preview...',
                  imageUrl: p.image_key ? (imageUrls?.[p.image_key] ?? null) : null,
                }))}
                page={pageIndex}
                onPageChange={setSelected}
                ctaLabel={hasCta ? form.cta_label : null}
                ctaStyle={form.cta_style}
                secondaryLabel={secondaryLabel}
                requireAck={form.require_ack}
                sanitizeHref={previewHref}
                onCta={hasCta ? () => {} : undefined}
                onSecondary={() => {}}
                onClose={() => {}}
                titleId={titleId}
                bodyId={bodyId}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Exact CRM component. Navigating here selects the page tab.
            </p>
          </div>

          <div className="md:col-span-2 flex gap-3 p-5 md:px-7 border-t border-border">
            <button
              type="submit"
              disabled={pending}
              className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {popup ? 'Update' : 'Create'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:border-primary transition-colors"
            >
              Cancel
            </button>
            {popup && popup.status === 'draft' && (
              <button
                type="button"
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
                aria-label="Delete"
                className="px-4 py-2.5 rounded-lg border border-destructive/30 text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function PageTab({
  page,
  index,
  active,
  hasError,
  canRemove,
  onSelect,
  onRemove,
}: {
  page: PageForm;
  index: number;
  active: boolean;
  hasError: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.key,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const label = page.title.trim() ? page.title.trim().slice(0, 18) : 'Untitled';
  const tone = active
    ? 'bg-card text-foreground font-semibold'
    : 'bg-secondary text-muted-foreground';
  // O anel de erro precisa ganhar explicitamente de "active" — duas classes ring-* de
  // cores diferentes competem pela ordem no stylesheet, não pela ordem no className.
  const ring = hasError ? 'ring-1 ring-destructive' : active ? 'ring-1 ring-border' : '';
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 pl-1.5 pr-2 py-1.5 rounded-lg text-xs ${tone} ${ring}`}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab text-dim-foreground"
        aria-label={`Reorder page ${index + 1}`}
      >
        <GripVertical size={12} />
      </span>
      <button type="button" role="tab" aria-selected={active} onClick={onSelect}>
        {index + 1} · {label}
      </button>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove page ${index + 1}`}
          className="text-dim-foreground hover:text-destructive"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

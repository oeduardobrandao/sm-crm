import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { DragEndEvent } from '@dnd-kit/core';
import { defaultSecondaryLabel } from '@mesaas/ui/PopupCard';
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
import { useIsPhone } from '../hooks/useIsPhone';
import { AdminFormSheet } from '../components/shell/AdminFormSheet';
import {
  FREQUENCY_LABEL,
  addPage,
  emptyForm,
  formToPayload,
  movePage,
  pageHasContent,
  popupToForm,
  removePage,
  triggerChipLabel,
  validateForm,
  withRequireAck,
  type PageForm,
  type PopupFormErrors,
  type PopupFormState,
} from './popup-form';
import { PopupsDesktop } from './popups/PopupsDesktop';
import { PopupsPhone } from './popups/PopupsPhone';
import { PopupEditorBody } from './popups/PopupEditorBody';
import type { PopupRowView } from './popups/list-model';
import type { EditorSection, NamedOption, PopupEditorModel } from './popups/editor-model';
import type { PreviewTheme } from './popups/popup-preview';

const FORM_ID = 'popup-form';

export default function PopupsPage() {
  const isPhone = useIsPhone();
  const queryClient = useQueryClient();
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

  const editor = usePopupEditor({
    plans: plansData?.plans,
    workspaces: workspacesData?.workspaces,
    onSaved: () => queryClient.invalidateQueries({ queryKey: ['admin', 'popups'] }),
  });

  const popups = (data?.popups || []).filter(
    (p) => !search || p.pages.some((pg) => pg.title.toLowerCase().includes(search.toLowerCase())),
  );

  const isExpired = (p: GlobalPopup) =>
    p.status === 'active' && p.ends_at && new Date(p.ends_at) < new Date();

  const status = (p: GlobalPopup): PopupRowView['status'] => {
    if (isExpired(p)) return { label: 'EXPIRADO', variant: 'neutral' };
    if (p.status === 'active') return { label: 'ATIVO', variant: 'success' };
    if (p.status === 'draft') return { label: 'RASCUNHO', variant: 'neutral' };
    return { label: 'ARQUIVADO', variant: 'neutral' };
  };

  const schedule = (p: GlobalPopup) => {
    const fmt = (s: string) =>
      new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    return `${p.starts_at ? fmt(p.starts_at) : 'Agora'} → ${p.ends_at ? fmt(p.ends_at) : '∞'}`;
  };

  const targetLabel = (p: GlobalPopup) => {
    if (p.target_mode === 'all') return 'Todos os workspaces';
    if (p.target_mode === 'plan') {
      return (p.target_plan_ids || [])
        .map((id) => plansData?.plans?.find((pl) => pl.id === id)?.name || id)
        .join(', ');
    }
    return `${(p.target_workspace_ids || []).length} workspaces`;
  };

  const frequencyLabel = (p: GlobalPopup) =>
    `${FREQUENCY_LABEL[p.frequency] ?? p.frequency}${p.require_ack ? ' · confirmação' : ''}`;

  const rows: PopupRowView[] = popups.map((p) => ({
    popup: p,
    title: p.pages[0]?.title ?? 'Popup sem título',
    pageCount: p.pages.length,
    pagesLabel: `${p.pages.length} ${p.pages.length === 1 ? 'página' : 'páginas'}`,
    metrics: `vistos ${p.counts.seen} · fechados ${p.counts.closed} · cta ${p.counts.cta} · confirmados ${p.counts.ack}`,
    frequency: frequencyLabel(p),
    target: targetLabel(p),
    trigger: triggerChipLabel(p.trigger, p.trigger_days),
    schedule: schedule(p),
    status: status(p),
    imageKey: p.pages[0]?.image_key ?? null,
    draft: p.status === 'draft',
  }));

  const viewProps = {
    rows,
    isLoading,
    statusFilter,
    onStatusFilterChange: setStatusFilter,
    search,
    onSearchChange: setSearch,
    onCreate: () => editor.openEditor(null),
    onEdit: (p: GlobalPopup) => editor.openEditor(p),
  };

  return (
    <>
      {isPhone ? <PopupsPhone {...viewProps} /> : <PopupsDesktop {...viewProps} />}
      <AdminFormSheet
        open={editor.open}
        onOpenChange={(next) => {
          if (!next) editor.close();
        }}
        title={editor.model.isEditing ? 'Editar popup' : 'Novo popup'}
        formId={FORM_ID}
        submitLabel={editor.model.isEditing ? 'Atualizar' : 'Criar'}
        submitting={editor.submitting}
        width="xl"
      >
        {/* noValidate: a validação é toda nossa (validateForm). Sem isso o min/max do campo de dias
            faz o browser bloquear o submit com a bolha nativa em vez de mostrar o erro inline. */}
        <form id={FORM_ID} onSubmit={editor.handleSubmit} noValidate>
          <PopupEditorBody model={editor.model} />
        </form>
      </AdminFormSheet>
    </>
  );
}

// ─── Editor ──────────────────────────────────────────────────

/**
 * Estado e handlers do editor. Vivem na página, não dentro da folha: cruzar 768px com a
 * folha aberta troca Dialog por BottomSheet (remonta o conteúdo), mas o rascunho fica aqui.
 */
function usePopupEditor({
  plans,
  workspaces,
  onSaved,
}: {
  plans: NamedOption[] | undefined;
  workspaces: NamedOption[] | undefined;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<GlobalPopup | null>(null);
  const [form, setForm] = useState<PopupFormState>(() => emptyForm());
  const [selected, setSelected] = useState(0);
  const [errors, setErrors] = useState<PopupFormErrors | null>(null);
  const [section, setSection] = useState<EditorSection>('pages');
  const [theme, setTheme] = useState<PreviewTheme>('light');
  const [uploading, setUploading] = useState(false);
  // Uma sessão por abertura do editor: um upload que termina depois de fechar e abrir outro
  // popup não pode escrever a imagem (nem o "Enviando…") na sessão nova.
  const session = useRef(0);

  const openEditor = (p: GlobalPopup | null) => {
    session.current += 1;
    setUploading(false);
    setPopup(p);
    setForm(p ? popupToForm(p) : emptyForm());
    setSelected(0);
    setErrors(null);
    setSection('pages');
    setTheme('light');
    setOpen(true);
  };
  // `popup` fica até o próximo openEditor: o título não troca durante a animação de saída.
  const close = () => setOpen(false);
  const saved = () => {
    onSaved();
    close();
  };

  const page = form.pages[Math.min(selected, form.pages.length - 1)];
  const pageIndex = form.pages.indexOf(page);

  const imageKeys = useMemo(
    () => form.pages.map((p) => p.image_key).filter((k): k is string => Boolean(k)),
    [form.pages],
  );
  const { data: imageUrls } = useQuery({
    queryKey: ['admin', 'popup-images', imageKeys],
    queryFn: () => resolveInlineImageUrls(imageKeys),
    enabled: open && imageKeys.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  const createMut = useMutation({
    mutationFn: () => createPopup(formToPayload(form)),
    onSuccess: () => {
      toast.success('Popup criado');
      saved();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const updateMut = useMutation({
    mutationFn: () => updatePopup({ popup_id: popup!.id, ...formToPayload(form) }),
    onSuccess: () => {
      toast.success('Popup atualizado');
      saved();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const deleteMut = useMutation({
    mutationFn: () => deletePopup(popup!.id),
    onSuccess: () => {
      toast.success('Popup excluído');
      saved();
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
      // Mostra a seção do primeiro erro: um erro numa aba escondida seria invisível.
      const firstPage = Object.keys(errs.pages).map(Number)[0];
      if (firstPage !== undefined) {
        setSelected(firstPage);
        setSection('pages');
      } else {
        setSection('settings');
      }
      return;
    }
    if (popup) updateMut.mutate();
    else createMut.mutate();
  };

  const handleUpload = async (file: File) => {
    const started = session.current;
    setUploading(true);
    try {
      const r = await uploadInlineImage(file);
      if (session.current !== started) return;
      updatePage({ image_key: r.r2Key });
    } catch (err) {
      if (session.current !== started) return;
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar');
    } finally {
      if (session.current === started) setUploading(false);
    }
  };

  const handleRemovePage = (index: number) => {
    if (form.pages.length <= 1) return;
    if (pageHasContent(form.pages[index]) && !window.confirm('Remover esta página e seu conteúdo?'))
      return;
    setForm((f) => removePage(f, index));
    setSelected((s) => (index < s ? s - 1 : Math.min(s, form.pages.length - 2)));
    setErrors(null);
  };

  const handleAddPage = () => {
    setForm((f) => addPage(f));
    setSelected(form.pages.length);
    setErrors(null);
  };

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
  const anyCta = hasCta || form.pages.some((p) => p.cta_label.trim() && p.cta_url.trim());
  const last = form.pages[form.pages.length - 1];
  const lastHasCta = Boolean((last.cta_label.trim() && last.cta_url.trim()) || hasCta);

  const model: PopupEditorModel = {
    isEditing: Boolean(popup),
    form,
    page,
    pageIndex,
    errors,
    section,
    setSection,
    theme,
    setTheme,
    imageUrls,
    uploading,
    plans,
    workspaces,
    hasCta,
    anyCta,
    lastHasCta,
    secondaryLabel:
      form.secondary_label.trim() || defaultSecondaryLabel(form.require_ack, lastHasCta),
    canDelete: Boolean(popup && popup.status === 'draft'),
    deleting: deleteMut.isPending,
    onDelete: () => deleteMut.mutate(),
    selectPage: setSelected,
    addPage: handleAddPage,
    removePage: handleRemovePage,
    dragEnd: handleDragEnd,
    updatePage,
    patchForm: (patch, opts) => {
      setForm((f) => ({ ...f, ...patch }));
      if (opts?.clearErrors) setErrors(null);
    },
    setRequireAck: (on) => setForm((f) => withRequireAck(f, on)),
    upload: handleUpload,
  };

  return {
    open,
    openEditor,
    close,
    handleSubmit,
    // A exclusão também segura a folha: o `saved()` dela fecha o editor, então não pode
    // chegar depois de o usuário já ter aberto outro popup.
    submitting: createMut.isPending || updateMut.isPending || deleteMut.isPending,
    model,
  };
}

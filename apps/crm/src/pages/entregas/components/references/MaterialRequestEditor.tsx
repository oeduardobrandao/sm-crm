import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ArrowDown, ArrowUp, PackageOpen, Plus, X } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/context/AuthContext';
import {
  saveMaterialRequest,
  type CrmMaterialRequest,
  type PostReferencesData,
} from '@/store/postReferences';

/** Same cap as the edge function (MAX_MATERIAL_ITEMS): items + free-form references. */
export const MAX_MATERIAL_ITEMS = 10;

const INTERNAL_STATUSES = ['rascunho', 'revisao_interna', 'aprovado_interno'];

interface FormItem {
  key: string;
  id?: number;
  label: string;
  detail: string;
  file_count: number;
}

interface FormState {
  open: boolean;
  items: FormItem[];
}

let keySeq = 0;
const newKey = () => `n${++keySeq}`;

function fromRequest(request: CrmMaterialRequest | null): FormState {
  return {
    open: request?.status === 'aberto',
    items: (request?.items ?? []).map((i) => ({
      key: `i${i.id}`,
      id: i.id,
      label: i.label,
      detail: i.detail ?? '',
      file_count: i.file_count,
    })),
  };
}

const signature = (f: FormState) =>
  JSON.stringify([f.open, f.items.map((i) => [i.id ?? null, i.label, i.detail])]);

function toBody(f: FormState, open: boolean) {
  return {
    open,
    items: f.items
      .filter((i) => i.label.trim() !== '')
      .map((i) => ({
        ...(i.id != null ? { id: i.id } : {}),
        label: i.label.trim(),
        detail: i.detail.trim() === '' ? null : i.detail.trim(),
      })),
  };
}

/** Header badge: waiting while open; "received" only while the post is still internal. */
export function MaterialStatusBadge({
  request,
  postStatus,
}: {
  request: CrmMaterialRequest | null;
  postStatus: string;
}) {
  const { t } = useTranslation('postPanels');
  if (!request) return null;
  if (request.status === 'aberto') {
    return (
      <Badge variant="warning" size="sm">
        {t('material.badgeWaiting')}
      </Badge>
    );
  }
  if (request.status === 'concluido' && INTERNAL_STATUSES.includes(postStatus)) {
    return (
      <Badge variant="success" size="sm">
        {t('material.badgeReceived')}
      </Badge>
    );
  }
  return null;
}

export interface MaterialRequestEditorProps {
  postId: number;
  request: CrmMaterialRequest | null;
  /** References the client sent without picking an item (they share the 10-slot cap). */
  freeFormCount: number;
}

/** "Pedir material ao cliente": switch + editable item list, explicit Save (no autosave, so
 *  half-typed items never reach the client). Read-only for members without entregas/editar. */
export function MaterialRequestEditor({
  postId,
  request,
  freeFormCount,
}: MaterialRequestEditorProps) {
  const { t } = useTranslation('postPanels');
  const qc = useQueryClient();
  const { can } = useAuth();
  const canEdit = can('entregas', 'editar') === true;
  const headingId = useId();

  const baseline = useMemo(() => fromRequest(request), [request]);
  const [form, setForm] = useState<FormState>(baseline);
  const baselineSig = signature(baseline);
  const lastBaselineSig = useRef(baselineSig);
  const dirty = signature(form) !== baselineSig;

  // A refetch (45 min refresh, another tab) replaces the form only when nothing is being edited.
  useEffect(() => {
    if (lastBaselineSig.current === baselineSig) return;
    const prev = lastBaselineSig.current;
    lastBaselineSig.current = baselineSig;
    setForm((cur) => (signature(cur) === prev ? baseline : cur));
  }, [baselineSig, baseline]);

  const mutation = useMutation({
    mutationFn: (vars: { open: boolean; form: FormState }) =>
      saveMaterialRequest(postId, toBody(vars.form, vars.open)),
    onSuccess: (saved, vars) => {
      qc.setQueryData<PostReferencesData>(['post-references', postId], (old) =>
        old ? { ...old, request: saved } : old,
      );
      qc.invalidateQueries({ queryKey: ['post-references', postId] });
      qc.invalidateQueries({ queryKey: ['post-material-summary'] });
      lastBaselineSig.current = signature(fromRequest(saved));
      setForm(fromRequest(saved));
      toast.success(vars.open ? t('material.saved') : t('material.cancelled'));
    },
    onError: (err) => {
      const code = err instanceof Error ? err.message : '';
      const known = [
        'invalid_item',
        'items_required',
        'too_many_items',
        'post_not_requestable',
        'forbidden',
        'not_found',
      ];
      toast.error(t(`material.errors.${known.includes(code) ? code : 'generic'}`));
    },
  });
  useUnsavedWork(mutation.isPending || dirty);

  if (!canEdit && !request) return null;

  const items = form.items;
  const hasLabel = items.some((i) => i.label.trim() !== '');
  const canAdd =
    items.length + freeFormCount < MAX_MATERIAL_ITEMS && items.length < MAX_MATERIAL_ITEMS;
  const doneCount = (request?.items ?? []).filter((i) => i.file_count > 0).length;

  const setItem = (key: string, patch: Partial<FormItem>) =>
    setForm((f) => ({ ...f, items: f.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  const move = (index: number, dir: -1 | 1) =>
    setForm((f) => {
      const next = [...f.items];
      const j = index + dir;
      if (j < 0 || j >= next.length) return f;
      [next[index], next[j]] = [next[j], next[index]];
      return { ...f, items: next };
    });

  const onToggle = (checked: boolean) => {
    if (checked) {
      setForm((f) => ({
        open: true,
        items: f.items.length ? f.items : [{ key: newKey(), label: '', detail: '', file_count: 0 }],
      }));
    } else if (request && request.status === 'aberto') {
      mutation.mutate({ open: false, form });
    } else {
      setForm((f) => ({ ...f, open: false }));
    }
  };

  const openedDate = request ? format(new Date(request.opened_at), 'dd/MM') : '';

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3"
    >
      <header className="flex items-center gap-2">
        <PackageOpen className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h4 id={headingId} className="text-[13px] font-semibold text-[var(--text-main)]">
            {t('material.title')}
          </h4>
          <p className="text-[12px] text-[var(--text-light)]">{t('material.switchHint')}</p>
        </div>
        {canEdit && (
          <Switch
            aria-label={t('material.switchLabel')}
            checked={form.open}
            disabled={mutation.isPending}
            onCheckedChange={onToggle}
          />
        )}
      </header>

      {(form.open || (!canEdit && request)) && (
        <div className="space-y-2">
          {request && request.items.length > 0 && (
            <p className="text-[12px] font-semibold text-[var(--text-muted)]">
              {t('material.progress', { done: doneCount, total: request.items.length })}
            </p>
          )}

          {canEdit ? (
            <ul className="space-y-2">
              {items.map((item, index) => (
                <li key={item.key} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Input
                      aria-label={t('material.itemLabel', { n: index + 1 })}
                      placeholder={t('material.itemLabelPlaceholder')}
                      value={item.label}
                      maxLength={120}
                      onChange={(e) => setItem(item.key, { label: e.target.value })}
                    />
                    <Input
                      aria-label={t('material.itemDetail', { n: index + 1 })}
                      placeholder={t('material.itemDetailPlaceholder')}
                      value={item.detail}
                      maxLength={300}
                      onChange={(e) => setItem(item.key, { detail: e.target.value })}
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-1 pt-1.5">
                    {item.id != null && (
                      <Badge variant={item.file_count > 0 ? 'success' : 'warning'} size="sm">
                        {item.file_count > 0
                          ? t('material.fileCount', { count: item.file_count })
                          : t('material.missing')}
                      </Badge>
                    )}
                    <button
                      type="button"
                      className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
                      aria-label={t('material.moveUp', { n: index + 1 })}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
                      aria-label={t('material.moveDown', { n: index + 1 })}
                      disabled={index === items.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                      aria-label={t('material.remove', { n: index + 1 })}
                      onClick={() =>
                        setForm((f) => ({ ...f, items: f.items.filter((i) => i.key !== item.key) }))
                      }
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-1.5">
              {request!.items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[var(--text-main)]">{item.label}</p>
                    {item.detail && (
                      <p className="text-[12px] text-[var(--text-muted)]">{item.detail}</p>
                    )}
                  </div>
                  <Badge variant={item.file_count > 0 ? 'success' : 'warning'} size="sm">
                    {item.file_count > 0
                      ? t('material.fileCount', { count: item.file_count })
                      : t('material.missing')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {canAdd && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      items: [...f.items, { key: newKey(), label: '', detail: '', file_count: 0 }],
                    }))
                  }
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('material.addItem')}
                </Button>
              )}
              <div className="ml-auto flex items-center gap-2">
                {!hasLabel && (
                  <span className="text-[12px] text-[var(--text-muted)]">
                    {t('material.needItem')}
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={!hasLabel || mutation.isPending}
                  onClick={() => mutation.mutate({ open: true, form })}
                >
                  {mutation.isPending ? t('material.saving') : t('material.save')}
                </Button>
              </div>
            </div>
          )}

          {request && (
            <p className="text-[11px] text-[var(--text-light)]">
              {request.opened_by_name
                ? t('material.requestedBy', { name: request.opened_by_name, date: openedDate })
                : t('material.requestedOn', { date: openedDate })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

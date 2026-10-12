import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  deleteKbVideoSeries,
  upsertKbVideoSeries,
  type AdminApiError,
  type KbVideoSeries,
} from '../../lib/api';
import { KB_VIDEO_SERIES_KEY } from '../../lib/kb-video-status';
import { slugify } from '../../lib/slugify';
import { useIsPhone } from '../../hooks/useIsPhone';
import { AdminFormSheet } from '../../components/shell/AdminFormSheet';
import { slugProblem } from './fields';
import { SeriesFormDesktop } from './SeriesFormDesktop';
import { SeriesFormPhone } from './SeriesFormPhone';
import type { SeriesFormValues } from './series-form';

const FORM_ID = 'series-form';

interface SeriesDialogProps {
  /** null = nova série */
  series: KbVideoSeries | null;
  onClose: () => void;
}

export function SeriesDialog({ series, onClose }: SeriesDialogProps) {
  const isPhone = useIsPhone();
  const qc = useQueryClient();
  const isEdit = !!series;
  const [title, setTitle] = useState(series?.title ?? '');
  const [slug, setSlug] = useState(series?.slug ?? '');
  const [description, setDescription] = useState(series?.description ?? '');
  const [displayOrder, setDisplayOrder] = useState(String(series?.display_order ?? 0));
  const [status, setStatus] = useState<'draft' | 'published'>(series?.status ?? 'draft');

  useEffect(() => {
    if (!isEdit) setSlug(slugify(title));
  }, [title, isEdit]);

  const slugError = slugProblem(slug);

  const done = (message: string) => {
    qc.invalidateQueries({ queryKey: KB_VIDEO_SERIES_KEY });
    toast.success(message);
    onClose();
  };

  const saveMut = useMutation({
    mutationFn: () =>
      upsertKbVideoSeries({
        ...(series ? { series_id: series.id } : {}),
        title,
        slug,
        description: description || null,
        display_order: Math.max(0, parseInt(displayOrder, 10) || 0),
        status,
      }),
    onSuccess: () => done(isEdit ? 'Série atualizada' : 'Série criada'),
    onError: (err: AdminApiError) =>
      toast.error(
        err.status === 409
          ? 'Já existe uma série com esse slug.'
          : 'Não foi possível salvar a série.',
      ),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteKbVideoSeries(series!.id),
    onSuccess: () => done('Série excluída'),
    onError: (err: AdminApiError) =>
      toast.error(
        err.status === 409
          ? 'Esta série ainda tem vídeos. Mova ou exclua os vídeos antes.'
          : 'Não foi possível excluir a série.',
      ),
  });

  const values: SeriesFormValues = { title, slug, description, displayOrder, status };
  const onChange = (patch: Partial<SeriesFormValues>) => {
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.slug !== undefined) setSlug(patch.slug);
    if (patch.description !== undefined) setDescription(patch.description);
    if (patch.displayOrder !== undefined) setDisplayOrder(patch.displayOrder);
    if (patch.status !== undefined) setStatus(patch.status);
  };
  const View = isPhone ? SeriesFormPhone : SeriesFormDesktop;

  return (
    <AdminFormSheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={isEdit ? 'Editar série' : 'Nova série'}
      formId={FORM_ID}
      submitting={saveMut.isPending}
      submitDisabled={!title || !slug || !!slugError}
      canClose={() => !deleteMut.isPending}
    >
      <form
        id={FORM_ID}
        onSubmit={(e) => {
          e.preventDefault();
          saveMut.mutate();
        }}
      >
        <View
          values={values}
          onChange={onChange}
          slugError={slugError}
          isEdit={isEdit}
          deleting={deleteMut.isPending}
          onDelete={() => {
            if (confirm('Excluir esta série?')) deleteMut.mutate();
          }}
        />
      </form>
    </AdminFormSheet>
  );
}

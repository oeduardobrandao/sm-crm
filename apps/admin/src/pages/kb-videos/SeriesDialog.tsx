import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import {
  deleteKbVideoSeries,
  upsertKbVideoSeries,
  type AdminApiError,
  type KbVideoSeries,
} from '../../lib/api';
import { KB_VIDEO_SERIES_KEY } from '../../lib/kb-video-status';
import { slugify } from '../../lib/slugify';
import { Button } from '../../components/ui/button';

const FIELD =
  'w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm focus:outline-none focus:border-primary';
const LABEL = 'block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5';
const RESERVED_SLUGS = ['novo', 'editar', 'video'];

interface SeriesDialogProps {
  /** null = nova série */
  series: KbVideoSeries | null;
  onClose: () => void;
}

export function SeriesDialog({ series, onClose }: SeriesDialogProps) {
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

  const slugError =
    slug &&
    (RESERVED_SLUGS.includes(slug)
      ? 'Slug reservado'
      : !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
        ? 'Apenas letras minúsculas, números e hifens'
        : null);

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
          : err.message,
      ),
  });

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="series-dialog-title"
        className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="series-dialog-title" className="text-lg font-semibold">
            {isEdit ? 'Editar série' : 'Nova série'}
          </h2>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveMut.mutate();
          }}
        >
          <div>
            <label htmlFor="series-title" className={LABEL}>
              Título
            </label>
            <input
              id="series-title"
              className={FIELD}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <label htmlFor="series-slug" className={LABEL}>
              Slug
            </label>
            <input
              id="series-slug"
              className={FIELD}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
            {slugError && <p className="mt-1 text-xs text-destructive">{slugError}</p>}
          </div>
          <div>
            <label htmlFor="series-description" className={LABEL}>
              Descrição
            </label>
            <textarea
              id="series-description"
              className={FIELD}
              rows={3}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="series-order" className={LABEL}>
                Ordem
              </label>
              <input
                id="series-order"
                type="number"
                min={0}
                max={10000}
                className={FIELD}
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="series-status" className={LABEL}>
                Status
              </label>
              <select
                id="series-status"
                className={FIELD}
                value={status}
                onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
              >
                <option value="draft">Rascunho</option>
                <option value="published">Publicado</option>
              </select>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            {isEdit ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={() => {
                  if (confirm('Excluir esta série?')) deleteMut.mutate();
                }}
              >
                Excluir série
              </Button>
            ) : (
              <span />
            )}
            <Button
              type="submit"
              size="sm"
              disabled={saveMut.isPending || !title || !slug || !!slugError}
            >
              {saveMut.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

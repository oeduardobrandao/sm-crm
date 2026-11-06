import { Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { FIELD, LABEL } from './fields';
import type { SeriesFormViewProps } from './series-form';

/** Series form body for the centred desktop sheet. The page owns the surrounding <form>. */
export function SeriesFormDesktop({
  values,
  onChange,
  slugError,
  isEdit,
  deleting,
  onDelete,
}: SeriesFormViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="series-title" className={LABEL}>
          Título
        </label>
        <input
          id="series-title"
          className={FIELD}
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
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
          value={values.slug}
          onChange={(e) => onChange({ slug: e.target.value })}
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
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
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
            value={values.displayOrder}
            onChange={(e) => onChange({ displayOrder: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="series-status" className={LABEL}>
            Status
          </label>
          <select
            id="series-status"
            className={FIELD}
            value={values.status}
            onChange={(e) => onChange({ status: e.target.value as 'draft' | 'published' })}
          >
            <option value="draft">Rascunho</option>
            <option value="published">Publicado</option>
          </select>
        </div>
      </div>
      {isEdit && (
        <div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={onDelete}
          >
            <Trash2 />
            Excluir série
          </Button>
        </div>
      )}
    </div>
  );
}

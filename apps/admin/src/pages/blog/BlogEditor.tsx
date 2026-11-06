import { useEffect, useId, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../lib/utils';
import { BlogPreview } from './BlogPreview';
import {
  FIELD_LIMITS,
  changedFields,
  isLive,
  outOfRange,
  type BlogPostDetail,
  type EditableField,
} from './blog-view';

const FIELDS: Array<{
  key: Exclude<EditableField, 'body_md'>;
  label: string;
  multiline?: boolean;
}> = [
  { key: 'title', label: 'Título (SEO)' },
  { key: 'h1', label: 'H1' },
  { key: 'description', label: 'Descrição', multiline: true },
  { key: 'lede', label: 'Lede', multiline: true },
];

const n = (v: number) => v.toLocaleString('pt-BR');

function Counter({ value, limits }: { value: string; limits: readonly [number, number] }) {
  const bad = outOfRange(value, limits);
  const [min, max] = limits;
  return (
    <span
      className={cn('text-xs tabular-nums', bad ? 'text-destructive' : 'text-muted-foreground')}
    >
      {n(value.length)} · {min === 1 ? `até ${n(max)}` : `${n(min)} a ${n(max)}`}
    </span>
  );
}

export interface BlogEditorProps {
  /** The post as it was when editing began: the diff and the expected_revision both come
   * from it, so a background refetch never rebases the draft. */
  post: BlogPostDetail;
  saving: boolean;
  /** Field-by-field messages from the server's 400 invalid_fields. */
  errors: string[];
  onSave: (fields: Partial<Record<EditableField, string>>) => void;
  onCancel: () => void;
  /** The save hit a 409: someone else changed the post. The draft stays until Recarregar. */
  conflict: boolean;
  onReload: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

/** "Editar texto": title, H1, description, lede and the Markdown body, with live counters
 * against the limits and a preview toggle. Counters are hints; the server validates. */
export function BlogEditor({
  post,
  saving,
  errors,
  onSave,
  onCancel,
  conflict,
  onReload,
  onDirtyChange,
}: BlogEditorProps) {
  const uid = useId();
  const [draft, setDraft] = useState<Record<EditableField, string>>(() => ({
    title: post.title ?? '',
    h1: post.h1 ?? '',
    description: post.description ?? '',
    lede: post.lede ?? '',
    body_md: post.body_md ?? '',
  }));
  const [previewing, setPreviewing] = useState(false);
  const changes = changedFields(post, draft);
  const dirty = Object.keys(changes).length > 0;
  const live = isLive(post);
  useUnsavedWork(dirty || saving);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const set = (key: EditableField) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-sf text-lg font-bold">Editar texto</h2>
        <Button variant="outline" size="sm" onClick={() => setPreviewing((p) => !p)}>
          {previewing ? 'Voltar ao texto' : 'Ver prévia'}
        </Button>
      </div>

      {live && (
        <p className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-foreground">
          Este post está no ar. Salvar publica o texto novo.
        </p>
      )}

      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3"
        >
          <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <AlertTriangle size={14} aria-hidden="true" />
            Este post mudou enquanto você editava. Copie seu texto e recarregue.
          </p>
          <Button variant="outline" size="sm" onClick={onReload} disabled={saving}>
            Recarregar
          </Button>
        </div>
      )}

      {errors.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <AlertTriangle size={14} aria-hidden="true" />
            Corrija antes de salvar
          </p>
          <ul className="mt-1.5 list-disc pl-5 text-sm text-foreground">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {previewing ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <BlogPreview post={{ ...post, ...draft }} />
        </div>
      ) : (
        <>
          {FIELDS.map((f) => {
            const id = `${uid}-${f.key}`;
            const common = {
              id,
              value: draft[f.key],
              onChange: (e: { target: { value: string } }) => set(f.key)(e.target.value),
            };
            return (
              <div key={f.key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor={id}>{f.label}</Label>
                  <Counter value={draft[f.key]} limits={FIELD_LIMITS[f.key]} />
                </div>
                {f.multiline ? <Textarea rows={3} {...common} /> : <Input {...common} />}
              </div>
            );
          })}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor={`${uid}-body`}>Corpo (Markdown)</Label>
              <Counter value={draft.body_md} limits={FIELD_LIMITS.body_md} />
            </div>
            <Textarea
              id={`${uid}-body`}
              value={draft.body_md}
              onChange={(e) => set('body_md')(e.target.value)}
              rows={20}
              spellCheck
              className="font-mono text-[13px] leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">
              Imagens no formato ![alt](img:chave). Sem HTML.
            </p>
          </div>
        </>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={() => onSave(changes)} disabled={!dirty || saving || conflict}>
          {live ? 'Salvar e publicar' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}

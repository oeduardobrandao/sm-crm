import { useId, useRef, type ReactNode } from 'react';
import { Eye, Loader2, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import {
  KB_CATEGORIES as CATEGORIES,
  ALL_KB_CATEGORIES as ALL_CATEGORIES,
} from '../../lib/kb-categories';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/PageHeader';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Button } from '../../components/ui/button';
import { STATUS_LABELS, routeLabel, type KbArticleEditorViewProps } from './editor-view';

const FIELD =
  'h-9 w-full min-w-0 rounded-[10px] border border-border bg-foreground/[0.06] px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none';

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const errId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">
        {label}
      </label>
      {children(id, error ? errId : undefined)}
      {error && (
        <p id={errId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function KbArticleEditorDesktop(p: KbArticleEditorViewProps) {
  const coverInputRef = useRef<HTMLInputElement>(null);
  const { values: v, set } = p;

  return (
    <div data-admin-wide>
      <PageHeader
        title={p.isEdit ? 'Editar artigo' : 'Novo artigo'}
        description={p.saveState}
        back={{ to: '/admin/kb-articles', label: 'Artigos' }}
        actions={
          <>
            {p.onDelete && (
              <Button variant="destructive" onClick={p.onDelete} disabled={p.deleting}>
                <Trash2 aria-hidden="true" />
                Excluir
              </Button>
            )}
            {v.status !== 'published' && (
              <Button variant="secondary" onClick={p.onPublish} disabled={!p.canSave || p.saving}>
                <Eye aria-hidden="true" />
                Publicar
              </Button>
            )}
            <Button onClick={p.onSave} disabled={!p.canSave || p.saving}>
              <Save aria-hidden="true" />
              {p.saving ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[2_1_560px]">
          <GlassPanel flush>
            <div className="px-[34px] pb-1 pt-6">
              <input
                type="text"
                aria-label="Título"
                aria-required="true"
                value={v.title}
                onChange={(e) => set.title(e.target.value)}
                placeholder="Título do artigo"
                className="w-full bg-transparent font-sf text-[28px] font-bold leading-tight text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
            <div className="min-h-[420px] [&_.post-editor-content]:px-[34px] [&_.post-editor-content]:pb-10 [&_.post-editor-toolbar]:flex-wrap [&_.post-editor-toolbar]:border-t [&_.post-editor-toolbar]:px-3">
              {p.editor}
            </div>
          </GlassPanel>
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <GlassPanel title="Detalhes" titleId="kb-article-details">
            <div className="flex flex-col gap-3">
              <Field label="Slug" error={p.slugError}>
                {(id, describedBy) => (
                  <input
                    id={id}
                    type="text"
                    aria-required="true"
                    aria-invalid={p.slugError ? true : undefined}
                    aria-describedby={describedBy}
                    value={v.slug}
                    onChange={(e) => set.slug(e.target.value)}
                    placeholder="como-adicionar-um-cliente"
                    className={cn(
                      FIELD,
                      'font-mono text-[13px]',
                      p.slugError && 'border-destructive',
                    )}
                  />
                )}
              </Field>
              <Field label="Categoria">
                {(id) => (
                  <select
                    id={id}
                    aria-required="true"
                    value={v.category}
                    onChange={(e) => set.category(e.target.value)}
                    className={FIELD}
                  >
                    <option value="">Selecionar categoria</option>
                    {ALL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORIES[c]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Status">
                {(id) => (
                  <select
                    id={id}
                    value={v.status}
                    onChange={(e) => set.status(e.target.value as 'draft' | 'published')}
                    className={FIELD}
                  >
                    <option value="draft">{STATUS_LABELS.draft}</option>
                    <option value="published">{STATUS_LABELS.published}</option>
                  </select>
                )}
              </Field>
              <Field label="Resumo">
                {(id) => (
                  <textarea
                    id={id}
                    value={v.excerpt}
                    onChange={(e) => set.excerpt(e.target.value)}
                    placeholder="Breve descrição do artigo (até 200 caracteres)"
                    rows={2}
                    maxLength={200}
                    className={cn(FIELD, 'h-auto resize-none py-2')}
                  />
                )}
              </Field>
              <Field label="Tags">
                {(id) => (
                  <input
                    id={id}
                    type="text"
                    value={v.tags}
                    onChange={(e) => set.tags(e.target.value)}
                    placeholder="instagram, tutorial, básico"
                    className={FIELD}
                  />
                )}
              </Field>
              <Field label="Ordem de exibição">
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={0}
                    value={v.displayOrder}
                    onChange={(e) => set.displayOrder(e.target.value)}
                    className={cn(FIELD, 'tabular-nums')}
                  />
                )}
              </Field>
              <Field label="Imagem de capa">
                {(id) => (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        id={id}
                        type="text"
                        value={v.coverUrl}
                        onChange={(e) => set.coverUrl(e.target.value)}
                        placeholder="https://... ou envie uma imagem"
                        className={cn(FIELD, 'flex-1 font-mono text-[13px]')}
                      />
                      <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) p.onCoverFile(file);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        aria-label={p.coverUploading ? 'Enviando imagem…' : 'Enviar imagem'}
                        onClick={() => coverInputRef.current?.click()}
                        disabled={p.coverUploading}
                      >
                        {p.coverUploading ? (
                          <Loader2 className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Upload aria-hidden="true" />
                        )}
                      </Button>
                      {v.coverUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remover capa"
                          onClick={() => set.coverUrl('')}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                    {p.coverPreview && (
                      <div className="overflow-hidden rounded-xl border border-border">
                        <img
                          src={p.coverPreview}
                          alt="Prévia da capa"
                          className="max-h-40 w-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                )}
              </Field>
            </div>
          </GlassPanel>

          <GlassPanel title="Contexto" titleId="kb-article-context">
            {p.contextEnabled ? (
              <>
                <p className="mb-2.5 text-[13px] text-muted-foreground">
                  O artigo aparece como sugestão nestas telas do CRM.
                </p>
                {p.contextLinks.length > 0 && (
                  <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="Telas do CRM">
                    {p.contextLinks.map((link) => {
                      const label = routeLabel(link.route_pattern);
                      return (
                        <li
                          key={link.id}
                          className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.1] py-1 pl-3 pr-1 text-xs text-foreground"
                        >
                          {label}
                          <button
                            type="button"
                            aria-label={`Remover ${label}`}
                            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/[0.12] hover:text-foreground"
                            onClick={() => p.onRemoveContextLink(link.id)}
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Tela do CRM"
                    value={p.selectedRoute}
                    onChange={(e) => p.onSelectedRouteChange(e.target.value)}
                    className={cn(FIELD, 'flex-1')}
                  >
                    <option value="">Selecionar tela</option>
                    {p.availableRoutes.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={p.onAddContextLink}
                    disabled={!p.selectedRoute}
                  >
                    <Plus aria-hidden="true" />
                    Adicionar
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                Salve o artigo para escolher em quais telas do CRM ele aparece.
              </p>
            )}
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}

import { Save, Trash2 } from 'lucide-react';
import { kbVideosPath } from '../../lib/routes';
import { PageHeader } from '../../components/PageHeader';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Button } from '../../components/ui/button';
import { FIELD, LABEL } from './fields';
import { PUBLISH_LOCKED_HINT, type KbVideoEditorViewProps } from './editor-view';
import { VideoFilePanel } from './VideoFilePanel';

/** Desktop editor: details panel beside the file panel; Salvar and Excluir in the header. */
export function KbVideoEditorDesktop(p: KbVideoEditorViewProps) {
  const { values, onChange } = p;
  const uploading = p.progress !== null;
  return (
    <div data-admin-wide>
      <PageHeader
        title={p.isEdit ? 'Editar vídeo' : 'Novo vídeo'}
        back={{ to: kbVideosPath(), label: 'Vídeos' }}
        actions={
          <>
            {p.video && (
              <Button variant="destructive" disabled={p.deleting || uploading} onClick={p.onDelete}>
                <Trash2 /> Excluir
              </Button>
            )}
            <Button onClick={p.onSave} disabled={p.saving || p.saveDisabled}>
              <Save /> {p.saving ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <GlassPanel title="Detalhes">
          <div className="flex flex-col gap-5">
            <div>
              <label htmlFor="video-title" className={LABEL}>
                Título
              </label>
              <input
                id="video-title"
                className={FIELD}
                value={values.title}
                maxLength={200}
                onChange={(e) => onChange({ title: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="video-slug" className={LABEL}>
                Slug
              </label>
              <input
                id="video-slug"
                className={FIELD}
                value={values.slug}
                onChange={(e) => onChange({ slug: e.target.value })}
              />
              {p.slugError && <p className="mt-1 text-xs text-destructive">{p.slugError}</p>}
            </div>
            <div>
              <label htmlFor="video-description" className={LABEL}>
                Descrição
              </label>
              <textarea
                id="video-description"
                className={FIELD}
                rows={3}
                maxLength={500}
                value={values.description}
                onChange={(e) => onChange({ description: e.target.value })}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="video-series" className={LABEL}>
                  Série
                </label>
                <select
                  id="video-series"
                  className={FIELD}
                  value={values.seriesId}
                  onChange={(e) => onChange({ seriesId: e.target.value })}
                >
                  {p.seriesOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="video-article" className={LABEL}>
                  Artigo relacionado
                </label>
                <select
                  id="video-article"
                  className={FIELD}
                  value={values.articleId}
                  onChange={(e) => onChange({ articleId: e.target.value })}
                >
                  <option value="">Nenhum</option>
                  {p.articleOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="video-order" className={LABEL}>
                  Ordem
                </label>
                <input
                  id="video-order"
                  type="number"
                  min={0}
                  max={10000}
                  className={FIELD}
                  value={values.displayOrder}
                  onChange={(e) => onChange({ displayOrder: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="video-status" className={LABEL}>
                  Status
                </label>
                <select
                  id="video-status"
                  className={FIELD}
                  value={values.status}
                  onChange={(e) => onChange({ status: e.target.value as 'draft' | 'published' })}
                >
                  <option value="draft">Rascunho</option>
                  <option value="published" disabled={p.publishLocked}>
                    Publicado
                  </option>
                </select>
                {p.publishLocked && (
                  <p className="mt-1 text-xs text-muted-foreground">{PUBLISH_LOCKED_HINT}</p>
                )}
              </div>
            </div>
          </div>
        </GlassPanel>

        <GlassPanel title="Arquivo">
          <VideoFilePanel
            video={p.video}
            badge={p.badge}
            progress={p.progress}
            fileInputRef={p.fileInputRef}
            onFile={p.onFile}
            onCancelUpload={p.onCancelUpload}
            fetching={p.fetching}
          />
        </GlassPanel>
      </div>
    </div>
  );
}

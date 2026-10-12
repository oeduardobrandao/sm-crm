import { Trash2 } from 'lucide-react';
import { FormRow, GroupedList, PhoneIconButton, PickerCell } from '@mesaas/ios-kit';
import { kbVideosPath } from '../../lib/routes';
import { PageHeader } from '../../components/PageHeader';
import { STATUS_OPTIONS } from './fields';
import { PUBLISH_LOCKED_HINT, type KbVideoEditorViewProps } from './editor-view';
import { VideoFilePanel } from './VideoFilePanel';

/** Phone editor: pushed screen (nav bar with Excluir + Salvar), file card, grouped form rows. */
export function KbVideoEditorPhone(p: KbVideoEditorViewProps) {
  const { values, onChange } = p;
  const uploading = p.progress !== null;
  return (
    <div className="phone-kit">
      <PageHeader
        title={p.isEdit ? 'Editar vídeo' : 'Novo vídeo'}
        back={{ to: kbVideosPath(), label: 'Vídeos' }}
        phoneActions={
          <>
            {p.video && (
              <PhoneIconButton
                label="Excluir vídeo"
                disabled={p.deleting || uploading}
                onClick={p.onDelete}
              >
                <Trash2 aria-hidden="true" className="text-destructive" />
              </PhoneIconButton>
            )}
            <button
              type="button"
              onClick={p.onSave}
              disabled={p.saving || p.saveDisabled}
              className="h-9 rounded-full bg-primary px-3.5 text-[15px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {p.saving ? 'Salvando…' : 'Salvar'}
            </button>
          </>
        }
      />

      <h2 className="mb-1.5 ml-4 mt-3.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
        Arquivo
      </h2>
      <div className="mb-5 rounded-2xl bg-card p-3">
        <VideoFilePanel
          phone
          video={p.video}
          badge={p.badge}
          progress={p.progress}
          fileInputRef={p.fileInputRef}
          onFile={p.onFile}
          onCancelUpload={p.onCancelUpload}
          fetching={p.fetching}
        />
      </div>

      <GroupedList aria-label="Dados do vídeo">
        <FormRow
          label="Título"
          input={{
            value: values.title,
            maxLength: 200,
            onChange: (e) => onChange({ title: e.target.value }),
          }}
        />
        <FormRow
          label="Slug"
          error={p.slugError}
          input={{
            value: values.slug,
            autoCapitalize: 'none',
            autoCorrect: 'off',
            onChange: (e) => onChange({ slug: e.target.value }),
          }}
        />
        <FormRow
          label="Descrição"
          textarea={{
            value: values.description,
            maxLength: 500,
            onChange: (e) => onChange({ description: e.target.value }),
          }}
        />
      </GroupedList>

      <GroupedList
        aria-label="Publicação"
        footer={p.publishLocked ? PUBLISH_LOCKED_HINT : undefined}
      >
        <PickerCell
          label="Série"
          options={p.seriesOptions.map((s) => ({ value: s.id, label: s.title }))}
          value={values.seriesId || null}
          onChange={(v) => v && onChange({ seriesId: v })}
        />
        <PickerCell
          label="Artigo relacionado"
          options={p.articleOptions.map((a) => ({ value: a.id, label: a.title }))}
          emptyOption={{ label: 'Nenhum' }}
          searchable
          value={values.articleId || null}
          onChange={(v) => onChange({ articleId: v ?? '' })}
        />
        <FormRow
          label="Ordem"
          input={{
            type: 'number',
            inputMode: 'numeric',
            min: 0,
            max: 10000,
            value: values.displayOrder,
            onChange: (e) => onChange({ displayOrder: e.target.value }),
          }}
        />
        <PickerCell
          label="Status"
          options={STATUS_OPTIONS.map((o) => ({
            ...o,
            disabled: o.value === 'published' && p.publishLocked,
          }))}
          value={values.status}
          onChange={(v) => v && onChange({ status: v })}
        />
      </GroupedList>
    </div>
  );
}

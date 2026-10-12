import { useId, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Cell, CheckList, FormRow, GroupedList, SegmentedControl } from '@mesaas/ios-kit';
import { defaultSecondaryLabel } from '@mesaas/ui/PopupCard';
import type { PopupFrequency, PopupTrigger } from '../../lib/api';
import { TargetPicker } from '../../components/TargetPicker';
import { MAX_TRIGGER_DAYS, TRIGGER_LABEL, type PopupFormState } from '../popup-form';
import { PopupPageList } from './PopupPageList';
import { PopupPreview } from './PopupPreview';
import {
  STATUSES,
  STATUS_LABELS,
  splitCtaError,
  type EditorSection,
  type PopupEditorModel,
} from './editor-model';

const SECTION_HEADER = 'phone-group__header';
const ERROR = 'mx-4 -mt-3 mb-4 text-[13px] text-destructive';

function PagePanel({ m }: { m: PopupEditorModel }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { page, pageIndex } = m;
  const pageErrors = m.errors?.pages[pageIndex];
  const imageUrl = page.image_key ? m.imageUrls?.[page.image_key] : undefined;
  return (
    <>
      <div className="mb-3.5">
        <PopupPageList
          orientation="horizontal"
          pages={m.form.pages}
          pageIndex={pageIndex}
          errors={m.errors}
          onSelect={m.selectPage}
          onRemove={m.removePage}
          onAdd={m.addPage}
          onDragEnd={m.dragEnd}
        />
      </div>

      <GroupedList aria-label="Textos da página">
        <FormRow
          label="Título"
          layout="stacked"
          error={pageErrors?.title}
          input={{
            id: 'popup-title',
            value: page.title,
            maxLength: 120,
            onChange: (e) => m.updatePage({ title: e.target.value }),
          }}
        />
        <FormRow
          label="Sobretítulo (opcional)"
          layout="stacked"
          error={pageErrors?.eyebrow}
          input={{
            id: 'popup-eyebrow',
            value: page.eyebrow,
            maxLength: 60,
            onChange: (e) => m.updatePage({ eyebrow: e.target.value }),
          }}
        />
      </GroupedList>

      <section className="phone-group">
        <h2 className={SECTION_HEADER}>Imagem (16:9, até 10 MB)</h2>
        <div
          className="flex items-center gap-3 rounded-[16px] p-2.5"
          style={{ background: 'var(--phone-cell)' }}
        >
          <div className="aspect-video w-28 shrink-0 overflow-hidden rounded-[10px] bg-foreground/[0.08]">
            {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-cover" />}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) m.upload(f);
              e.target.value = '';
            }}
          />
          <div className="flex flex-col items-start gap-1.5">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={m.uploading}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-foreground/[0.12] px-3 text-[15px] disabled:opacity-50"
            >
              {m.uploading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {m.uploading ? 'Enviando…' : page.image_key ? 'Substituir' : 'Enviar imagem'}
            </button>
            {page.image_key && (
              <button
                type="button"
                onClick={() => m.updatePage({ image_key: '' })}
                className="h-8 px-3 text-[15px] text-destructive"
              >
                Remover
              </button>
            )}
          </div>
        </div>
      </section>

      <GroupedList aria-label="Corpo da página">
        <FormRow
          label="Corpo (Markdown)"
          error={pageErrors?.body}
          textarea={{
            id: 'popup-body',
            rows: 4,
            maxLength: 2000,
            value: page.body,
            onChange: (e) => m.updatePage({ body: e.target.value }),
          }}
        />
      </GroupedList>

      <GroupedList
        header="CTA desta página"
        footer={pageErrors?.cta ? undefined : 'Sobrescreve o CTA do popup nesta página.'}
      >
        <FormRow
          label="Rótulo"
          input={{
            id: 'popup-page-cta-label',
            value: page.cta_label,
            maxLength: 40,
            onChange: (e) => m.updatePage({ cta_label: e.target.value }),
          }}
        />
        <FormRow
          label="URL"
          error={pageErrors?.cta}
          input={{
            id: 'popup-page-cta-url',
            value: page.cta_url,
            placeholder: '/ajuda/... ou https://...',
            inputMode: 'url',
            onChange: (e) => m.updatePage({ cta_url: e.target.value }),
          }}
        />
      </GroupedList>
    </>
  );
}

function SettingsPanel({ m }: { m: PopupEditorModel }) {
  const { form, errors } = m;
  const ctaErrors = splitCtaError(errors);
  return (
    <>
      <GroupedList header="CTA do popup" footer="Vale para todas as páginas.">
        <FormRow
          label="Rótulo"
          input={{
            id: 'popup-cta-label',
            value: form.cta_label,
            maxLength: 40,
            onChange: (e) => m.patchForm({ cta_label: e.target.value }),
          }}
        />
        <FormRow
          label="URL"
          error={ctaErrors.cta}
          input={{
            id: 'popup-cta-url',
            value: form.cta_url,
            placeholder: '/ajuda/... ou https://...',
            inputMode: 'url',
            onChange: (e) => m.patchForm({ cta_url: e.target.value }),
          }}
        />
        <FormRow
          label="Secundário"
          error={ctaErrors.secondary}
          input={{
            id: 'popup-secondary',
            value: form.secondary_label,
            maxLength: 40,
            placeholder: defaultSecondaryLabel(form.require_ack, m.lastHasCta),
            onChange: (e) => m.patchForm({ secondary_label: e.target.value }),
          }}
        />
      </GroupedList>

      <section className="phone-group">
        <h2 className={SECTION_HEADER}>Estilo do CTA</h2>
        <SegmentedControl
          aria-label="Estilo do CTA"
          options={[
            { value: 'ink', label: 'Tinta' },
            { value: 'brand', label: 'Amarelo da marca' },
          ]}
          value={form.cta_style}
          onChange={(cta_style) => m.patchForm({ cta_style })}
        />
      </section>

      <CheckList<PopupFrequency>
        header="Frequência"
        options={[
          { value: 'once', label: 'Uma vez por usuário' },
          {
            value: 'until_cta',
            label: 'Toda sessão até clicar no CTA',
            disabled: form.require_ack,
          },
          {
            value: 'daily',
            label: 'Uma vez por dia',
            subtitle: 'No máximo uma vez por dia enquanto o popup estiver elegível.',
          },
        ]}
        value={form.frequency}
        onChange={(frequency) => {
          if (frequency) m.patchForm({ frequency });
        }}
      />
      {errors?.frequency && <p className={ERROR}>{errors.frequency}</p>}

      <GroupedList aria-label="Confirmação" footer="Sem X, sem clique fora, sem Esc.">
        <Cell
          label="Exigir confirmação"
          switch={{ checked: form.require_ack, onCheckedChange: m.setRequireAck }}
        />
      </GroupedList>

      <section className="phone-group">
        <div className="rounded-[16px] p-4" style={{ background: 'var(--phone-cell)' }}>
          <TargetPicker
            value={{
              target_mode: form.target_mode,
              target_plan_ids: form.target_plan_ids,
              target_workspace_ids: form.target_workspace_ids,
            }}
            plans={m.plans}
            workspaces={m.workspaces}
            onChange={(next) => m.patchForm(next)}
          />
        </div>
        {errors?.target && <p className="phone-group__footer text-destructive">{errors.target}</p>}
      </section>

      <GroupedList
        header="Condição de exibição"
        footer={
          errors?.trigger
            ? undefined
            : 'Com gatilho, só o dono do workspace vê o popup, e só enquanto a condição valer.'
        }
      >
        <FormRow label="Gatilho" error={errors?.trigger} id="popup-trigger">
          {(field) => (
            <select
              {...field}
              className="phone-field__select"
              value={form.trigger}
              onChange={(e) =>
                m.patchForm(
                  { trigger: e.target.value as PopupFormState['trigger'] },
                  { clearErrors: true },
                )
              }
            >
              <option value="">Nenhum</option>
              {(Object.keys(TRIGGER_LABEL) as PopupTrigger[]).map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_LABEL[t]}
                </option>
              ))}
            </select>
          )}
        </FormRow>
        {form.trigger === 'trial_ending' && (
          <FormRow
            label="Dias antes do fim do teste"
            input={{
              id: 'popup-trigger-days',
              type: 'number',
              inputMode: 'numeric',
              min: 1,
              max: MAX_TRIGGER_DAYS,
              // Sem o stepper nativo: o valor fica como texto, igual aos limites.
              className:
                '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
              value: form.trigger_days,
              onChange: (e) => m.patchForm({ trigger_days: e.target.value }, { clearErrors: true }),
            }}
          />
        )}
      </GroupedList>

      <GroupedList header="Agendamento">
        <FormRow label="Começa em" id="popup-starts">
          {(field) => (
            <input
              {...field}
              type="datetime-local"
              className="phone-form-row__input"
              value={form.starts_at}
              onChange={(e) => m.patchForm({ starts_at: e.target.value })}
            />
          )}
        </FormRow>
        <FormRow label="Termina em" id="popup-ends" error={errors?.schedule}>
          {(field) => (
            <input
              {...field}
              type="datetime-local"
              className="phone-form-row__input"
              value={form.ends_at}
              onChange={(e) => m.patchForm({ ends_at: e.target.value })}
            />
          )}
        </FormRow>
        <FormRow label="Status" id="popup-status">
          {(field) => (
            <select
              {...field}
              className="phone-field__select"
              value={form.status}
              onChange={(e) => m.patchForm({ status: e.target.value as PopupFormState['status'] })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
        </FormRow>
      </GroupedList>

      {m.canDelete && (
        <GroupedList aria-label="Ações">
          <Cell label="Excluir popup" destructive onClick={m.onDelete} disabled={m.deleting} />
        </GroupedList>
      )}
    </>
  );
}

/** Editor no iPhone (PopupEditor): Páginas · Configurações · Prévia. */
export function PopupEditorPhone({ m }: { m: PopupEditorModel }) {
  const uid = useId();
  const sections: { value: EditorSection; label: string }[] = [
    { value: 'pages', label: 'Páginas' },
    { value: 'settings', label: 'Configurações' },
    { value: 'preview', label: 'Prévia' },
  ];
  const tab = (s: EditorSection) => `${uid}-${s}-tab`;
  const panel = (s: EditorSection) => `${uid}-${s}-panel`;

  return (
    <div className="phone-kit">
      <SegmentedControl
        semantics="tablist"
        aria-label="Seções do popup"
        className="mb-3.5"
        options={sections.map((s) => ({ ...s, id: tab(s.value), controls: panel(s.value) }))}
        value={m.section}
        onChange={m.setSection}
      />
      {sections.map(({ value }) => (
        <div
          key={value}
          role="tabpanel"
          id={panel(value)}
          aria-labelledby={tab(value)}
          hidden={m.section !== value}
        >
          {value === 'pages' && <PagePanel m={m} />}
          {value === 'settings' && <SettingsPanel m={m} />}
          {value === 'preview' && <PopupPreview m={m} />}
        </div>
      ))}
    </div>
  );
}

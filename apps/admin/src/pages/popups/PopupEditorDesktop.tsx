import { useId, useRef, type ReactNode } from 'react';
import { Loader2, Trash2, Upload } from 'lucide-react';
import { SegmentedControl } from '@mesaas/ios-kit';
import { defaultSecondaryLabel } from '@mesaas/ui/PopupCard';
import type { PopupTrigger } from '../../lib/api';
import { TargetPicker } from '../../components/TargetPicker';
import { Button } from '../../components/ui/button';
import { MAX_TRIGGER_DAYS, TRIGGER_LABEL, type PopupFormState } from '../popup-form';
import { PopupPageList } from './PopupPageList';
import { PopupPreview } from './PopupPreview';
import { STATUSES, STATUS_LABELS, splitCtaError, type PopupEditorModel } from './editor-model';

const INPUT =
  'h-9 w-full rounded-[10px] border border-border bg-foreground/[0.06] px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none';
const LABEL = 'mb-1.5 block text-xs font-semibold text-muted-foreground';
const HINT = 'mt-1 text-xs text-muted-foreground';
const ERROR = 'mt-1 text-xs text-destructive';

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id?: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      {id ? (
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
      ) : (
        <span className={LABEL}>{label}</span>
      )}
      {children}
      {hint && <p className={HINT}>{hint}</p>}
      {error && <p className={ERROR}>{error}</p>}
    </div>
  );
}

function PageFields({ m }: { m: PopupEditorModel }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { page, pageIndex } = m;
  const pageErrors = m.errors?.pages[pageIndex];
  const imageUrl = page.image_key ? m.imageUrls?.[page.image_key] : undefined;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3">
        <Field id="popup-title" label="Título" error={pageErrors?.title}>
          <input
            id="popup-title"
            className={INPUT}
            value={page.title}
            maxLength={120}
            onChange={(e) => m.updatePage({ title: e.target.value })}
          />
        </Field>
        <Field id="popup-eyebrow" label="Sobretítulo (opcional)" error={pageErrors?.eyebrow}>
          <input
            id="popup-eyebrow"
            className={INPUT}
            value={page.eyebrow}
            maxLength={60}
            onChange={(e) => m.updatePage({ eyebrow: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Imagem (opcional, 16:9 recomendado, até 10 MB)">
        <div className="flex items-center gap-2.5">
          <div className="aspect-video w-40 shrink-0 overflow-hidden rounded-[10px] bg-foreground/[0.08]">
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => fileInput.current?.click()}
              disabled={m.uploading}
            >
              {m.uploading ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Upload aria-hidden="true" />
              )}
              {m.uploading ? 'Enviando…' : page.image_key ? 'Substituir' : 'Enviar'}
            </Button>
            {page.image_key && (
              <button
                type="button"
                onClick={() => m.updatePage({ image_key: '' })}
                className="text-[13px] text-destructive hover:underline"
              >
                Remover
              </button>
            )}
          </div>
        </div>
      </Field>

      <Field id="popup-body" label="Corpo (Markdown)" error={pageErrors?.body}>
        <textarea
          id="popup-body"
          rows={4}
          maxLength={2000}
          value={page.body}
          onChange={(e) => m.updatePage({ body: e.target.value })}
          className={`${INPUT} h-auto resize-y py-2.5`}
        />
      </Field>

      <div>
        <div className="grid grid-cols-[1fr_1.4fr] gap-3">
          <Field id="popup-page-cta-label" label="Rótulo do CTA da página">
            <input
              id="popup-page-cta-label"
              className={INPUT}
              maxLength={40}
              value={page.cta_label}
              onChange={(e) => m.updatePage({ cta_label: e.target.value })}
            />
          </Field>
          <Field id="popup-page-cta-url" label="URL do CTA da página">
            <input
              id="popup-page-cta-url"
              className={INPUT}
              placeholder="/ajuda/... or https://..."
              value={page.cta_url}
              onChange={(e) => m.updatePage({ cta_url: e.target.value })}
            />
          </Field>
        </div>
        <p className={HINT}>Sobrescreve o CTA do popup nesta página.</p>
        {pageErrors?.cta && <p className={ERROR}>{pageErrors.cta}</p>}
      </div>
    </div>
  );
}

function SettingsFields({ m }: { m: PopupEditorModel }) {
  const { form, errors } = m;
  const ctaErrors = splitCtaError(errors);
  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        Valem para todas as páginas
      </p>
      <div>
        <div className="grid grid-cols-[1fr_1.4fr] gap-3">
          <Field id="popup-cta-label" label="Rótulo do CTA">
            <input
              id="popup-cta-label"
              className={INPUT}
              maxLength={40}
              value={form.cta_label}
              onChange={(e) => m.patchForm({ cta_label: e.target.value })}
            />
          </Field>
          <Field id="popup-cta-url" label="URL do CTA">
            <input
              id="popup-cta-url"
              className={INPUT}
              placeholder="/ajuda/... or https://..."
              value={form.cta_url}
              onChange={(e) => m.patchForm({ cta_url: e.target.value })}
            />
          </Field>
        </div>
        {ctaErrors.cta && <p className={ERROR}>{ctaErrors.cta}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field id="popup-secondary" label="Rótulo secundário" error={ctaErrors.secondary}>
          <input
            id="popup-secondary"
            className={INPUT}
            maxLength={40}
            value={form.secondary_label}
            placeholder={defaultSecondaryLabel(form.require_ack, m.lastHasCta)}
            onChange={(e) => m.patchForm({ secondary_label: e.target.value })}
          />
        </Field>
        <Field label="Estilo do CTA">
          <SegmentedControl
            aria-label="Estilo do CTA"
            options={[
              { value: 'ink', label: 'Tinta' },
              { value: 'brand', label: 'Amarelo da marca' },
            ]}
            value={form.cta_style}
            onChange={(cta_style) => m.patchForm({ cta_style })}
          />
        </Field>
      </div>

      <fieldset className="min-w-0">
        <legend className={LABEL}>Frequência</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="frequency"
              className="accent-primary"
              checked={form.frequency === 'once'}
              onChange={() => m.patchForm({ frequency: 'once' })}
            />
            Uma vez por usuário
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="frequency"
              className="accent-primary"
              checked={form.frequency === 'until_cta'}
              disabled={form.require_ack}
              onChange={() => m.patchForm({ frequency: 'until_cta' })}
            />
            Toda sessão até clicar no CTA
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="frequency"
              className="accent-primary"
              checked={form.frequency === 'daily'}
              onChange={() => m.patchForm({ frequency: 'daily' })}
            />
            Uma vez por dia
          </label>
        </div>
        <p className={HINT}>
          Uma vez por dia: abre no máximo uma vez por dia enquanto o popup estiver elegível.
        </p>
        {errors?.frequency && <p className={ERROR}>{errors.frequency}</p>}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary"
          checked={form.require_ack}
          onChange={(e) => m.setRequireAck(e.target.checked)}
        />
        Exigir confirmação (sem X, sem clique fora, sem Esc)
      </label>

      <div>
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
        {errors?.target && <p className={ERROR}>{errors.target}</p>}
      </div>

      <Field
        id="popup-trigger"
        label="Gatilho"
        hint="Com gatilho, só o dono do workspace vê o popup, e só enquanto a condição valer."
        error={errors?.trigger}
      >
        <select
          id="popup-trigger"
          className={INPUT}
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
      </Field>
      {form.trigger === 'trial_ending' && (
        <Field id="popup-trigger-days" label="Dias antes do fim do teste">
          <input
            id="popup-trigger-days"
            type="number"
            min={1}
            max={MAX_TRIGGER_DAYS}
            className={INPUT}
            value={form.trigger_days}
            onChange={(e) => m.patchForm({ trigger_days: e.target.value }, { clearErrors: true })}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field id="popup-starts" label="Começa em (opcional)">
          <input
            id="popup-starts"
            type="datetime-local"
            className={INPUT}
            value={form.starts_at}
            onChange={(e) => m.patchForm({ starts_at: e.target.value })}
          />
        </Field>
        <Field id="popup-ends" label="Termina em (opcional)" error={errors?.schedule}>
          <input
            id="popup-ends"
            type="datetime-local"
            className={INPUT}
            value={form.ends_at}
            onChange={(e) => m.patchForm({ ends_at: e.target.value })}
          />
        </Field>
      </div>

      <Field id="popup-status" label="Status">
        <select
          id="popup-status"
          className={INPUT}
          value={form.status}
          onChange={(e) => m.patchForm({ status: e.target.value as PopupFormState['status'] })}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

/** Editor no desktop (DkPopupEditor): páginas · formulário · prévia ao vivo. */
export function PopupEditorDesktop({ m }: { m: PopupEditorModel }) {
  const uid = useId();
  // A prévia é uma coluna fixa no desktop: vindo do iPhone em "Prévia", mostra as páginas.
  const section = m.section === 'settings' ? 'settings' : 'pages';
  const ids = {
    pagesTab: `${uid}-pages-tab`,
    pagesPanel: `${uid}-pages-panel`,
    settingsTab: `${uid}-settings-tab`,
    settingsPanel: `${uid}-settings-panel`,
  };

  return (
    <div className="flex flex-wrap items-start gap-[22px]">
      <div className="w-[180px] shrink-0">
        <SegmentedControl
          semantics="tablist"
          aria-label="Seções do popup"
          className="mb-3"
          options={[
            { value: 'pages', label: 'Páginas', id: ids.pagesTab, controls: ids.pagesPanel },
            {
              value: 'settings',
              label: 'Configurações',
              id: ids.settingsTab,
              controls: ids.settingsPanel,
            },
          ]}
          value={section}
          onChange={m.setSection}
        />
        {section === 'pages' && (
          <PopupPageList
            orientation="vertical"
            pages={m.form.pages}
            pageIndex={m.pageIndex}
            errors={m.errors}
            onSelect={m.selectPage}
            onRemove={m.removePage}
            onAdd={m.addPage}
            onDragEnd={m.dragEnd}
          />
        )}
        {m.canDelete && (
          <Button
            type="button"
            variant="destructive"
            className="mt-6"
            onClick={m.onDelete}
            disabled={m.deleting}
          >
            <Trash2 aria-hidden="true" /> Excluir popup
          </Button>
        )}
      </div>

      <div className="min-w-0 flex-[1_1_300px]">
        <div
          role="tabpanel"
          id={ids.pagesPanel}
          aria-labelledby={ids.pagesTab}
          hidden={section !== 'pages'}
        >
          <PageFields m={m} />
        </div>
        <div
          role="tabpanel"
          id={ids.settingsPanel}
          aria-labelledby={ids.settingsTab}
          hidden={section !== 'settings'}
        >
          <SettingsFields m={m} />
        </div>
      </div>

      <div className="sticky top-0 w-[300px] shrink-0">
        <PopupPreview m={m} />
      </div>
    </div>
  );
}

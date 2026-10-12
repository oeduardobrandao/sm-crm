import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Trash2 } from 'lucide-react';
import { Cell, FormRow, GroupedList } from '@mesaas/ios-kit';
import { TargetPicker } from '../../components/TargetPicker';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { useIsPhone } from '../../hooks/useIsPhone';
import {
  BANNER_TYPES,
  STATUSES,
  STATUS_LABELS,
  TYPE_COLORS,
  LINK_PATTERN,
  TYPE_LABELS,
  type FormState,
} from './banner-form';

interface Option {
  id: string;
  name: string;
}

export interface BannerFormFieldsProps {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  plans: Option[] | undefined;
  workspaces: Option[] | undefined;
  /** Set only when editing a draft: shows the delete control. */
  onDelete?: () => void;
  deleting?: boolean;
}

/** Banner strip as the CRM renders it, fed by the form's current values. */
export function BannerPreview({
  type,
  content,
  customColor,
  link,
  dismissible,
}: {
  type: string;
  content: string;
  customColor: string;
  link: string;
  dismissible: boolean;
}) {
  const tc = TYPE_COLORS[type] || TYPE_COLORS.info;
  const accent = customColor || tc.accent;
  const bg = customColor ? `${customColor}14` : tc.bg;

  return (
    <div
      style={{ background: bg, borderBottom: `1px solid ${accent}33` }}
      className="rounded-lg px-4 py-2.5 flex items-center gap-2"
    >
      <div className="flex-1 text-center text-sm text-foreground">
        {content || 'Prévia do banner…'}
        {link && (
          <span style={{ color: accent }} className="ml-1 underline text-sm">
            Link
          </span>
        )}
      </div>
      {dismissible && <span className="text-muted-foreground text-lg cursor-default">×</span>}
    </div>
  );
}

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * The banner form's fields. The page owns the single <form id> that wraps this and the
 * sheet header submits it, so this renders no form and no Cancel/Save buttons.
 */
export function BannerFormFields(props: BannerFormFieldsProps) {
  return useIsPhone() ? <PhoneFields {...props} /> : <DesktopFields {...props} />;
}

function DesktopFields({
  form,
  setForm,
  plans,
  workspaces,
  onDelete,
  deleting,
}: BannerFormFieldsProps) {
  return (
    <div className="flex flex-col gap-5">
      <Field id="banner-content" label="Conteúdo (Markdown)">
        <Textarea
          id="banner-content"
          value={form.content}
          onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          required
          rows={3}
          className="resize-none"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="banner-link" label="Link (opcional)">
          <Input
            id="banner-link"
            type="text"
            value={form.link}
            onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
            placeholder="https://..."
            pattern={LINK_PATTERN}
            title="https://… ou um caminho iniciado por /"
          />
        </Field>
        <Field id="banner-color" label="Cor personalizada (opcional)">
          <Input
            id="banner-color"
            type="text"
            value={form.custom_color}
            onChange={(e) => setForm((f) => ({ ...f, custom_color: e.target.value }))}
            placeholder="#ff5500"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="banner-type" label="Tipo">
          <select
            id="banner-type"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as FormState['type'] }))}
            className={SELECT_CLASS}
          >
            {BANNER_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="banner-status" label="Status">
          <select
            id="banner-status"
            value={form.status}
            onChange={(e) =>
              setForm((f) => ({ ...f, status: e.target.value as FormState['status'] }))
            }
            className={SELECT_CLASS}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <TargetPicker
        value={{
          target_mode: form.target_mode,
          target_plan_ids: form.target_plan_ids,
          target_workspace_ids: form.target_workspace_ids,
        }}
        plans={plans}
        workspaces={workspaces}
        onChange={(next) => setForm((f) => ({ ...f, ...next }))}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="banner-starts" label="Início (opcional)">
          <Input
            id="banner-starts"
            type="datetime-local"
            value={form.starts_at}
            onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
          />
        </Field>
        <Field id="banner-ends" label="Fim (opcional)">
          <Input
            id="banner-ends"
            type="datetime-local"
            value={form.ends_at}
            onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={form.dismissible}
          onChange={(e) => setForm((f) => ({ ...f, dismissible: e.target.checked }))}
          className="rounded"
        />
        Pode ser fechado
      </label>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Prévia
        </p>
        <BannerPreview
          type={form.type}
          content={form.content}
          customColor={form.custom_color}
          link={form.link}
          dismissible={form.dismissible}
        />
      </div>

      {onDelete && (
        <div>
          <Button type="button" variant="destructive" onClick={onDelete} disabled={deleting}>
            <Trash2 aria-hidden="true" />
            Excluir banner
          </Button>
        </div>
      )}
    </div>
  );
}

function PhoneFields({
  form,
  setForm,
  plans,
  workspaces,
  onDelete,
  deleting,
}: BannerFormFieldsProps) {
  return (
    <div className="phone-kit">
      <GroupedList header="Prévia" className="mb-4">
        <li className="phone-cell px-4 py-3">
          <div className="w-full">
            <BannerPreview
              type={form.type}
              content={form.content}
              customColor={form.custom_color}
              link={form.link}
              dismissible={form.dismissible}
            />
          </div>
        </li>
      </GroupedList>

      <GroupedList aria-label="Mensagem do banner" className="mb-4">
        <FormRow
          label="Conteúdo (Markdown)"
          textarea={{
            value: form.content,
            required: true,
            rows: 3,
            onChange: (e) => setForm((f) => ({ ...f, content: e.target.value })),
          }}
        />
        <FormRow
          label="Link (opcional)"
          input={{
            value: form.link,
            placeholder: 'https://...',
            pattern: LINK_PATTERN,
            title: 'https://… ou um caminho iniciado por /',
            onChange: (e) => setForm((f) => ({ ...f, link: e.target.value })),
          }}
        />
        <FormRow
          label="Cor (opcional)"
          input={{
            value: form.custom_color,
            placeholder: '#ff5500',
            onChange: (e) => setForm((f) => ({ ...f, custom_color: e.target.value })),
          }}
        />
      </GroupedList>

      <GroupedList aria-label="Tipo e status" className="mb-4">
        <FormRow label="Tipo">
          {(field) => (
            <select
              {...field}
              className="phone-form-row__input phone-field__select"
              value={form.type}
              onChange={(e) =>
                setForm((f) => ({ ...f, type: e.target.value as FormState['type'] }))
              }
            >
              {BANNER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </FormRow>
        <FormRow label="Status">
          {(field) => (
            <select
              {...field}
              className="phone-form-row__input phone-field__select"
              value={form.status}
              onChange={(e) =>
                setForm((f) => ({ ...f, status: e.target.value as FormState['status'] }))
              }
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

      <div className="mb-4 px-1">
        <TargetPicker
          value={{
            target_mode: form.target_mode,
            target_plan_ids: form.target_plan_ids,
            target_workspace_ids: form.target_workspace_ids,
          }}
          plans={plans}
          workspaces={workspaces}
          onChange={(next) => setForm((f) => ({ ...f, ...next }))}
        />
      </div>

      <GroupedList header="Agendamento" className="mb-4">
        <FormRow
          label="Início (opcional)"
          input={{
            type: 'datetime-local',
            value: form.starts_at,
            onChange: (e) => setForm((f) => ({ ...f, starts_at: e.target.value })),
          }}
        />
        <FormRow
          label="Fim (opcional)"
          input={{
            type: 'datetime-local',
            value: form.ends_at,
            onChange: (e) => setForm((f) => ({ ...f, ends_at: e.target.value })),
          }}
        />
        <Cell
          label="Pode ser fechado"
          switch={{
            checked: form.dismissible,
            onCheckedChange: (checked) => setForm((f) => ({ ...f, dismissible: checked })),
          }}
        />
      </GroupedList>

      {onDelete && (
        <GroupedList aria-label="Ações">
          <Cell label="Excluir banner" destructive disabled={deleting} onClick={onDelete} />
        </GroupedList>
      )}
    </div>
  );
}

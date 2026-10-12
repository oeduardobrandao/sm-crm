// The limits and features editors. Rendered once by the page, outside the phone/desktop branch,
// so crossing 768px never remounts them twice; AdminFormSheet picks the face per width.
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Cell, GroupedList } from '@mesaas/ios-kit';
import {
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_LABELS,
  RATE_LIMIT_KEYS,
  RATE_LIMIT_LABELS,
  RESOURCE_LIMIT_KEYS,
  RESOURCE_LIMIT_LABELS,
  type Plan,
} from '../../lib/api';
import { formatBytes } from '../workspace-detail-view';
import { AdminFormSheet } from '../../components/shell/AdminFormSheet';
import { cn } from '../../lib/utils';
import { useIsPhone } from '../../hooks/useIsPhone';

const LIMITS_DESCRIPTION = 'Valores diferentes do plano viram override deste workspace.';

export type OverridesPanel = 'limits' | 'features';

export interface OverridesSheetsProps {
  openPanel: OverridesPanel | null;
  plan: Plan | undefined;
  resourceEdits: Record<string, string>;
  setResourceEdits: Dispatch<SetStateAction<Record<string, string>>>;
  featureEdits: Record<string, boolean>;
  setFeatureEdits: Dispatch<SetStateAction<Record<string, boolean>>>;
  isOverridden: (key: string, type: 'resource' | 'feature') => boolean;
  editsDirty: boolean;
  /** True when the panel may close: nothing to lose, or the user confirmed discarding. */
  confirmDiscard: () => boolean;
  /** Resets both panels' edits and closes. */
  discardAndClose: () => void;
  onSave: () => void;
  savePending: boolean;
  onClear: () => void;
  clearPending: boolean;
}

export function OverridesSheets(props: OverridesSheetsProps) {
  const {
    openPanel,
    plan,
    resourceEdits,
    setResourceEdits,
    featureEdits,
    setFeatureEdits,
    isOverridden,
    editsDirty,
    confirmDiscard,
    discardAndClose,
    onSave,
    savePending,
    onClear,
    clearPending,
  } = props;

  const isPhone = useIsPhone();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave();
  };
  const setLimit = (key: string) => (val: string) =>
    setResourceEdits((prev) => ({ ...prev, [key]: val }));
  const limitRow = (key: string, label: string) => (
    <LimitRow
      key={key}
      label={label}
      fieldKey={key}
      value={resourceEdits[key] ?? ''}
      planValue={plan ? (plan[key as keyof Plan] as number | null) : null}
      isOverridden={isOverridden(key, 'resource')}
      onChange={setLimit(key)}
    />
  );
  const restore = (
    <GroupedList aria-label="Padrões do plano" className="mb-0">
      <Cell
        label="Restaurar padrões do plano"
        destructive
        disabled={clearPending}
        onClick={onClear}
      />
    </GroupedList>
  );

  return (
    <>
      <AdminFormSheet
        open={openPanel === 'limits'}
        onOpenChange={(open) => !open && discardAndClose()}
        canClose={confirmDiscard}
        title="Limites de recursos"
        description={LIMITS_DESCRIPTION}
        formId="ws-limits-form"
        submitting={savePending}
        submitDisabled={!editsDirty}
      >
        <form id="ws-limits-form" onSubmit={submit}>
          {isPhone && (
            // The phone sheet keeps its description screen-reader only; the board shows it.
            <p
              aria-hidden="true"
              className="mx-4 mb-4 text-center text-[13px] text-muted-foreground"
            >
              {LIMITS_DESCRIPTION}
            </p>
          )}
          <GroupedList header="Recursos">
            {RESOURCE_LIMIT_KEYS.map((key) => limitRow(key, RESOURCE_LIMIT_LABELS[key]))}
          </GroupedList>
          <GroupedList header="Limites de taxa">
            {RATE_LIMIT_KEYS.map((key) => limitRow(key, RATE_LIMIT_LABELS[key]))}
          </GroupedList>
          {restore}
        </form>
      </AdminFormSheet>

      <AdminFormSheet
        open={openPanel === 'features'}
        onOpenChange={(open) => !open && discardAndClose()}
        canClose={confirmDiscard}
        title="Funcionalidades"
        description="O ponto amarelo marca um override deste workspace."
        formId="ws-features-form"
        submitting={savePending}
        submitDisabled={!editsDirty}
      >
        <form id="ws-features-form" onSubmit={submit}>
          <GroupedList aria-label="Funcionalidades">
            {FEATURE_FLAG_KEYS.map((key) => {
              const overridden = isOverridden(key, 'feature');
              return (
                <Cell
                  key={key}
                  id={`feature-${key}`}
                  label={
                    <span className="inline-flex items-center gap-2">
                      {FEATURE_FLAG_LABELS[key]}
                      {overridden && (
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 shrink-0 rounded-full bg-primary"
                        />
                      )}
                    </span>
                  }
                  subtitle={
                    overridden
                      ? `Override · plano: ${plan?.[key as keyof Plan] ? 'ativa' : 'inativa'}`
                      : undefined
                  }
                  switch={{
                    checked: !!featureEdits[key],
                    onCheckedChange: (checked) =>
                      setFeatureEdits((prev) => ({ ...prev, [key]: checked })),
                  }}
                />
              );
            })}
          </GroupedList>
          {restore}
        </form>
      </AdminFormSheet>
    </>
  );
}

/** Hides the native number stepper (the value reads as plain text, as on the board). */
export const NO_STEPPER =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

/**
 * One limit (board WorkspaceLimites): label and the plan note stacked on the left, the value
 * right-aligned. Built on the kit's cell structure, so it gets the row padding and the inset
 * separator; the label stays on one line and truncates, with the full text in a tooltip.
 */
function LimitRow({
  label,
  fieldKey,
  value,
  planValue,
  isOverridden,
  onChange,
}: {
  label: string;
  fieldKey: string;
  value: string;
  planValue: number | null;
  isOverridden: boolean;
  onChange: (val: string) => void;
}) {
  // Byte quotas are unreadable as raw digits; show them humanized under the label.
  const isBytes = fieldKey.endsWith('_bytes');
  const fmt = (n: number | null) => (n == null ? '—' : isBytes ? formatBytes(n) : String(n));
  const current = value.trim() === '' ? null : Number(value);
  const humanized =
    isBytes && current != null && Number.isFinite(current) ? `${formatBytes(current)} · ` : '';
  const inputId = `limit-${fieldKey}`;
  const noteId = `${inputId}-note`;
  return (
    <li className="phone-cell">
      <div className="phone-cell__main">
        <span className="phone-cell__body">
          <span className="phone-cell__text">
            <label htmlFor={inputId} className="phone-cell__label" title={label}>
              {label}
            </label>
            <span id={noteId} className="phone-cell__subtitle">
              {/* Inner span: the kit's subtitle colour is unlayered and beats a utility on it. */}
              <span className={isOverridden ? 'text-primary' : undefined}>
                {humanized}
                {isOverridden ? 'Override · ' : ''}plano: {fmt(planValue)}
              </span>
            </span>
          </span>
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-describedby={noteId}
            className={cn(
              'min-w-0 shrink-0 rounded-[6px] border-0 bg-transparent p-0 text-right text-[17px] tabular-nums text-[color:var(--phone-label-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-ring',
              NO_STEPPER,
              isBytes ? 'w-32' : 'w-20',
              isOverridden && 'font-semibold text-primary',
            )}
          />
        </span>
      </div>
    </li>
  );
}

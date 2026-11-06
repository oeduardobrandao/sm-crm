import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from './cn';

/** What a custom control receives: wire it to the label and the footnote. */
export interface FormRowField {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export interface FormRowProps {
  label: ReactNode;
  /**
   * `inline`: label on the left, control right-aligned on the same line (iOS forms).
   * `stacked`: small label above a full-width control. Defaults to `stacked` for a
   * textarea and `inline` otherwise.
   */
  layout?: 'inline' | 'stacked';
  /** Small print under the row. */
  helper?: ReactNode;
  /** Validation message; replaces `helper`, turns the row red and marks the control invalid. */
  error?: ReactNode;
  /** Trailing element after the control (a unit, a small button). */
  accessory?: ReactNode;
  /** Renders a text input with these props (works with react-hook-form's `register`). */
  input?: ComponentPropsWithRef<'input'>;
  /** Renders a textarea with these props. */
  textarea?: ComponentPropsWithRef<'textarea'>;
  /** Read-only value (no input/textarea/children). With `onClick` the whole row is a button. */
  value?: ReactNode;
  /** Shown in place of an empty `value`. */
  placeholder?: ReactNode;
  onClick?: () => void;
  /** Disclosure chevron on a read-only row. Defaults to true when it has `onClick`. */
  chevron?: boolean;
  disabled?: boolean;
  /** Custom control. Spread the field props on it so the label and footnote reach it. */
  children?: (field: FormRowField) => ReactNode;
  /** Id of the control. Defaults to `input.id` / `textarea.id`, else a generated one. */
  id?: string;
  className?: string;
}

function joinIds(...ids: (string | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}

/**
 * One row of a grouped form (FClienteForm, FTransacaoForm mockups), built on the
 * `.phone-field` row of the phone post editor. Put it inside a `GroupedList`. The label
 * is a real `<label for>` for inputs, textareas and custom controls; a read-only row's
 * value is named by its label. Helper or error text sits under the row and is linked
 * through `aria-describedby`.
 */
export function FormRow({
  label,
  layout,
  helper,
  error,
  accessory,
  input,
  textarea,
  value,
  placeholder,
  onClick,
  chevron,
  disabled,
  children,
  id,
  className,
}: FormRowProps) {
  const autoId = useId();
  const controlId = id ?? input?.id ?? textarea?.id ?? `${autoId}-control`;
  const labelId = `${autoId}-label`;
  const footId = `${autoId}-foot`;
  const foot = error || helper;
  const kind = input ? 'input' : textarea ? 'textarea' : children ? 'custom' : 'value';
  const resolvedLayout =
    kind === 'value' ? 'inline' : (layout ?? (kind === 'textarea' ? 'stacked' : 'inline'));
  const invalid = error ? (true as const) : undefined;

  const rowClass = cn(
    'phone-cell phone-field phone-form-row',
    `phone-form-row--${resolvedLayout}`,
    kind === 'value' && 'phone-form-row--value',
    error && 'phone-form-row--error',
    disabled && 'phone-form-row--disabled',
    className,
  );

  const footnote = foot ? (
    <p id={footId} className="phone-form-row__foot">
      {foot}
    </p>
  ) : null;

  if (kind === 'value') {
    const empty = value == null || value === '';
    const showChevron = chevron ?? Boolean(onClick);
    const content = (
      <>
        <span id={labelId} className="phone-form-row__label">
          {label}
        </span>
        <span
          className={cn('phone-form-row__value', empty && 'phone-form-row__value--placeholder')}
        >
          {empty ? placeholder : value}
        </span>
        {accessory}
        {showChevron && <ChevronRight className="phone-form-row__chevron" aria-hidden="true" />}
      </>
    );
    return (
      <li className={rowClass}>
        {onClick ? (
          <button
            type="button"
            id={controlId}
            className="phone-form-row__line phone-form-row__button"
            disabled={disabled}
            aria-describedby={foot ? footId : undefined}
            onClick={() => onClick()}
          >
            {content}
          </button>
        ) : (
          <div
            id={controlId}
            className="phone-form-row__line"
            aria-describedby={foot ? footId : undefined}
          >
            {content}
          </div>
        )}
        {footnote}
      </li>
    );
  }

  const describedBy = (own?: string) => joinIds(own, foot ? footId : undefined);
  let control: ReactNode;
  if (kind === 'input' && input) {
    control = (
      <input
        type="text"
        {...input}
        id={controlId}
        disabled={disabled ?? input.disabled}
        aria-describedby={describedBy(input['aria-describedby'])}
        aria-invalid={invalid ?? input['aria-invalid']}
        className={cn('phone-form-row__input', input.className)}
      />
    );
  } else if (kind === 'textarea' && textarea) {
    control = (
      <textarea
        rows={3}
        {...textarea}
        id={controlId}
        disabled={disabled ?? textarea.disabled}
        aria-describedby={describedBy(textarea['aria-describedby'])}
        aria-invalid={invalid ?? textarea['aria-invalid']}
        className={cn('phone-form-row__input phone-form-row__textarea', textarea.className)}
      />
    );
  } else if (children) {
    control = children({
      id: controlId,
      'aria-describedby': describedBy(),
      'aria-invalid': invalid,
    });
  }

  const labelEl = (
    <label id={labelId} htmlFor={controlId} className="phone-form-row__label">
      {label}
    </label>
  );

  // Stacked rows keep the accessory on the label line (as "Sugerir horário" sits next
  // to "Data de postagem"); inline rows end with it.
  return (
    <li className={rowClass}>
      {resolvedLayout === 'stacked' ? (
        <>
          <div className="phone-form-row__head">
            {labelEl}
            {accessory}
          </div>
          {control}
        </>
      ) : (
        <div className="phone-form-row__line">
          {labelEl}
          {control}
          {accessory}
        </div>
      )}
      {footnote}
    </li>
  );
}

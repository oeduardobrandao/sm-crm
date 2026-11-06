import type { ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import './clienteDetalhePhone.css';

/**
 * One text field with Salvar / Cancelar under it, as a grouped-list row: renaming a
 * briefing or a section, editing a question, adding one. Enter saves, Escape cancels,
 * like the desktop inputs. 16px text so iOS doesn't zoom in on focus.
 */
export function PhoneInlineEdit({
  value,
  onChange,
  onSave,
  onCancel,
  label,
  placeholder,
  saveLabel,
  saving,
  autoFocus = true,
  as: Root = 'li',
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  /** Without it there is no Cancelar (the always-there "Nova pergunta" row). */
  onCancel?: () => void;
  /** Accessible name of the field. */
  label: string;
  placeholder?: string;
  saveLabel?: string;
  saving?: boolean;
  autoFocus?: boolean;
  as?: 'li' | 'div';
}) {
  const { t } = useTranslation('clients');
  return (
    <Root className="phone-cli-edit">
      <input
        className="phone-cli-edit__input"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="done"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
          if (e.key === 'Escape') onCancel?.();
        }}
      />
      <span className="phone-cli-edit__actions">
        {onCancel && (
          <button type="button" className="phone-cli-link-button" onClick={onCancel}>
            {t('actions.cancel')}
          </button>
        )}
        <button
          type="button"
          className="phone-cli-cal__step"
          disabled={saving || !value.trim()}
          onClick={onSave}
        >
          {saveLabel ?? t('actions.save')}
        </button>
      </span>
    </Root>
  );
}

/**
 * A row of a Reordenar list: the grip button carries the dnd-kit listeners (so a drag
 * only starts from it, and a plain scroll anywhere else never does) and the row itself
 * moves. Pair it with a TouchSensor that waits for a hold before dragging.
 */
export function PhoneSortableRow({
  id,
  handleLabel,
  children,
  className,
}: {
  id: string;
  /** Accessible name of the grip ("Reordenar pergunta"). */
  handleLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <li
      ref={setNodeRef}
      className={cn(
        'phone-cell phone-cli-sort',
        isDragging && 'phone-cli-sort--dragging',
        className,
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className="phone-cli-sort__body">{children}</span>
      <button
        type="button"
        className="phone-cli-sort__handle"
        aria-label={handleLabel}
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" />
      </button>
    </li>
  );
}

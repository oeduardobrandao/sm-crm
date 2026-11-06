import type { ReactNode } from 'react';
import './entityListPhone.css';

export interface PhoneListEmptyProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** One button under the text ("Novo Cliente", "Limpar filtros"). */
  action?: { label: string; onClick: () => void };
}

/** Empty state of a phone list: a white card with a short title, a line and one action. */
export function PhoneListEmpty({ icon, title, description, action }: PhoneListEmptyProps) {
  return (
    <div className="phone-kit phone-el-empty" role="status">
      {icon && (
        <span className="phone-el-empty__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="phone-el-empty__title">{title}</p>
      {description && <p className="phone-el-empty__text">{description}</p>}
      {action && (
        <button type="button" className="phone-el-empty__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

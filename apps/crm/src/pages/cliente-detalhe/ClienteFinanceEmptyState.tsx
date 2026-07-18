import { ArrowRight, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface ClienteFinanceEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}

export function ClienteFinanceEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
}: ClienteFinanceEmptyStateProps) {
  return (
    <div className="cliente-finance-empty">
      <span className="cliente-finance-empty__icon" aria-hidden="true">
        <Icon />
      </span>
      <h4 className="cliente-finance-empty__title">{title}</h4>
      <p className="cliente-finance-empty__description">{description}</p>
      <Button asChild variant="outline" size="sm" className="cliente-finance-empty__action">
        <Link to={actionHref}>
          {actionLabel}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}

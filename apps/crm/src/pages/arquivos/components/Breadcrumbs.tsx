import { ChevronRight } from 'lucide-react';

interface BreadcrumbsProps {
  breadcrumbs: { id: number; name: string }[];
  onNavigate: (folderId: number | null) => void;
}

export function Breadcrumbs({ breadcrumbs, onNavigate }: BreadcrumbsProps) {
  return (
    <nav className="flex items-center gap-1 text-sm flex-wrap">
      <button
        onClick={() => onNavigate(null)}
        className="text-[var(--text-muted)] hover:text-[var(--primary-color)] transition-colors duration-150 font-medium"
      >
        Todos os Arquivos
      </button>

      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1;
        return (
          <span key={crumb.id} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] opacity-50 flex-shrink-0" />
            {isLast ? (
              <span className="text-[var(--text-main)] font-medium truncate max-w-[200px]">
                {crumb.name}
              </span>
            ) : (
              <button
                onClick={() => onNavigate(crumb.id)}
                className="text-[var(--text-muted)] hover:text-[var(--primary-color)] transition-colors duration-150 truncate max-w-[160px]"
              >
                {crumb.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

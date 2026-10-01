import { ChevronDown, ChevronRight } from 'lucide-react';

/** Cabeçalho de um grupo da vista Lista (Agrupar por): a primeira linha do
 *  `<tbody>` do grupo, com `<th scope="rowgroup">` para leitores de tela
 *  anunciarem o grupo de cada linha. O botão recolhe/expande o grupo. */
export function ListGroupHeaderRow({
  label,
  sub,
  count,
  danger = false,
  colSpan,
  collapsed,
  onToggle,
}: {
  label: string;
  sub?: string;
  count: number;
  danger?: boolean;
  colSpan: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="list-group-head">
      <th colSpan={colSpan} scope="rowgroup">
        <button
          type="button"
          className={`list-group-toggle${danger ? ' is-danger' : ''}`}
          aria-expanded={!collapsed}
          aria-label={`${label}${sub ? ` ${sub}` : ''} (${count})`}
          onClick={onToggle}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="list-group-label">{label}</span>
          {sub && <span className="list-group-sub">{sub}</span>}
          <span className="list-group-count">{count}</span>
        </button>
      </th>
    </tr>
  );
}

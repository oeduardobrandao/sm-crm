import type { Cliente } from '@/store';

export interface LinhaEditorialViewProps {
  contaId: string;
  /** Every active client the board already loads (the rail's list). */
  clientes: Cliente[];
  /** `filters.filterClientes`: in this view only the first value is the selected client. */
  filterClientes: number[];
  /** Month being edited, `YYYY-MM`. */
  mes: string;
  /** Writes the selected client and/or month back to the page (and so to the URL). */
  onChange: (q: { clientes?: number[]; mes?: string }) => void;
}

/** Placeholder: Task 8 fills the rail and the table. */
export function LinhaEditorialView(_props: LinhaEditorialViewProps) {
  return <div className="linha-view" />;
}

import type { BoardCard } from '../hooks/useEntregasData';
export function KanbanView(_props: { cards: BoardCard[]; onCardClick: (c: BoardCard) => void; onRefresh: () => void; onRecurring: (id: number) => void; }) {
  return <div>Kanban (em breve)</div>;
}

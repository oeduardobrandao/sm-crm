import type { BoardCard } from '../hooks/useEntregasData';
export function ListView(_props: { cards: BoardCard[]; sort: { column: string; direction: 'asc' | 'desc' }; onSortChange: (s: { column: string; direction: 'asc' | 'desc' }) => void; onCardClick: (c: BoardCard) => void }) {
  return <div>Lista (em breve)</div>;
}

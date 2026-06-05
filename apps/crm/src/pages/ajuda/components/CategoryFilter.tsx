import { CATEGORY_LABELS, ALL_CATEGORIES } from '../categoryConfig';
export { CATEGORY_LABELS, ALL_CATEGORIES };

interface CategoryFilterProps {
  selected: string | null;
  onChange: (category: string | null) => void;
}

export function CategoryFilter({ selected, onChange }: CategoryFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      <button
        type="button"
        className={`shrink-0 rounded-full px-4 py-1.5 text-[0.78rem] font-medium transition-colors ${
          selected === null
            ? 'bg-[var(--primary-color)] text-[var(--dark)]'
            : 'bg-[var(--surface-darker)] text-[var(--text-light)] hover:bg-[var(--surface-hover)]'
        }`}
        onClick={() => onChange(null)}
      >
        Todos
      </button>
      {ALL_CATEGORIES.map((cat) => (
        <button
          key={cat}
          type="button"
          className={`shrink-0 rounded-full px-4 py-1.5 text-[0.78rem] font-medium transition-colors whitespace-nowrap ${
            selected === cat
              ? 'bg-[var(--primary-color)] text-[var(--dark)]'
              : 'bg-[var(--surface-darker)] text-[var(--text-light)] hover:bg-[var(--surface-hover)]'
          }`}
          onClick={() => onChange(cat)}
        >
          {CATEGORY_LABELS[cat]}
        </button>
      ))}
    </div>
  );
}

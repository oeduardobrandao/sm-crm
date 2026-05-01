import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SlidersHorizontal } from 'lucide-react';

export type FileKind = 'image' | 'video' | 'document';

export interface FilterState {
  types: Set<FileKind>;
}

export const EMPTY_FILTER: FilterState = { types: new Set() };

export function isFilterActive(filter: FilterState): boolean {
  return filter.types.size > 0;
}

export function activeFilterCount(filter: FilterState): number {
  return filter.types.size;
}

interface FilterPopoverProps {
  filter: FilterState;
  onChange: (filter: FilterState) => void;
}

const TYPE_OPTIONS: { value: FileKind; label: string; icon: string }[] = [
  { value: 'image', label: 'Imagens', icon: '🖼' },
  { value: 'video', label: 'Vídeos', icon: '🎥' },
  { value: 'document', label: 'Documentos', icon: '📄' },
];

export function FilterPopover({ filter, onChange }: FilterPopoverProps) {
  const count = activeFilterCount(filter);

  function toggleType(type: FileKind) {
    const next = new Set(filter.types);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    onChange({ ...filter, types: next });
  }

  function clearAll() {
    onChange({ ...filter, types: new Set() });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-[var(--border-color)] bg-[var(--surface-main)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>Filtros</span>
          {count > 0 && (
            <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[var(--primary-color)] text-[#12151a] text-[0.6rem] font-bold">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="end">
        <div className="px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-center justify-between">
            <span className="text-[0.65rem] uppercase tracking-wide font-semibold text-[var(--text-muted)]">
              Tipo
            </span>
            {count > 0 && (
              <button
                onClick={clearAll}
                className="text-[0.65rem] text-[var(--primary-color)] hover:underline"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
        <div className="p-1.5">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => toggleType(opt.value)}
              className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-sm hover:bg-[var(--surface-hover)] transition-colors"
            >
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center text-[0.6rem] font-bold transition-colors ${
                  filter.types.has(opt.value)
                    ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[#12151a]'
                    : 'border-[var(--text-muted)]'
                }`}
              >
                {filter.types.has(opt.value) && '✓'}
              </div>
              <span className="text-xs">{opt.icon}</span>
              <span className="text-xs text-[var(--text-main)]">{opt.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

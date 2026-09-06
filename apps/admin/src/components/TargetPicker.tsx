import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from './ui/input';

export type TargetMode = 'all' | 'plan' | 'workspace';

export interface TargetValue {
  target_mode: TargetMode;
  target_plan_ids: string[];
  target_workspace_ids: string[];
}

const TARGET_MODES: TargetMode[] = ['all', 'plan', 'workspace'];
const MODE_LABEL: Record<TargetMode, string> = {
  all: 'Todos',
  plan: 'Por plano',
  workspace: 'Por workspace',
};

interface Option {
  id: string;
  name: string;
}

interface TargetPickerProps {
  value: TargetValue;
  plans: Option[] | undefined;
  workspaces: Option[] | undefined;
  onChange: (next: TargetValue) => void;
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** Minúsculas e sem acento, para a busca casar "Agencia" com "Agência". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function Chips({
  options,
  selected,
  onToggle,
}: {
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <label
            key={o.id}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
              on
                ? 'bg-primary/20 text-foreground border border-primary/50 font-medium'
                : 'bg-secondary text-muted-foreground border border-transparent'
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={on}
              onChange={() => onToggle(o.id)}
            />
            {o.name}
          </label>
        );
      })}
    </div>
  );
}

/** Busca + lista rolável com checkbox. Usada quando a lista é grande (workspaces). */
function SearchableList({
  options,
  selected,
  onToggle,
  onClear,
  placeholder,
  emptyLabel,
}: {
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  placeholder: string;
  emptyLabel: string;
}) {
  const [query, setQuery] = useState('');

  const selectedOptions = useMemo(
    () => options.filter((o) => selected.includes(o.id)),
    [options, selected],
  );

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return options;
    return options.filter((o) => normalize(o.name).includes(q));
  }, [options, query]);

  return (
    <div className="space-y-2">
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedOptions.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg text-xs font-medium bg-primary/20 text-foreground border border-primary/50"
            >
              {o.name}
              <button
                type="button"
                onClick={() => onToggle(o.id)}
                aria-label={`Remover ${o.name}`}
                className="rounded p-0.5 hover:bg-primary/20 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1"
          >
            Limpar
          </button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-8 pl-8 text-sm"
        />
      </div>

      <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">{emptyLabel}</p>
        ) : (
          filtered.map((o) => {
            const on = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className={`flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer transition-colors ${
                  on
                    ? 'bg-primary/10 text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-secondary'
                }`}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 accent-primary cursor-pointer"
                  checked={on}
                  onChange={() => onToggle(o.id)}
                />
                <span className="truncate">{o.name}</span>
              </label>
            );
          })
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {selected.length === 0
          ? 'Nenhum selecionado'
          : `${selected.length} selecionado${selected.length > 1 ? 's' : ''}`}
      </p>
    </div>
  );
}

/** Radios Todos / Por plano / Por workspace + chips. Compartilhado entre Banners e Popups. */
export function TargetPicker({ value, plans, workspaces, onChange }: TargetPickerProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Público
      </label>
      <div className="flex gap-3 mb-3">
        {TARGET_MODES.map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="radio"
              name="target_mode"
              value={m}
              checked={value.target_mode === m}
              onChange={() =>
                onChange({ target_mode: m, target_plan_ids: [], target_workspace_ids: [] })
              }
            />
            {MODE_LABEL[m]}
          </label>
        ))}
      </div>

      {value.target_mode === 'plan' && plans && (
        <Chips
          options={plans}
          selected={value.target_plan_ids}
          onToggle={(id) =>
            onChange({ ...value, target_plan_ids: toggle(value.target_plan_ids, id) })
          }
        />
      )}

      {value.target_mode === 'workspace' && workspaces && (
        <SearchableList
          options={workspaces}
          selected={value.target_workspace_ids}
          onToggle={(id) =>
            onChange({ ...value, target_workspace_ids: toggle(value.target_workspace_ids, id) })
          }
          onClear={() => onChange({ ...value, target_workspace_ids: [] })}
          placeholder="Buscar workspace"
          emptyLabel="Nenhum workspace encontrado"
        />
      )}
    </div>
  );
}

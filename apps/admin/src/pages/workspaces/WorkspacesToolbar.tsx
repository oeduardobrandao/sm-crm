import { useEffect, useRef, useState } from 'react';
import { Columns3, Download, Search } from 'lucide-react';
import type { Plan } from '../../lib/api';
import { STATUS_GROUPS, STATUS_GROUP_LABELS } from '../../lib/subscription';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  DENSITY_LABELS,
  WORKSPACE_COLUMNS,
  toggleColumn,
  type ColumnPrefs,
  type Density,
} from '../workspaces-columns';
import {
  ACTIVITY_LABELS,
  CREATED_LABELS,
  OVERRIDES_LABELS,
  type WorkspacesListParams,
} from '../workspaces-params';

const SEARCH_DEBOUNCE_MS = 300;
/** Radix Select can't carry an empty-string value, so "all" is a sentinel that maps back to ''. */
const ALL = '__all__';

interface WorkspacesToolbarProps {
  params: WorkspacesListParams;
  plans: Plan[];
  prefs: ColumnPrefs;
  onChange: (patch: Partial<WorkspacesListParams>) => void;
  onPrefs: (prefs: ColumnPrefs) => void;
  onExport: () => void;
  exporting: boolean;
}

interface FilterSelectProps<T extends string> {
  label: string;
  value: T | '';
  allLabel: string;
  options: { value: T; label: string }[];
  onChange: (value: T | '') => void;
}

function FilterSelect<T extends string>({
  label,
  value,
  allLabel,
  options,
  onChange,
}: FilterSelectProps<T>) {
  const active = value !== '';
  return (
    <Select
      value={value === '' ? ALL : value}
      onValueChange={(v) => onChange(v === ALL ? '' : (v as T))}
    >
      <SelectTrigger
        aria-label={label}
        className={cn('h-9 w-auto gap-2', active && 'border-primary/60 bg-primary/10')}
      >
        <span className="text-muted-foreground">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function WorkspacesToolbar({
  params,
  plans,
  prefs,
  onChange,
  onPrefs,
  onExport,
  exporting,
}: WorkspacesToolbarProps) {
  const [text, setText] = useState(params.q);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** Last q this toolbar itself committed; its echo must not overwrite newer typing. */
  const lastSentRef = useRef(params.q);

  // External changes (chip removal, "Limpar filtros", back button) win over local typing;
  // the echo of our own commit does not.
  useEffect(() => {
    if (params.q !== lastSentRef.current) {
      lastSentRef.current = params.q;
      setText(params.q);
    }
  }, [params.q]);

  useEffect(() => {
    if (text === params.q) return;
    const t = setTimeout(() => {
      lastSentRef.current = text;
      onChangeRef.current({ q: text });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, params.q]);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Buscar por nome ou e-mail do dono…"
          className="pl-9"
          aria-label="Buscar workspaces"
        />
      </div>

      <FilterSelect
        label="Plano"
        value={params.plano}
        allLabel="Todos"
        options={plans.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(plano) => onChange({ plano })}
      />
      <FilterSelect
        label="Status"
        value={params.status}
        allLabel="Todos"
        options={STATUS_GROUPS.map((g) => ({ value: g, label: STATUS_GROUP_LABELS[g] }))}
        onChange={(status) => onChange({ status })}
      />
      <FilterSelect
        label="Overrides"
        value={params.overrides}
        allLabel="Todos"
        options={(Object.keys(OVERRIDES_LABELS) as (keyof typeof OVERRIDES_LABELS)[]).map((k) => ({
          value: k,
          label: OVERRIDES_LABELS[k],
        }))}
        onChange={(overrides) => onChange({ overrides })}
      />
      <FilterSelect
        label="Atividade"
        value={params.atividade}
        allLabel="Qualquer"
        options={(Object.keys(ACTIVITY_LABELS) as (keyof typeof ACTIVITY_LABELS)[]).map((k) => ({
          value: k,
          label: ACTIVITY_LABELS[k],
        }))}
        onChange={(atividade) => onChange({ atividade })}
      />
      <FilterSelect
        label="Criado"
        value={params.criado}
        allLabel="Qualquer data"
        options={(Object.keys(CREATED_LABELS) as (keyof typeof CREATED_LABELS)[]).map((k) => ({
          value: k,
          label: CREATED_LABELS[k],
        }))}
        onChange={(criado) => onChange({ criado })}
      />

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Columns3 />
              Colunas
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
            {WORKSPACE_COLUMNS.filter((c) => c.hideable).map((col) => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={prefs.visible.includes(col.key)}
                onCheckedChange={() => onPrefs(toggleColumn(prefs, col.key))}
                onSelect={(e) => e.preventDefault()}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Densidade</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={prefs.density}
              onValueChange={(d) => onPrefs({ ...prefs, density: d as Density })}
            >
              {(Object.keys(DENSITY_LABELS) as Density[]).map((d) => (
                <DropdownMenuRadioItem key={d} value={d} onSelect={(e) => e.preventDefault()}>
                  {DENSITY_LABELS[d]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" onClick={onExport} disabled={exporting}>
          <Download />
          {exporting ? 'Exportando…' : 'Exportar CSV'}
        </Button>
      </div>
    </div>
  );
}

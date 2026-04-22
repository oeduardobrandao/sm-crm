import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DateRange } from 'react-day-picker';
import { getIdeias, getClientes, type Ideia } from '@/store';
import { IdeiaStatusBadge } from '@/components/ideias/IdeiaStatusBadge';
import { IdeiaDrawer } from '@/components/ideias/IdeiaDrawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Info, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Spinner } from '@/components/ui/spinner';

const ALL_STATUSES = ['nova', 'em_analise', 'aprovada', 'descartada'] as const;
const STATUS_LABELS: Record<string, string> = {
  nova: 'Nova', em_analise: 'Em análise', aprovada: 'Aprovada', descartada: 'Descartada',
};

function startOfDayIso(d: Date): string {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString();
}

function endOfDayIso(d: Date): string {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy.toISOString();
}

export default function IdeiasPage() {
  const queryKey = ['hub-ideias-all'];
  const { data: ideias = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getIdeias(),
  });
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
  });

  const [selectedIdeia, setSelectedIdeia] = useState<Ideia | null>(null);
  const [search, setSearch] = useState('');
  const [clienteFilter, setClienteFilter] = useState<string>('all');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const filtered = ideias.filter(i => {
    if (clienteFilter !== 'all' && String(i.cliente_id) !== clienteFilter) return false;
    if (statusFilters.length > 0 && !statusFilters.includes(i.status)) return false;
    if (dateRange?.from && i.created_at < startOfDayIso(dateRange.from)) return false;
    if (dateRange?.to && i.created_at > endOfDayIso(dateRange.to)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!i.titulo.toLowerCase().includes(q) && !i.clientes.nome.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1>Ideias</h1>
          <span data-tooltip="Ideias enviadas pelos clientes no portal." data-tooltip-dir="right" style={{ display: 'flex' }}>
            <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
          <Search className="h-4 w-4" style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <Input placeholder="Buscar por título ou cliente..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '2rem' }} />
        </div>
        <Select value={clienteFilter} onValueChange={setClienteFilter}>
          <SelectTrigger className="!rounded-full !text-xs h-9 px-4 w-auto min-w-[160px] mb-0">
            <SelectValue placeholder="Todos os clientes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {[...clientes].sort((a: any, b: any) => a.nome.localeCompare(b.nome, 'pt-BR')).map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 rounded-full px-4 text-xs gap-1.5 font-normal shadow-sm mb-0">
              {statusFilters.length === 0
                ? 'Status'
                : statusFilters.length === 1
                  ? STATUS_LABELS[statusFilters[0]]
                  : `Status (${statusFilters.length})`}
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {ALL_STATUSES.map(s => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={statusFilters.includes(s)}
                onCheckedChange={(checked) => {
                  setStatusFilters(prev =>
                    checked ? [...prev, s] : prev.filter(x => x !== s)
                  );
                }}
                onSelect={(e) => e.preventDefault()}
              >
                {STATUS_LABELS[s]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DateRangePicker value={dateRange} onChange={setDateRange} className="rounded-full text-xs px-4 mb-0" />
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm py-8 text-center text-muted-foreground">Nenhuma ideia encontrada.</p>
      ) : (
        <div className="border rounded-xl bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reações</TableHead>
                <TableHead>Resposta</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((ideia) => (
                <TableRow
                  key={ideia.id}
                  onClick={() => setSelectedIdeia(ideia)}
                  className="cursor-pointer"
                >
                  <TableCell className="text-muted-foreground">{ideia.clientes.nome}</TableCell>
                  <TableCell className="font-medium max-w-[200px] truncate">{ideia.titulo}</TableCell>
                  <TableCell><IdeiaStatusBadge status={ideia.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{ideia.ideia_reactions.length || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{ideia.comentario_agencia ? '✓' : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(ideia.created_at).toLocaleDateString('pt-BR')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {selectedIdeia && (
        <IdeiaDrawer
          ideia={selectedIdeia}
          queryKey={queryKey}
          onClose={() => setSelectedIdeia(null)}
        />
      )}
    </div>
  );
}

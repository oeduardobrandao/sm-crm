import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getIdeias, getClientes, type Ideia } from '@/store';
import { IdeiaStatusBadge } from '@/components/ideias/IdeiaStatusBadge';
import { IdeiaDrawer } from '@/components/ideias/IdeiaDrawer';

const ALL_STATUSES = ['nova', 'em_analise', 'aprovada', 'descartada'] as const;
const STATUS_LABELS: Record<string, string> = {
  nova: 'Nova', em_analise: 'Em análise', aprovada: 'Aprovada', descartada: 'Descartada',
};

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
  const [clienteFilter, setClienteFilter] = useState<string>('all');
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  function toggleStatus(s: string) {
    setStatusFilters(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  const filtered = ideias.filter(i => {
    if (clienteFilter !== 'all' && String(i.cliente_id) !== clienteFilter) return false;
    if (statusFilters.size > 0 && !statusFilters.has(i.status)) return false;
    if (dateFrom && i.created_at < dateFrom) return false;
    if (dateTo && i.created_at > dateTo + 'T23:59:59') return false;
    return true;
  });

  return (
    <div>
      <div className="header">
        <div className="header-title">
          <h1>Ideias</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={clienteFilter}
          onChange={e => setClienteFilter(e.target.value)}
          className="text-sm border border-stone-200 rounded-lg px-3 py-1.5 outline-none"
        >
          <option value="all">Todos os clientes</option>
          {clientes.map((c: any) => (
            <option key={c.id} value={String(c.id)}>{c.nome}</option>
          ))}
        </select>

        <div className="flex gap-1">
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                statusFilters.has(s) ? 'bg-stone-900 text-white border-stone-900' : 'border-stone-200 text-stone-600 hover:border-stone-400'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="text-sm border border-stone-200 rounded-lg px-2 py-1.5 outline-none"
        />
        <span className="text-sm text-stone-400 self-center">até</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="text-sm border border-stone-200 rounded-lg px-2 py-1.5 outline-none"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-stone-500 py-8 text-center">Nenhuma ideia encontrada.</p>
      ) : (
        <div className="border border-stone-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Título</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Reações</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Resposta</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Data</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ideia, i) => (
                <tr
                  key={ideia.id}
                  onClick={() => setSelectedIdeia(ideia)}
                  className={`cursor-pointer hover:bg-stone-50 transition-colors ${i !== 0 ? 'border-t border-stone-100' : ''}`}
                >
                  <td className="px-4 py-3 text-stone-600">{ideia.clientes.nome}</td>
                  <td className="px-4 py-3 font-medium text-stone-900 max-w-[200px] truncate">{ideia.titulo}</td>
                  <td className="px-4 py-3"><IdeiaStatusBadge status={ideia.status} /></td>
                  <td className="px-4 py-3 text-stone-500">{ideia.ideia_reactions.length || '—'}</td>
                  <td className="px-4 py-3 text-stone-500">{ideia.comentario_agencia ? '✓' : '—'}</td>
                  <td className="px-4 py-3 text-stone-400">{new Date(ideia.created_at).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

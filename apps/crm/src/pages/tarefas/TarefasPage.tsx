import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calendar, Columns, List, ListChecks, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { TarefaWithRelations } from '../../store';
import { useTarefasData } from './hooks/useTarefasData';
import {
  applyTarefaFilters,
  computeHeaderStats,
  EMPTY_TAREFA_FILTERS,
  type TarefaFilterState,
} from './tarefasLogic';
import { TarefasStatsHeader } from './components/TarefasStatsHeader';
import { TarefasFilters } from './components/TarefasFilters';
import { TarefaFormDialog } from './components/TarefaFormDialog';
import { TarefaDetailSheet } from './components/TarefaDetailSheet';
import { ListView } from './views/ListView';
import { MembrosBoardView } from './views/MembrosBoardView';
import { StatusKanbanView } from './views/StatusKanbanView';
import { CalendarView } from './views/CalendarView';

type ActiveView = 'lista' | 'membros' | 'kanban' | 'calendario';

const VIEW_TABS: { id: ActiveView; label: string; icon: React.ReactNode }[] = [
  { id: 'lista', label: 'Lista', icon: <List className="h-4 w-4" /> },
  { id: 'membros', label: 'Por membro', icon: <Users className="h-4 w-4" /> },
  { id: 'kanban', label: 'Kanban', icon: <Columns className="h-4 w-4" /> },
  { id: 'calendario', label: 'Calendário', icon: <Calendar className="h-4 w-4" /> },
];

export default function TarefasPage() {
  const [activeView, setActiveView] = useState<ActiveView>('lista');
  const [filters, setFilters] = useState<TarefaFilterState>(EMPTY_TAREFA_FILTERS);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TarefaWithRelations | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { tarefas, tags, membros, clientes, isLoading, refresh } = useTarefasData();

  // Deep link: /tarefas?tarefa=<id> opens the detail sheet (EntregasPage ?drawer= pattern).
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingTarefaId = useRef<number | null>(null);
  const tarefaParam = searchParams.get('tarefa');
  useEffect(() => {
    if (!tarefaParam) return;
    const parsed = parseInt(tarefaParam, 10);
    if (!isNaN(parsed)) {
      pendingTarefaId.current = parsed;
      setSearchParams({}, { replace: true });
    }
  }, [tarefaParam, setSearchParams]);

  useEffect(() => {
    if (pendingTarefaId.current === null || tarefas.length === 0) return;
    const match = tarefas.find((t) => t.id === pendingTarefaId.current);
    if (match) {
      pendingTarefaId.current = null;
      setSelectedId(match.id!);
    }
  }, [tarefas]);

  const filteredTarefas = useMemo(
    () => applyTarefaFilters(tarefas, filters),
    [tarefas, filters],
  );
  const stats = useMemo(() => computeHeaderStats(tarefas, new Date()), [tarefas]);
  const selected = selectedId != null ? (tarefas.find((t) => t.id === selectedId) ?? null) : null;

  const openForm = (tarefa: TarefaWithRelations | null) => {
    setEditing(tarefa);
    setFormOpen(true);
  };

  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}
      >
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <h1>Tarefas</h1>
          <p>
            {stats.abertas} aberta{stats.abertas === 1 ? '' : 's'}
            {stats.atrasadas > 0 && (
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                {' '}
                · {stats.atrasadas} atrasada{stats.atrasadas === 1 ? '' : 's'}
              </span>
            )}
            {stats.vencemHoje > 0 && (
              <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
                {' '}
                · {stats.vencemHoje} vence{stats.vencemHoje === 1 ? '' : 'm'} hoje
              </span>
            )}
          </p>
        </div>
        <div className="header-actions">
          <Button onClick={() => openForm(null)}>
            <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Nova tarefa
          </Button>
        </div>
      </header>

      <TarefasStatsHeader stats={stats} />

      <div
        style={{
          display: 'flex',
          gap: '0.25rem',
          background: 'var(--surface-2)',
          padding: '0.25rem',
          borderRadius: '8px',
          overflowX: 'auto',
          width: 'fit-content',
          maxWidth: '100%',
        }}
        className="animate-up no-scrollbar"
      >
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              border: 'none',
              background: activeView === tab.id ? '#000' : 'transparent',
              color: activeView === tab.id ? '#fff' : 'var(--text-secondary)',
              fontSize: '0.8rem',
              fontWeight: activeView === tab.id ? 600 : 400,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <TarefasFilters
        filters={filters}
        onChange={setFilters}
        clientes={clientes}
        membros={membros}
        tags={tags}
      />

      {tarefas.length === 0 ? (
        <div
          className="card animate-up"
          style={{
            textAlign: 'center',
            padding: '4rem 3rem',
            color: 'var(--text-muted)',
            borderRadius: '12px',
          }}
        >
          <ListChecks
            className="h-8 w-8"
            style={{ margin: '0 auto 0.75rem', opacity: 0.35 }}
          />
          <p style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Nenhuma tarefa ainda. Crie a primeira tarefa da equipe.
          </p>
          <Button onClick={() => openForm(null)}>
            <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Nova tarefa
          </Button>
        </div>
      ) : (
        <>
          {activeView === 'lista' && (
            <ListView
              tarefas={filteredTarefas}
              membros={membros}
              onTarefaClick={(t) => setSelectedId(t.id!)}
              onRefresh={refresh}
            />
          )}
          {activeView === 'membros' && (
            <MembrosBoardView
              tarefas={filteredTarefas}
              membros={membros}
              onTarefaClick={(t) => setSelectedId(t.id!)}
              onRefresh={refresh}
            />
          )}
          {activeView === 'kanban' && (
            <StatusKanbanView
              tarefas={filteredTarefas}
              membros={membros}
              onTarefaClick={(t) => setSelectedId(t.id!)}
              onRefresh={refresh}
            />
          )}
          {activeView === 'calendario' && (
            <CalendarView
              tarefas={filteredTarefas}
              onTarefaClick={(t) => setSelectedId(t.id!)}
              onRefresh={refresh}
            />
          )}
        </>
      )}

      <TarefaFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        membros={membros}
        clientes={clientes}
        tags={tags}
        onSaved={refresh}
        onTagCreated={refresh}
      />

      {selected && (
        <TarefaDetailSheet
          tarefa={selected}
          membros={membros}
          onClose={() => setSelectedId(null)}
          onEdit={() => {
            setSelectedId(null);
            openForm(selected);
          }}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

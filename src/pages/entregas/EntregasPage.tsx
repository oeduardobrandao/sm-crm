import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, LayoutGrid, Info, BarChart2, Calendar, List, Columns } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useEntregasData, type BoardCard } from './hooks/useEntregasData';
import { EntregasFilters, type FilterState } from './components/EntregasFilters';
import {
  NewWorkflowModal, EditWorkflowModal, TemplatesModal,
  RecurringWorkflowDialog,
} from './components/WorkflowModals';
import { KanbanView } from './views/KanbanView';
import { ChartView } from './views/ChartView';
import { CalendarView } from './views/CalendarView';
import { ListView } from './views/ListView';
import { duplicateWorkflow } from '../../store';

type ActiveView = 'kanban' | 'chart' | 'calendar' | 'list';

const VIEW_TABS: { id: ActiveView; label: string; icon: React.ReactNode }[] = [
  { id: 'kanban', label: 'Kanban', icon: <Columns className="h-4 w-4" /> },
  { id: 'chart', label: 'Gráfico', icon: <BarChart2 className="h-4 w-4" /> },
  { id: 'calendar', label: 'Calendário', icon: <Calendar className="h-4 w-4" /> },
  { id: 'list', label: 'Lista', icon: <List className="h-4 w-4" /> },
];

export default function EntregasPage() {
  const [activeView, setActiveView] = useState<ActiveView>('kanban');
  const [filters, setFilters] = useState<FilterState>({ filterCliente: null, filterMembro: null, filterStatus: 'todos' });
  const [listSort, setListSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({ column: 'titulo', direction: 'asc' });
  const [newWorkflowOpen, setNewWorkflowOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editCard, setEditCard] = useState<BoardCard | null>(null);
  const [recurringWfId, setRecurringWfId] = useState<number | null>(null);

  const { clientes, membros, templates, cards, activeWorkflows, isLoading, refresh } = useEntregasData();

  // Apply filters
  let filteredCards = cards;
  if (filters.filterCliente) filteredCards = filteredCards.filter(c => c.workflow.cliente_id === filters.filterCliente);
  if (filters.filterMembro) filteredCards = filteredCards.filter(c => c.etapa.responsavel_id === filters.filterMembro);
  if (filters.filterStatus === 'atrasado') filteredCards = filteredCards.filter(c => c.deadline.estourado);
  else if (filters.filterStatus === 'urgente') filteredCards = filteredCards.filter(c => c.deadline.urgente && !c.deadline.estourado);
  else if (filters.filterStatus === 'em_dia') filteredCards = filteredCards.filter(c => !c.deadline.estourado && !c.deadline.urgente);

  const overdue = cards.filter(c => c.deadline.estourado).length;
  const urgent = cards.filter(c => c.deadline.urgente && !c.deadline.estourado).length;

  const handleRecurringConfirm = async () => {
    if (!recurringWfId) return;
    try {
      await duplicateWorkflow(recurringWfId);
      toast.success('Novo ciclo criado!');
    } catch { toast.error('Erro ao criar ciclo'); }
    setRecurringWfId(null);
    refresh();
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h1>Entregas</h1>
            <span data-tooltip="Acompanhe o andamento das entregas e fluxos ativos." data-tooltip-dir="right" style={{ display: 'flex' }}>
              <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
            </span>
          </div>
          <p>
            fluxos ativos: {activeWorkflows.length}
            {overdue > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}> • {overdue} atrasado{overdue > 1 ? 's' : ''}</span>}
            {urgent > 0 && <span style={{ color: 'var(--warning)', fontWeight: 600 }}> • {urgent} urgente{urgent > 1 ? 's' : ''}</span>}
          </p>
        </div>
        <div className="header-actions">
          {/* View switcher */}
          <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--surface-2)', padding: '0.25rem', borderRadius: '8px' }}>
            {VIEW_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveView(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.4rem 0.9rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: activeView === tab.id ? 'var(--accent)' : 'transparent',
                  color: activeView === tab.id ? '#fff' : 'var(--text-secondary)',
                  fontSize: '0.8rem', fontWeight: activeView === tab.id ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={() => setTemplatesOpen(true)}><LayoutGrid className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Templates</Button>
          <Button onClick={() => setNewWorkflowOpen(true)}><Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Novo Fluxo</Button>
        </div>
      </header>

      <EntregasFilters filters={filters} onChange={setFilters} clientes={clientes} membros={membros} />

      {activeView === 'kanban' && (
        <KanbanView
          cards={filteredCards}
          onCardClick={setEditCard}
          onRefresh={refresh}
          onRecurring={setRecurringWfId}
        />
      )}
      {activeView === 'chart' && <ChartView cards={filteredCards} />}
      {activeView === 'calendar' && <CalendarView cards={filteredCards} onCardClick={setEditCard} />}
      {activeView === 'list' && (
        <ListView
          cards={filteredCards}
          sort={listSort}
          onSortChange={setListSort}
          onCardClick={setEditCard}
        />
      )}

      {newWorkflowOpen && (
        <NewWorkflowModal
          open={newWorkflowOpen}
          onClose={() => setNewWorkflowOpen(false)}
          clientes={clientes}
          membros={membros}
          templates={templates}
          onCreated={refresh}
        />
      )}
      {editCard && (
        <EditWorkflowModal
          card={editCard}
          membros={membros}
          clientes={clientes}
          onClose={() => setEditCard(null)}
          onSaved={refresh}
          onDeleted={refresh}
        />
      )}
      {templatesOpen && (
        <TemplatesModal
          open={templatesOpen}
          onClose={() => setTemplatesOpen(false)}
          templates={templates}
          membros={membros}
          onRefresh={refresh}
        />
      )}
      <RecurringWorkflowDialog
        open={!!recurringWfId}
        onConfirm={handleRecurringConfirm}
        onCancel={() => setRecurringWfId(null)}
      />
    </div>
  );
}

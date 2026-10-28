import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calendar, Columns, List, ListChecks, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { PageSkeleton } from '@/components/ui/skeletons';
import { useAuth } from '@/context/AuthContext';
import { useCurrentMembro } from '@/hooks/useCurrentMembro';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import type { TarefaWithRelations } from '../../store';
import { useTarefasData } from './hooks/useTarefasData';
import {
  applyTarefaFilters,
  applyTarefaKpi,
  computeHeaderStats,
  EMPTY_TAREFA_FILTERS,
  type TarefaFilterState,
  type TarefaKpi,
} from './tarefasLogic';
import { loadTarefasEscopo, persistTarefasEscopo, type TarefasEscopo } from './tarefasPrefs';
import { TarefasStatsHeader } from './components/TarefasStatsHeader';
import { TarefasFilters } from './components/TarefasFilters';
import { TarefaFormDialog } from './components/TarefaFormDialog';
import { TarefaDetailSheet } from './components/TarefaDetailSheet';
import { ListView } from './views/ListView';
import { MembrosBoardView } from './views/MembrosBoardView';
import { StatusKanbanView } from './views/StatusKanbanView';
import { CalendarView } from './views/CalendarView';
import { TarefasPhoneContext, type TarefasPhoneActions } from './phone/parts';
import { TarefasPhoneHeader } from './phone/TarefasPhoneHeader';

type ActiveView = 'lista' | 'membros' | 'kanban' | 'calendario';

// Labels resolve per render through `tarefasPage.views.<id>`.
const VIEW_TABS: { id: ActiveView; icon: React.ReactNode }[] = [
  { id: 'lista', icon: <List className="h-4 w-4" /> },
  { id: 'membros', icon: <Users className="h-4 w-4" /> },
  { id: 'kanban', icon: <Columns className="h-4 w-4" /> },
  { id: 'calendario', icon: <Calendar className="h-4 w-4" /> },
];

export default function TarefasPage() {
  const { t } = useTranslation('tasks');
  const isDesktop = useIsDesktop(768);
  const [activeView, setActiveView] = useState<ActiveView>('lista');
  const [filters, setFilters] = useState<TarefaFilterState>(EMPTY_TAREFA_FILTERS);
  // KPI card filter, kept apart from `filters` so the cards keep counting the unfiltered
  // scoped set. Desktop only: the phone header shows the stats as text, not cards.
  const [kpi, setKpi] = useState<TarefaKpi | null>(null);
  const activeKpi = isDesktop ? kpi : null;
  const toggleKpi = (next: TarefaKpi) => setKpi((cur) => (cur === next ? null : next));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TarefaWithRelations | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createDataLimite, setCreateDataLimite] = useState<string | null | undefined>(undefined);

  const { tarefas, tags, membros, clientes, isLoading, refresh } = useTarefasData();

  const { user, profile } = useAuth();
  const { membro: currentMembro } = useCurrentMembro();
  const contaId = profile?.active_workspace_id ?? profile?.conta_id ?? 'unknown';
  const userId = user?.id ?? 'unknown';
  const [escopo, setEscopo] = useState<TarefasEscopo>(() => loadTarefasEscopo(contaId, userId));
  const handleEscopoChange = (next: TarefasEscopo) => {
    setEscopo(next);
    persistTarefasEscopo(contaId, userId, next);
  };
  const currentMembroId = currentMembro?.id ?? null;
  const scopedTarefas = useMemo(() => {
    if (escopo !== 'minhas' || currentMembroId == null) return tarefas;
    return tarefas.filter((t) => t.responsavel_id === currentMembroId);
  }, [tarefas, escopo, currentMembroId]);

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
      // Resolve immediately when the list is already loaded (deep link fired
      // while the page is mounted, e.g. a notification click on /tarefas —
      // the tarefas-keyed effect below would never re-run in that case).
      if (tarefas.some((t) => t.id === parsed)) {
        pendingTarefaId.current = null;
        setSelectedId(parsed);
      }
    }
  }, [tarefaParam, setSearchParams, tarefas]);

  useEffect(() => {
    if (pendingTarefaId.current === null || tarefas.length === 0) return;
    const match = tarefas.find((t) => t.id === pendingTarefaId.current);
    if (match) {
      pendingTarefaId.current = null;
      setSelectedId(match.id!);
    }
  }, [tarefas]);

  const filteredTarefas = useMemo(
    () => applyTarefaKpi(applyTarefaFilters(scopedTarefas, filters), activeKpi, new Date()),
    [scopedTarefas, filters, activeKpi],
  );
  const stats = useMemo(() => computeHeaderStats(scopedTarefas, new Date()), [scopedTarefas]);
  const selected = selectedId != null ? (tarefas.find((t) => t.id === selectedId) ?? null) : null;
  // Phones: the detail screen stays mounted after it closes (last task shown), so its
  // history entry is popped by the screen itself, not stranded by an unmount.
  const lastDetailRef = useRef<TarefaWithRelations | null>(null);
  if (selected) lastDetailRef.current = selected;
  const detailTarefa = selected ?? lastDetailRef.current;

  const openForm = (tarefa: TarefaWithRelations | null) => {
    setEditing(tarefa);
    setCreateDataLimite(undefined);
    setFormOpen(true);
  };

  const handleCreateForDate = (date: string | null) => {
    setEditing(null);
    setCreateDataLimite(date);
    setFormOpen(true);
  };

  const phoneActions = useMemo<TarefasPhoneActions>(
    () => ({
      membros,
      onRefresh: refresh,
      openDetail: (t) => setSelectedId(t.id!),
      edit: (t) => {
        setEditing(t);
        setCreateDataLimite(undefined);
        setFormOpen(true);
      },
    }),
    [membros, refresh],
  );

  const subtitle = (
    <>
      {t('tarefasPage.subtitle.open', { count: stats.abertas })}
      {stats.atrasadas > 0 && (
        <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
          {' '}
          · {t('tarefasPage.subtitle.overdue', { count: stats.atrasadas })}
        </span>
      )}
      {stats.vencemHoje > 0 && (
        <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
          {' '}
          · {t('tarefasPage.subtitle.dueToday', { count: stats.vencemHoje })}
        </span>
      )}
    </>
  );

  const primaryAction = (
    <Button onClick={() => openForm(null)}>
      <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {t('tarefasPage.newTask')}
    </Button>
  );

  // The minhas/todas switch: the toolbar's segmented slot gets the Vidro pill, the in-page
  // header keeps today's inline styles.
  const escopoOptions = ['minhas', 'todas'] as const;
  const escopoLabel = (option: TarefasEscopo) =>
    option === 'minhas' ? t('tarefasPage.escopo.minhas') : t('tarefasPage.escopo.todas');
  const escopoSwitchVidro =
    currentMembroId != null ? (
      <div className="vidro-seg">
        {escopoOptions.map((option) => (
          <button
            key={option}
            type="button"
            className="vidro-seg-btn"
            aria-pressed={escopo === option}
            onClick={() => handleEscopoChange(option)}
          >
            {escopoLabel(option)}
          </button>
        ))}
      </div>
    ) : null;
  const escopoSwitch =
    currentMembroId != null ? (
      <div
        style={{
          display: 'flex',
          gap: '0.25rem',
          background: 'var(--surface-2)',
          padding: '0.25rem',
          borderRadius: '8px',
          width: 'fit-content',
        }}
        className="animate-up"
      >
        {escopoOptions.map((option) => (
          <button
            key={option}
            onClick={() => handleEscopoChange(option)}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              border: 'none',
              background: escopo === option ? '#000' : 'transparent',
              color: escopo === option ? '#fff' : 'var(--text-secondary)',
              fontSize: '0.8rem',
              fontWeight: escopo === option ? 600 : 400,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {escopoLabel(option)}
          </button>
        ))}
      </div>
    ) : null;

  const inToolbar = usePageToolbar(
    isLoading
      ? null
      : {
          title: t('tarefasPage.title'),
          subtitle,
          segmented: escopoSwitchVidro,
          primary: primaryAction,
        },
  );

  if (isLoading) {
    // The page always opens on the 'lista' view.
    return <PageSkeleton body="list" />;
  }

  const views = (
    <>
      {activeView === 'lista' && (
        <ListView
          tarefas={filteredTarefas}
          membros={membros}
          onTarefaClick={(t) => setSelectedId(t.id!)}
          onRefresh={refresh}
          expandConcluidas={activeKpi === 'concluidasHoje'}
        />
      )}
      {activeView === 'membros' && (
        <MembrosBoardView
          tarefas={filteredTarefas}
          membros={membros}
          onTarefaClick={(t) => setSelectedId(t.id!)}
          onRefresh={refresh}
          onlyMembroId={escopo === 'minhas' ? currentMembroId : null}
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
          membros={membros}
          onTarefaClick={(t) => setSelectedId(t.id!)}
          onRefresh={refresh}
          onCreateTask={handleCreateForDate}
        />
      )}
    </>
  );

  const formDialog = (
    <TarefaFormDialog
      open={formOpen}
      onClose={() => setFormOpen(false)}
      editing={editing}
      membros={membros}
      clientes={clientes}
      tags={tags}
      onSaved={refresh}
      onTagCreated={refresh}
      initialValues={{ data_limite: createDataLimite }}
    />
  );

  if (!isDesktop) {
    return (
      <TarefasPhoneContext.Provider value={phoneActions}>
        <div className="phone-tar-page">
          <TarefasPhoneHeader
            stats={stats}
            view={activeView}
            onViewChange={setActiveView}
            escopo={currentMembroId != null ? escopo : null}
            onEscopoChange={handleEscopoChange}
            filters={filters}
            onFiltersChange={setFilters}
            clientes={clientes}
            membros={membros}
            tags={tags}
            resultCount={filteredTarefas.length}
            onNew={() => openForm(null)}
          />
          {tarefas.length === 0 && activeView === 'lista' ? (
            <div className="phone-tar-empty">
              <ListChecks aria-hidden="true" />
              <p>{t('tarefasPage.empty')}</p>
              <button type="button" className="phone-tar-ink-btn" onClick={() => openForm(null)}>
                <Plus aria-hidden="true" /> {t('tarefasPage.newTask')}
              </button>
            </div>
          ) : (
            views
          )}
        </div>
        {formDialog}
        {detailTarefa && (
          <TarefaDetailSheet
            open={selected != null}
            tarefa={detailTarefa}
            membros={membros}
            onClose={() => setSelectedId(null)}
            // The form opens over the detail screen, which stays put underneath.
            onEdit={() => openForm(detailTarefa)}
            onRefresh={refresh}
          />
        )}
      </TarefasPhoneContext.Provider>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {!inToolbar && (
        <header className="header animate-up">
          <div className="header-title">
            <h1>{t('tarefasPage.title')}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="header-actions">{primaryAction}</div>
        </header>
      )}

      <TarefasStatsHeader stats={stats} activeKpi={activeKpi} onKpiClick={toggleKpi} />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        {inToolbar ? (
          <div className="vidro-seg animate-up no-scrollbar">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="vidro-seg-btn"
                aria-pressed={activeView === tab.id}
                onClick={() => setActiveView(tab.id)}
              >
                {tab.icon} {t(`tarefasPage.views.${tab.id}`)}
              </button>
            ))}
          </div>
        ) : (
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
                {tab.icon} {t(`tarefasPage.views.${tab.id}`)}
              </button>
            ))}
          </div>
        )}

        {!inToolbar && escopoSwitch}
      </div>

      <TarefasFilters
        filters={filters}
        onChange={setFilters}
        clientes={clientes}
        membros={membros}
        tags={tags}
        kpi={activeKpi}
        onClearKpi={() => setKpi(null)}
      />

      {tarefas.length === 0 && activeView === 'lista' ? (
        <div
          className="card animate-up"
          style={{
            textAlign: 'center',
            padding: '4rem 3rem',
            color: 'var(--text-muted)',
            borderRadius: '12px',
          }}
        >
          <ListChecks className="h-8 w-8" style={{ margin: '0 auto 0.75rem', opacity: 0.35 }} />
          <p style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>{t('tarefasPage.empty')}</p>
          <Button onClick={() => openForm(null)}>
            <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} />{' '}
            {t('tarefasPage.newTask')}
          </Button>
        </div>
      ) : (
        views
      )}

      {formDialog}

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

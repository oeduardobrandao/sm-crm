import { useRef, useState, type ReactNode } from 'react';
import {
  Archive,
  BarChart2,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  CircleDashed,
  Columns,
  LayoutGrid,
  List,
  ListChecks,
  Plus,
  Route,
  Search,
  SlidersHorizontal,
  Table2,
  X,
} from 'lucide-react';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { useSheetActions } from '@/components/mobile/sheetActions';
import { SAVED_VIEW_NAME_MAX } from '@/store/savedViews';
import type { EntregasMode } from '../components/ModeToggle';
import type { ActiveView, EntidadeFilter } from '../viewQuery';
import { useSavedViewSelection } from '../hooks/useSavedViewSelection';
import type { FilterChip } from './PhoneFiltersSheet';
import './entregasPhone.css';

export const PHONE_VIEWS: { id: ActiveView; label: string; icon: ReactNode }[] = [
  { id: 'kanban', label: 'Kanban', icon: <Columns aria-hidden="true" /> },
  { id: 'chart', label: 'Visão geral', icon: <BarChart2 aria-hidden="true" /> },
  { id: 'calendar', label: 'Calendário', icon: <Calendar aria-hidden="true" /> },
  { id: 'list', label: 'Lista', icon: <List aria-hidden="true" /> },
  { id: 'fila', label: 'Minha fila', icon: <ListChecks aria-hidden="true" /> },
  { id: 'linha', label: 'Linha editorial', icon: <Table2 aria-hidden="true" /> },
  { id: 'concluded', label: 'Concluídas', icon: <Archive aria-hidden="true" /> },
];

/** The views the phone menus offer: Linha editorial only while its flag is on. */
function phoneViews(linhaEnabled: boolean | undefined) {
  return linhaEnabled ? PHONE_VIEWS : PHONE_VIEWS.filter((v) => v.id !== 'linha');
}

const ENTIDADE_OPTIONS: { id: EntidadeFilter; label: string }[] = [
  { id: 'todos', label: 'Fluxos e posts individuais' },
  { id: 'fluxos', label: 'Só fluxos' },
  { id: 'posts', label: 'Só posts individuais' },
];

export interface EntregasPhoneHeaderProps {
  contaId: string;
  currentQuery: string;
  onApplyView: (query: string) => void;
  activeView: ActiveView;
  /** feature_linha_editorial: offers the Linha editorial view in the view menus. */
  linhaEnabled?: boolean;
  onViewChange: (view: ActiveView) => void;
  mode: EntregasMode;
  onModeChange: (mode: EntregasMode) => void;
  /** Kanban, Lista and Calendário have the Etapas / Status split. */
  showMode: boolean;
  entidade: EntidadeFilter;
  onEntidadeChange: (entidade: EntidadeFilter) => void;
  /** postProcessesVisible, on the Fluxos Kanban and Lista (EntidadeToggle's gate). */
  showEntidade: boolean;
  subtitle: ReactNode;
  /** Search, filters and chips only where they apply (not Fila, Concluídas, Publicações calendar). */
  showFilters: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  activeFilterCount: number;
  onOpenFilters: () => void;
  filtersButtonRef?: React.Ref<HTMLButtonElement>;
  chips: FilterChip[];
  onApplyChip: (chip: FilterChip) => void;
  onClearFilters: () => void;
  onNewWorkflow: () => void;
  onNewAvulso: () => void;
  onTemplates: () => void;
  onComoFunciona: () => void;
}

/**
 * Entregas header on phones (EntregasKanban + EntregasVistas mockups), the same
 * PhonePageHeader as every root screen: Buscar, Filtros (with the active count) and
 * Novo in the toolbar, before the shell's help links and bell; the large title opens
 * the views menu (saved views and their management, Exibir como, Mostrar,
 * Templates, Como funciona); the view button and the Etapas / Status control
 * under the counters; then the active filter chips with Limpar.
 */
export function EntregasPhoneHeader(props: EntregasPhoneHeaderProps) {
  const {
    contaId,
    currentQuery,
    activeView,
    onViewChange,
    mode,
    onModeChange,
    showMode,
    subtitle,
    showFilters,
    search,
    onSearchChange,
    searchPlaceholder,
    activeFilterCount,
    onOpenFilters,
    filtersButtonRef,
    chips,
    onApplyChip,
    onClearFilters,
    onNewWorkflow,
    onNewAvulso,
  } = props;
  const selection = useSavedViewSelection(contaId, currentQuery);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(() => search !== '');
  const titleRef = useRef<HTMLButtonElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const views = phoneViews(props.linhaEnabled);
  const currentView = PHONE_VIEWS.find((v) => v.id === activeView) ?? views[0];
  const vistaName = selection.activeVista?.name ?? 'Padrão';

  return (
    <>
      <PhonePageHeader
        className="phone-ent-header"
        actions={
          <>
            {showFilters && (
              <PhoneIconButton
                label={searchOpen ? 'Fechar busca' : 'Buscar'}
                aria-expanded={searchOpen}
                onClick={() => {
                  if (searchOpen) {
                    onSearchChange('');
                    setSearchOpen(false);
                  } else {
                    setSearchOpen(true);
                    requestAnimationFrame(() => searchInputRef.current?.focus());
                  }
                }}
              >
                {searchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
              </PhoneIconButton>
            )}
            {showFilters && (
              <PhoneIconButton
                ref={filtersButtonRef}
                label={activeFilterCount > 0 ? `Filtros, ${activeFilterCount} ativos` : 'Filtros'}
                badge={activeFilterCount}
                onClick={onOpenFilters}
              >
                <SlidersHorizontal aria-hidden="true" />
              </PhoneIconButton>
            )}
            <PhoneIconButton
              ref={newRef}
              label="Novo"
              variant="ink"
              data-tour="novo-fluxo-btn"
              onClick={() => setNewOpen(true)}
            >
              <Plus aria-hidden="true" />
            </PhoneIconButton>
          </>
        }
        title={
          <button
            ref={titleRef}
            type="button"
            className="phone-ent-header__title"
            aria-haspopup="dialog"
            aria-label={`Entregas. Visualização: ${vistaName}${selection.modified ? ' (modificada)' : ''}. Trocar visualização`}
            onClick={() => setMenuOpen(true)}
          >
            <span>Entregas</span>
            <ChevronDown aria-hidden="true" />
          </button>
        }
        subtitle={subtitle}
      >
        {searchOpen && showFilters && (
          <div className="phone-ent-search">
            <Search aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              enterKeyHint="search"
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        )}
        <div className="phone-ent-header__row">
          <button
            ref={viewRef}
            type="button"
            className="phone-ent-header__view"
            aria-haspopup="dialog"
            aria-label={`Exibir como: ${currentView.label}. Trocar`}
            onClick={() => setViewsOpen(true)}
          >
            {currentView.icon}
            {currentView.label}
            {selection.activeVista && (
              <span className="phone-ent-header__vista">
                · {vistaName}
                {selection.modified && <span className="phone-ent-header__dot" aria-hidden />}
              </span>
            )}
            <ChevronDown aria-hidden="true" />
          </button>
          {showMode && (
            <SegmentedControl
              aria-label="Modo"
              semantics="tablist"
              className="phone-ent-header__mode"
              value={mode}
              onChange={onModeChange}
              options={[
                { value: 'entregas', label: 'Etapas' },
                { value: 'publicacoes', label: 'Status' },
              ]}
            />
          )}
        </div>
        {showFilters && chips.length > 0 && (
          <ChipRow aria-label="Filtros ativos" className="phone-ent-header__chips">
            {chips.map((c) => (
              <Chip
                key={c.key}
                label={c.label}
                removeLabel={c.removeLabel}
                onRemove={() => onApplyChip(c)}
              />
            ))}
            <button type="button" className="phone-ent-text-btn" onClick={onClearFilters}>
              Limpar
            </button>
          </ChipRow>
        )}
      </PhonePageHeader>

      <ActionSheet
        open={newOpen}
        onOpenChange={setNewOpen}
        title="Novo"
        hideTitle
        returnFocusRef={newRef}
        actions={[
          { label: 'Novo fluxo', icon: <Route aria-hidden="true" />, onSelect: onNewWorkflow },
          {
            label: 'Post avulso',
            icon: <CircleDashed aria-hidden="true" />,
            onSelect: onNewAvulso,
          },
        ]}
      />
      <ActionSheet
        open={viewsOpen}
        onOpenChange={setViewsOpen}
        title="Exibir como"
        returnFocusRef={viewRef}
        actions={views.map((v) => ({
          label: v.id === activeView ? `✓ ${v.label}` : v.label,
          icon: v.icon,
          onSelect: () => onViewChange(v.id),
        }))}
      />
      <BottomSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="Visualizações"
        detents={['medium', 'large']}
        returnFocusRef={titleRef}
      >
        <ViewsMenuBody {...props} selection={selection} />
      </BottomSheet>
    </>
  );
}

function ViewsMenuBody({
  selection,
  onApplyView,
  activeView,
  onViewChange,
  linhaEnabled,
  entidade,
  onEntidadeChange,
  showEntidade,
  onTemplates,
  onComoFunciona,
}: EntregasPhoneHeaderProps & { selection: ReturnType<typeof useSavedViewSelection> }) {
  const { closeThen } = useSheetActions();
  // 'new' = naming a new vista; a vista id = renaming that one.
  const [naming, setNaming] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const { views, isLoading, activeId, activeVista, modified } = selection;

  const submitName = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      if (naming === 'new') {
        if (await selection.saveNew(draft)) setNaming(null);
      } else if (naming) {
        await selection.renameVista(naming, draft);
        setNaming(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const nameForm = (
    <form
      className="phone-ent-name-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submitName();
      }}
    >
      <input
        autoFocus
        aria-label="Nome da visualização"
        placeholder="Nome da visualização"
        maxLength={SAVED_VIEW_NAME_MAX}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button type="button" className="phone-ent-text-btn" onClick={() => setNaming(null)}>
        Cancelar
      </button>
      <button
        type="submit"
        className="phone-ent-text-btn phone-ent-text-btn--strong"
        disabled={!draft.trim() || busy || isLoading}
      >
        Salvar
      </button>
    </form>
  );

  const check = <Check className="phone-ent-check" aria-hidden="true" />;

  return (
    <div className="phone-ent-menu">
      <GroupedList header="Visualizações salvas">
        <Cell
          label="Padrão"
          current={activeId == null}
          accessory={activeId == null ? check : undefined}
          onClick={() =>
            closeThen(() => {
              selection.choose(null);
              onApplyView('');
            })
          }
        />
        {views.map((v) => (
          <Cell
            key={v.id}
            label={v.name}
            value={v.id === activeId && modified ? 'Modificada' : undefined}
            current={v.id === activeId}
            accessory={v.id === activeId ? check : undefined}
            onClick={() =>
              closeThen(() => {
                selection.choose(v.id);
                onApplyView(v.query);
              })
            }
          />
        ))}
        {naming === 'new' ? (
          <li className="phone-cell">{nameForm}</li>
        ) : (
          <Cell
            label="Salvar visualização atual"
            icon={<Plus aria-hidden="true" />}
            disabled={isLoading}
            onClick={() => {
              setDraft('');
              setNaming('new');
            }}
          />
        )}
      </GroupedList>

      {activeVista && (
        <GroupedList header={`Visualização "${activeVista.name}"`}>
          <Cell
            label="Atualizar com estado atual"
            subtitle={modified ? 'Salva os filtros e a exibição de agora' : undefined}
            onClick={() => closeThen(() => void selection.updateWithCurrent(activeVista))}
          />
          {naming === activeVista.id ? (
            <li className="phone-cell">{nameForm}</li>
          ) : (
            <Cell
              label="Renomear"
              onClick={() => {
                setDraft(activeVista.name);
                setNaming(activeVista.id);
              }}
            />
          )}
          <Cell
            label="Excluir"
            destructive
            onClick={() => closeThen(() => void selection.removeVista(activeVista))}
          />
        </GroupedList>
      )}

      <GroupedList header="Exibir como">
        {phoneViews(linhaEnabled).map((v) => (
          <Cell
            key={v.id}
            label={v.label}
            icon={v.icon}
            current={v.id === activeView}
            accessory={v.id === activeView ? check : undefined}
            onClick={() => closeThen(() => onViewChange(v.id))}
          />
        ))}
      </GroupedList>

      {showEntidade && (
        <GroupedList header="Mostrar">
          {ENTIDADE_OPTIONS.map((o) => (
            <Cell
              key={o.id}
              label={o.label}
              current={o.id === entidade}
              accessory={o.id === entidade ? check : undefined}
              onClick={() => closeThen(() => onEntidadeChange(o.id))}
            />
          ))}
        </GroupedList>
      )}

      <GroupedList>
        <Cell
          label="Templates"
          icon={<LayoutGrid aria-hidden="true" />}
          chevron
          onClick={() => closeThen(onTemplates)}
        />
        <Cell
          label="Como funciona"
          icon={<BookOpen aria-hidden="true" />}
          chevron
          onClick={() => closeThen(onComoFunciona)}
        />
      </GroupedList>
    </div>
  );
}

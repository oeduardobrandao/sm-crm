import { type Ref } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The phone header now carries the shell's help links and bell (PhonePageHeader); their
// own suites cover them, and they need the KB query and notifications.
// Feedback em mídia: the drawers fetch client notes by path (not through the mocked '@/store').
vi.mock('@/store/mediaNotes', () => ({
  getMediaNotes: async () => [],
  mediaNotesKey: (ids: number[]) => ['media-notes', ids.join(',')],
  replyToMediaNote: async () => undefined,
  setMediaNoteStatus: async () => undefined,
}));

vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

vi.mock('../hooks/useEntregasData', () => ({
  useEntregasData: vi.fn(),
}));

vi.mock('../hooks/useActivePosts', () => ({
  useActivePosts: vi.fn(() => ({ posts: [], isLoading: false })),
}));

// VistasTabs reads the saved views through this hook (TanStack Query + the
// store); this suite has no QueryClientProvider, so the hook is stubbed and a
// test seeds `savedViewsMock.views` to render saved tabs.
const savedViewsMock = vi.hoisted(() => ({
  views: [] as { id: string; name: string; query: string; position: number }[],
}));
vi.mock('../hooks/useSavedViews', () => ({
  useSavedViews: () => ({
    views: savedViewsMock.views,
    isLoading: false,
    isError: false,
    save: vi.fn(),
    updateQuery: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  }),
}));

const storeMocks = vi.hoisted(() => ({
  duplicateWorkflow: vi.fn(),
  getStandalonePost: vi.fn(),
  // Used by the provisional card built from a "mover para outro fluxo" seed.
  getDeadlineInfo: vi.fn(() => ({ estourado: false, urgente: false })),
  isFinalClientApprovalCycle: vi.fn(() => true),
  // buildMinhaFila (real in this suite) reads these two pure exports of
  // store/posts.ts; copies of the originals, since this mock replaces the module.
  ASSIGNEE_PENDING_POST_STATUSES: [
    'rascunho',
    'revisao_interna',
    'correcao_cliente',
    'falha_publicacao',
  ] as const,
  compareScheduledAtAscNullsLast: (
    a: { scheduled_at: string | null; id: number },
    b: { scheduled_at: string | null; id: number },
  ) => {
    if (a.scheduled_at == null && b.scheduled_at == null) return a.id - b.id;
    if (a.scheduled_at == null) return 1;
    if (b.scheduled_at == null) return -1;
    if (a.scheduled_at < b.scheduled_at) return -1;
    if (a.scheduled_at > b.scheduled_at) return 1;
    return a.id - b.id;
  },
}));
vi.mock('../../../store', () => storeMocks);

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Real DropdownMenu needs Radix portal/pointer-capture machinery jsdom doesn't
// implement; render it flat (same pattern as LeadsPage.atlimit.test.tsx) so the
// Novo dropdown's items are directly clickable without opening anything first.
// The Vidro toolbar's view picker is a radio group; the flat mock keeps its one live group's
// value and handler here so each item renders as a clickable menuitemradio.
const radioGroup = vi.hoisted(() => ({
  value: undefined as string | undefined,
  onValueChange: undefined as ((v: string) => void) | undefined,
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuRadioGroup: ({
    children,
    value,
    onValueChange,
    'aria-label': label,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
    'aria-label'?: string;
  }) => {
    radioGroup.value = value;
    radioGroup.onValueChange = onValueChange;
    return (
      <div role="group" aria-label={label}>
        {children}
      </div>
    );
  },
  DropdownMenuRadioItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={radioGroup.value === value}
      onClick={() => radioGroup.onValueChange?.(value)}
    >
      {children}
    </button>
  ),
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  // VistasTabs' per-vista menu (only rendered once a saved vista exists).
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('../components/NewAvulsoDialog', () => ({
  NewAvulsoDialog: ({
    open,
    onClose,
    onCreated,
    onNeedsManualApply,
  }: {
    open: boolean;
    onClose: () => void;
    onCreated: (post: { id: number }) => void;
    onNeedsManualApply?: (
      post: { id: number; titulo: string | null; cliente_id: number | null },
      template: { id: number },
    ) => void;
  }) =>
    open ? (
      <div>
        <div>NewAvulsoDialogMock</div>
        <button
          onClick={() => {
            // Mirrors the real dialog's submit flow: onCreated then onClose.
            onCreated({ id: 77 });
            onClose();
          }}
        >
          Create avulso post
        </button>
        <button
          onClick={() => {
            // Template pré-vinculado com modo_prazo != 'padrao' (spec §3): o
            // post já foi criado, mas precisa do ApplyProcessDialog manual.
            onNeedsManualApply?.({ id: 77, titulo: 'Post avulso', cliente_id: 1 }, { id: 9 });
            onClose();
          }}
        >
          Create avulso post needing manual apply
        </button>
        <button onClick={onClose}>Close avulso dialog</button>
      </div>
    ) : null,
}));

vi.mock('../components/ApplyProcessDialog', () => ({
  ApplyProcessDialog: ({
    onClose,
    onApplied,
    post,
  }: {
    onClose: () => void;
    onApplied: (result: { post_id: number }) => void;
    post: { id: number };
  }) => (
    <div>
      <div>ApplyProcessDialogMock: {post.id}</div>
      <button onClick={onClose}>Cancel apply process</button>
      <button
        onClick={() => {
          // Mirrors the real dialog's confirm flow (ApplyProcessDialog.tsx):
          // onApplied() then onClose(), same batch.
          onApplied({ post_id: post.id });
          onClose();
        }}
      >
        Apply process
      </button>
    </div>
  ),
}));

vi.mock('../components/EntregasFilters', async (importOriginal) => ({
  // The pure helpers the phone header and filters sheet read.
  countActiveFilters: (await importOriginal<typeof import('../components/EntregasFilters')>())
    .countActiveFilters,
  STATUS_OPTIONS: (await importOriginal<typeof import('../components/EntregasFilters')>())
    .STATUS_OPTIONS,
  EMPTY_FILTERS: {
    filterClientes: [],
    filterMembros: [],
    filterPostResponsaveis: [],
    filterStatus: [],
    filterSearch: '',
    filterEtapas: [],
    filterTemplates: [],
    filterTipos: [],
    filterPostStatus: [],
    filterPrazo: [],
    filterPrazoFrom: '',
    filterPrazoTo: '',
  },
  EntregasFilters: ({
    filters,
    onChange,
    clientes,
    membros,
    mode,
    trailing,
  }: {
    filters: { filterClientes: number[]; filterMembros: number[]; filterStatus: string[] };
    onChange: (next: {
      filterClientes: number[];
      filterMembros: number[];
      filterStatus: string[];
    }) => void;
    clientes: Array<{ id: number; nome: string }>;
    membros: Array<{ id: number; nome: string }>;
    mode?: string;
    trailing?: React.ReactNode;
  }) => (
    <div data-testid="entregas-filters">
      {trailing}
      <div>Filters: {filters.filterStatus.join(',')}</div>
      <div>FiltersMode: {mode}</div>
      <div>Clientes: {clientes.length}</div>
      <div>Membros: {membros.length}</div>
      <button onClick={() => onChange({ ...filters, filterStatus: ['atrasado'] })}>
        Filter overdue
      </button>
      <button onClick={() => onChange({ ...filters, filterStatus: ['atrasado', 'urgente'] })}>
        Filter overdue and urgent
      </button>
      <button onClick={() => onChange({ ...filters, filterClientes: [10] })}>Filter client</button>
      <button onClick={() => onChange({ ...filters, filterMembros: [7] })}>Filter member</button>
      <button onClick={() => onChange({ ...filters, filterTipos: ['reels'] })}>Filter tipo</button>
      <button onClick={() => onChange({ ...filters, filterPostStatus: ['rascunho'] })}>
        Filter post status
      </button>
      <button onClick={() => onChange({ ...filters, filterPrazo: ['atrasado'] })}>
        Filter prazo atrasado
      </button>
      <button onClick={() => onChange({ ...filters, filterEtapas: ['Design'] })}>
        Filter etapa Design
      </button>
    </div>
  ),
}));

vi.mock('../views/KanbanView', () => ({
  KanbanView: ({
    cards,
    postEntities,
    showExample,
    onDismissExample,
    onCardClick,
    onEditClick,
    onPostsClick,
    onRecurring,
    onCreateTemplate,
    createTemplateDisabled,
  }: {
    cards: Array<{ workflow: { id: number; titulo: string } }>;
    postEntities?: Array<{ id: string }>;
    showExample?: boolean;
    onDismissExample?: () => void;
    onCardClick: (card: unknown) => void;
    onEditClick: (card: unknown) => void;
    onPostsClick: (card: unknown) => void;
    onRecurring: (workflowId: number) => void;
    onCreateTemplate?: () => void;
    createTemplateDisabled?: boolean;
  }) =>
    showExample ? (
      <div>
        <div>Posts de Agosto</div>
        <button onClick={onDismissExample}>Ocultar exemplo</button>
      </div>
    ) : cards.length === 0 && !postEntities?.length ? (
      <div>Nenhuma entrega encontrada. Ajuste os filtros ou crie um novo fluxo.</div>
    ) : (
      <div>
        {cards.length > 0 && (
          <div>Kanban view: {cards.map((card) => card.workflow.titulo).join(', ')}</div>
        )}
        {postEntities?.map((entity) => (
          <div key={entity.id} data-testid="post-process-card">
            {entity.id}
          </div>
        ))}
        {onCreateTemplate && (
          <button onClick={onCreateTemplate} disabled={createTemplateDisabled}>
            Create new template
          </button>
        )}
        {cards.length > 0 && (
          <>
            <button onClick={() => onEditClick(cards[0])}>Open edit modal</button>
            <button onClick={() => onCardClick(cards[0])}>Open drawer from card</button>
            <button onClick={() => onPostsClick(cards[0])}>Open drawer modal</button>
            <button onClick={() => onRecurring(cards[0].workflow.id)}>Trigger recurring</button>
          </>
        )}
      </div>
    ),
}));

// EntregasPage now reads profile.conta_id via useAuth; there is no AuthProvider in this suite.
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ profile: { conta_id: 'conta-1', role: 'owner' }, can: () => true }),
}));

const limitsMock = vi.hoisted(() => ({ features: null as Record<string, boolean> | null }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    features: limitsMock.features,
    planName: null,
    isLoading: false,
    isUnlimited: false,
  }),
}));

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({
    isAtLimit: () => false,
    hasFeature: () => true,
    features: {},
    limits: {},
    planName: null,
    isLoading: false,
  }),
}));

// SemProcessoSection is real in this suite and its PostStatusChip reads
// useStatusRegistry, which reaches getPostStatusDefinitions -- absent from
// storeMocks, and vitest throws on a missing mock export.
vi.mock('@/hooks/useStatusRegistry', () => ({
  useStatusRegistry: () => ({
    resolve: (p: { status: string }) => ({
      key: p.status,
      kind: 'canonical',
      canonical: p.status,
      label: p.status,
    }),
    options: [],
  }),
}));

// useCurrentMembro reads getMembros from `@/store` (the same module the literal
// `../../../store` mock above replaces, without getMembros): stub the hook.
const currentMembroMock = vi.hoisted(() => ({
  membro: null as { id: number; nome: string } | null,
  isLoading: false,
  isPending: false,
  isError: false,
  isSuccess: true,
}));
vi.mock('@/hooks/useCurrentMembro', () => ({
  useCurrentMembro: () => ({ ...currentMembroMock }),
}));

// jsdom's matchMedia is a stub; the Lista's Responsáveis panel is an inline
// aside on desktop and a Sheet below 901px. Each test picks the branch.
const isDesktopMock = vi.hoisted(() => ({ value: true }));
// Width-aware: `value: true` is a desktop width, `false` the 768-900 compact layout
// (bottom Sheets). The phone layout (< 768) is `phone: true`.
const viewportMock = vi.hoisted(() => ({ phone: false }));
vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: (min = 768) => (viewportMock.phone ? 390 : isDesktopMock.value ? 1280 : 800) >= min,
}));
// Page-level phone card commands: the board's own instances are covered by the
// Kanban suites; here they only need to exist.
vi.mock('../hooks/useWorkflowStageCommands', () => ({
  useWorkflowStageCommands: () => ({ forward: vi.fn(), revert: vi.fn(), dialogs: null }),
}));
vi.mock('../hooks/usePostProcessCommands', () => ({
  usePostProcessCommands: () => ({
    avancar: vi.fn(),
    voltar: vi.fn(),
    concluir: vi.fn(),
    reabrir: vi.fn(),
    remover: vi.fn(),
    dialogs: null,
  }),
}));

// Like FilaMembroPicker: the Lista controls (on the tabs line, after the tabs)
// are unit-tested on their own (ListToolbar.test.tsx / ResponsaveisPanel.test.tsx).
// The stub keeps the ref wiring: the page hands the toggle's ref to the toolbar to
// return focus to it when the aside closes.
vi.mock('../components/ListToolbar', () => ({
  ListToolbar: ({
    groupBy,
    groupByOptions,
    onGroupByChange,
    onToggleResponsaveis,
    responsaveisToggleRef,
    postados,
  }: {
    groupBy: string;
    groupByOptions: readonly string[];
    onGroupByChange: (g: string) => void;
    onToggleResponsaveis: () => void;
    responsaveisToggleRef?: Ref<HTMLButtonElement>;
    postados?: { count: number; shown: boolean; onToggle: () => void };
  }) => (
    <div>
      <div>GroupBy: {groupBy}</div>
      <div>GroupByOptions: {groupByOptions.join(',')}</div>
      <button onClick={() => onGroupByChange('cliente')}>Agrupar por cliente</button>
      {postados && (
        <button onClick={postados.onToggle}>
          Alternar postados ({postados.count}, {postados.shown ? 'visíveis' : 'ocultos'})
        </button>
      )}
      <button ref={responsaveisToggleRef} onClick={onToggleResponsaveis}>
        Alternar responsáveis
      </button>
    </div>
  ),
}));

vi.mock('../components/ResponsaveisPanel', () => ({
  ResponsaveisPanel: ({
    counts,
    selected,
    onChange,
    caption,
    onClose,
  }: {
    counts: ReadonlyMap<number, number>;
    selected: number[];
    onChange: (ids: number[]) => void;
    caption: string;
    onClose?: () => void;
  }) => (
    <div>
      <div>Contagens: {[...counts.entries()].map(([id, n]) => `${id}=${n}`).join(',')}</div>
      <div>Selecionados: {selected.join(',')}</div>
      <div>Legenda: {caption}</div>
      <button onClick={() => onChange([7])}>Marcar membro 7</button>
      {/* Like the real panel: only the desktop aside gets onClose (its X); the
          mobile Sheet closes itself. */}
      {onClose && <button onClick={onClose}>Fechar painel de responsáveis</button>}
    </div>
  ),
}));

// captureEvent is only asserted by the Minha fila analytics tests; the rest of
// the module stays real.
const analyticsMock = vi.hoisted(() => ({ captureEvent: vi.fn() }));
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  captureEvent: analyticsMock.captureEvent,
}));

vi.mock('../views/MinhaFilaView', () => ({
  MinhaFilaView: ({
    fila,
    membroId,
    currentMembroId,
    ordem,
    isLoading,
    isError,
  }: {
    fila: { items: unknown[] };
    membroId: number | null;
    currentMembroId: number | null;
    ordem?: string;
    isLoading: boolean;
    isError: boolean;
  }) => (
    <div>
      <div>
        Fila view: membro {membroId ?? 'none'} / self {currentMembroId ?? 'none'}
      </div>
      <div>Fila ordem: {ordem ?? 'unset'}</div>
      <div>Fila state: {isError ? 'error' : isLoading ? 'loading' : 'ready'}</div>
      <div>Fila items: {fila.items.length}</div>
    </div>
  ),
}));

// The member picker lives in the VistasTabs row, outside the view.
vi.mock('../components/FilaMembroPicker', () => ({
  FilaMembroPicker: ({ onChange }: { onChange: (id: number | null) => void }) => (
    <>
      <button onClick={() => onChange(12)}>Pick member 12</button>
      <button onClick={() => onChange(null)}>Pick self</button>
    </>
  ),
}));

vi.mock('../components/FilaOrdemPicker', () => ({
  FilaOrdemPicker: ({
    ordem,
    onChange,
  }: {
    ordem: string;
    onChange: (ordem: 'prazo' | 'publicacao') => void;
  }) => (
    <>
      <span>Ordem picker: {ordem}</span>
      <button onClick={() => onChange('publicacao')}>Order by publicacao</button>
    </>
  ),
}));

// Mock only startEntregasTour (driver.js can't run in jsdom); tourStorageKey stays real so the
// localStorage assertions exercise the true key format.
const tourMock = vi.hoisted(() => ({ startEntregasTour: vi.fn() }));
vi.mock('../tour/entregasTour', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startEntregasTour: tourMock.startEntregasTour,
}));

vi.mock('../views/ChartView', () => ({
  ChartView: ({
    cards,
    totalCards,
    filters,
    onFiltersChange,
    onCardClick,
    onGoToView,
    onGoToKanban,
  }: {
    cards: Array<{ workflow: { titulo: string } }>;
    totalCards: number;
    filters: Record<string, unknown>;
    onFiltersChange: (next: Record<string, unknown>) => void;
    onCardClick: (card: unknown) => void;
    onGoToView: (view: 'kanban' | 'list') => void;
    onGoToKanban?: () => void;
  }) => (
    <div>
      <div>Chart view: {cards.map((card) => card.workflow.titulo).join(', ')}</div>
      <div>Chart total: {totalCards}</div>
      <button onClick={() => onFiltersChange({ ...filters, filterPrazo: ['hoje'] })}>
        Chart KPI vencem hoje
      </button>
      <button onClick={() => onCardClick(cards[0])}>Open drawer from chart</button>
      <button onClick={() => onGoToView('list')}>Chart ver na lista</button>
      {onGoToKanban && <button onClick={onGoToKanban}>Chart somente fluxos</button>}
    </div>
  ),
}));

vi.mock('../views/CalendarView', () => ({
  CalendarView: ({
    cards,
    onCardClick,
  }: {
    cards: Array<{ workflow: { titulo: string } }>;
    onCardClick: (card: unknown) => void;
  }) => (
    <div>
      <div>Calendar view: {cards.map((card) => card.workflow.titulo).join(', ')}</div>
      <button onClick={() => onCardClick(cards[0])}>Open calendar drawer</button>
    </div>
  ),
}));

vi.mock('../views/ListView', () => ({
  ListView: ({
    cards,
    sort,
    onSortChange,
    groupBy,
  }: {
    cards: Array<{ workflow: { titulo: string } }>;
    sort: { column: string; direction: 'asc' | 'desc' };
    onSortChange: (next: { column: string; direction: 'asc' | 'desc' }) => void;
    groupBy?: string;
  }) => (
    <div>
      <div>List view: {cards.map((card) => card.workflow.titulo).join(', ')}</div>
      <div>ListGroupBy: {groupBy}</div>
      <div>
        Sort: {sort.column}/{sort.direction}
      </div>
      <button onClick={() => onSortChange({ column: 'deadline', direction: 'desc' })}>
        Change sort
      </button>
    </div>
  ),
}));

vi.mock('../views/ConcludedView', () => ({
  ConcludedView: () => <div>Concluded view</div>,
}));

vi.mock('../views/PostsKanbanView', () => ({
  PostsKanbanView: ({
    posts,
    onPostClick,
  }: {
    posts: unknown[];
    onPostClick: (post: { id: number; workflow_id: number | null }) => void;
  }) => (
    <div>
      Posts kanban view: {posts.length}
      <button onClick={() => onPostClick({ id: 999, workflow_id: null })}>
        Open avulso post from kanban
      </button>
    </div>
  ),
}));

vi.mock('../views/PostsListView', () => ({
  PostsListView: ({
    posts,
    onFluxoClick,
    groupBy,
    hiddenPostados,
  }: {
    posts: unknown[];
    onFluxoClick: (workflowId: number) => void;
    groupBy?: string;
    hiddenPostados?: number;
  }) => (
    <div>
      <div>Posts list view: {posts.length}</div>
      <div>PostsGroupBy: {groupBy}</div>
      <div>Postados ocultos: {hiddenPostados ?? 0}</div>
      <button onClick={() => onFluxoClick(1)}>Open fluxo from tag</button>
    </div>
  ),
}));

// Counts WorkflowDrawer mounts: a `&discussao=1` link to the post that is already open must
// refocus without remounting it (a remount drops the typed drafts and unsaved edits).
const drawerMounts = vi.hoisted(() => ({ count: 0 }));
function DrawerMountProbe() {
  useEffect(() => {
    drawerMounts.count += 1;
  }, []);
  return null;
}

vi.mock('../components/WorkflowDrawer', () => ({
  WorkflowDrawer: ({
    card,
    onClose,
    initialPostId,
    focusRequest,
    onDiscussaoFocused,
    onOpenWorkflow,
    onDetachedKeepingProcess,
  }: {
    card: { workflow: { titulo: string } };
    onClose: () => void;
    initialPostId?: number;
    focusRequest?: number;
    onDiscussaoFocused?: () => void;
    onOpenWorkflow?: (workflowId: number, seed?: unknown) => void;
    onDetachedKeepingProcess?: (postIds: number[]) => void;
  }) => (
    <div>
      <div>Workflow drawer: {card.workflow.titulo}</div>
      <div data-testid="drawer-initial-post">{initialPostId ?? 'none'}</div>
      <div data-testid="drawer-focus-discussao">{String(!!focusRequest)}</div>
      <div data-testid="drawer-focus-request">{focusRequest ?? 0}</div>
      <DrawerMountProbe />
      <input aria-label="Drawer draft" />
      <button onClick={onDiscussaoFocused}>Drawer focused discussao</button>
      <button onClick={onClose}>Close drawer</button>
      <button onClick={() => onOpenWorkflow?.(99)}>Move posts to workflow 99</button>
      <button
        onClick={() =>
          onOpenWorkflow?.(99, {
            workflow: { id: 99, titulo: 'Fluxo Novo', cliente_id: 10, status: 'ativo' },
            etapas: [
              { id: 990, workflow_id: 99, ordem: 0, nome: 'Copy', status: 'ativo', prazo_dias: 2 },
            ],
          })
        }
      >
        Move posts to workflow 99 with seed
      </button>
      <button onClick={() => onDetachedKeepingProcess?.([77])}>Detach keeping process</button>
    </div>
  ),
}));

// StandalonePostDrawer pulls in most of `store` for real (getPostApprovals,
// getWorkspaceUsers, etc.) -- functions the file-wide `../../../store` mock above
// deliberately doesn't stub (it only provides duplicateWorkflow/getStandalonePost).
// Stubbed the same way WorkflowDrawer is above: EntregasPage's own wiring
// (standalonePostId state, onAttached) is what these tests exercise, not the
// drawer's internals.
vi.mock('../components/StandalonePostDrawer', () => ({
  StandalonePostDrawer: ({
    postId,
    focusRequest,
    onClose,
    onAttached,
  }: {
    postId: number;
    focusRequest?: number;
    onClose: () => void;
    onAttached: (workflowId: number, postId: number) => void;
  }) => (
    <div>
      <div>Standalone drawer: {postId}</div>
      <div data-testid="standalone-focus-discussao">{String(!!focusRequest)}</div>
      <button onClick={onClose}>Close standalone drawer</button>
      <button onClick={() => onAttached(2, postId)}>Attach standalone post to fluxo 2</button>
    </div>
  ),
}));

vi.mock('../wizard/NewWorkflowWizard', () => ({
  NewWorkflowWizard: ({
    open,
    onClose,
    onCreated,
  }: {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
  }) =>
    open ? (
      <div>
        <div>WizardMock</div>
        <button onClick={onCreated}>Created workflow</button>
        <button onClick={onClose}>Close new modal</button>
      </div>
    ) : null,
}));

vi.mock('../components/WorkflowModals', () => ({
  EditWorkflowModal: ({
    card,
    onClose,
    onSaved,
    onDeleted,
    onOpenPosts,
  }: {
    card: { workflow: { titulo: string } };
    onClose: () => void;
    onSaved: () => void;
    onDeleted: () => void;
    onOpenPosts: () => void;
  }) => (
    <div>
      <div>Edit workflow modal: {card.workflow.titulo}</div>
      <button onClick={onSaved}>Save workflow</button>
      <button onClick={onDeleted}>Delete workflow</button>
      <button onClick={onOpenPosts}>Open posts from edit</button>
      <button onClick={onClose}>Close edit modal</button>
    </div>
  ),
  TemplatesModal: ({
    open,
    onClose,
    onRefresh,
  }: {
    open: boolean;
    onClose: () => void;
    onRefresh: () => void;
  }) =>
    open ? (
      <div>
        <div>Templates modal</div>
        <button onClick={onRefresh}>Refresh templates</button>
        <button onClick={onClose}>Close templates modal</button>
      </div>
    ) : null,
  RecurringWorkflowDialog: ({
    open,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div>
        <div>Recurring dialog</div>
        <button onClick={onConfirm}>Confirm recurring</button>
        <button onClick={onCancel}>Cancel recurring</button>
      </div>
    ) : null,
}));

// The view is a placeholder until Task 8; the stub exposes the props the page hands it.
vi.mock('../linha/LinhaEditorialView', () => ({
  LinhaEditorialView: ({
    filterClientes,
    mes,
    clientes,
  }: {
    filterClientes: number[];
    mes: string;
    clientes: unknown[];
  }) => (
    <div data-testid="linha-view">
      linha: clientes={filterClientes.join(',')} mes={mes} lista={clientes.length}
    </div>
  ),
}));

import { useEntregasData } from '../hooks/useEntregasData';
import EntregasPage from '../EntregasPage';

const mockedUseEntregasData = vi.mocked(useEntregasData);

function PathProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname + location.search}</div>;
}

function renderPage(initialEntry: string) {
  mockedUseEntregasData.mockReturnValue({
    clientes: [{ id: 14, nome: 'Clínica Aurora' }],
    membros: [],
    templates: [],
    cards: [],
    activeWorkflows: [],
    postEntities: [],
    processByPostId: new Map(),
    concludedPostProcesses: [],
    activePostProcessCount: 0,
    postProcessesVisible: true,
    isLoading: false,
    refresh: vi.fn(),
  } as never);
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/entregas"
          element={
            <>
              <EntregasPage />
              <PathProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  savedViewsMock.views = [];
  viewportMock.phone = false;
  limitsMock.features = null;
  currentMembroMock.membro = { id: 7, nome: 'Ana' };
  localStorage.clear();
  localStorage.setItem('entregas_explainer_dismissed_conta-1', 'true');
});

describe('Entregas: aba Linha editorial', () => {
  it('tab hidden when flag off', () => {
    limitsMock.features = { feature_linha_editorial: false };
    renderPage('/entregas');
    expect(screen.getByRole('tab', { name: /Lista/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Linha editorial/ })).not.toBeInTheDocument();
  });

  it('view=linha falls back to kanban when flag off', async () => {
    limitsMock.features = { feature_linha_editorial: false };
    renderPage('/entregas?view=linha&clientes=14&mes=2026-11');
    expect(await screen.findByRole('tab', { name: /Kanban/, selected: true })).toBeInTheDocument();
    expect(screen.queryByTestId('linha-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('current-path').textContent).not.toContain('view=linha');
  });

  it('does not fall back while features are still loading (null)', () => {
    limitsMock.features = null;
    renderPage('/entregas?view=linha&clientes=14&mes=2026-11');
    expect(screen.getByTestId('current-path').textContent).toContain('view=linha');
    expect(screen.getByTestId('current-path').textContent).toContain('mes=2026-11');
    expect(screen.queryByRole('tab', { name: /Kanban/, selected: true })).not.toBeInTheDocument();
  });

  it('tab shown and renders LinhaEditorialView when flag on', () => {
    limitsMock.features = { feature_linha_editorial: true };
    renderPage('/entregas?view=linha&clientes=14&mes=2026-11');
    expect(
      screen.getByRole('tab', { name: /Linha editorial/, selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('linha-view')).toHaveTextContent(
      'linha: clientes=14 mes=2026-11 lista=1',
    );
    expect(screen.getByTestId('current-path').textContent).toContain('view=linha');
  });

  it('mode and entidade toggles hidden in linha view', () => {
    limitsMock.features = { feature_linha_editorial: true };
    // On the kanban the toggles exist (postProcessesVisible is true in this fixture)...
    const { unmount } = renderPage('/entregas');
    expect(screen.getByRole('button', { name: 'Etapas' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Entidades do quadro' })).toBeInTheDocument();
    unmount();
    // ...and in the linha view neither the mode nor the entity toggle renders.
    renderPage('/entregas?view=linha&clientes=14');
    expect(screen.getByTestId('linha-view')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Etapas' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('radiogroup', { name: 'Entidades do quadro' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('entregas-filters')).not.toBeInTheDocument();
  });
});

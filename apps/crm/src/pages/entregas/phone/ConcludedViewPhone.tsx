import type { ReactNode } from 'react';
import { ChevronRight, FileText, GitFork, RotateCcw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  Cliente,
  ConcludedWorkflowSummary,
  PostProcessWithPost,
  Workflow,
} from '../../../store';
import { useOverlayHistoryEntry } from '@/hooks/useOverlayHistoryEntry';
import { ClienteAvatar } from '@/pages/mensagens/components/Avatars';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { SwipeRow } from '@/components/mobile/SwipeRow';
import { useSheetActions } from '@/components/mobile/sheetActions';
import { PhoneConfirmSheet } from './PhoneConfirmSheet';
import './viewsPhone.css';

export interface ConcludedClientGroup {
  cliente: Cliente;
  workflows: ConcludedWorkflowSummary[];
  processes: PostProcessWithPost[];
}

export interface ConcludedViewPhoneProps {
  visibleGroups: ConcludedClientGroup[];
  clientSearch: string;
  /** Absent: the search field isn't shown (the page owns `clientSearch`). */
  onClientSearchChange?: (value: string) => void;
  clienteAvatars?: Map<number, string>;
  selectedGroup: ConcludedClientGroup | null;
  onSelectCliente: (clienteId: number | null) => void;
  fluxoSearch: string;
  onFluxoSearchChange: (value: string) => void;
  visibleWorkflows: ConcludedWorkflowSummary[];
  visibleProcesses: PostProcessWithPost[];
  /** A workflow's history (HistoryDrawer) is open: it gets a history entry here. */
  workflowOpen: boolean;
  onOpenWorkflow: (workflow: Workflow, clienteName: string) => void;
  onCloseWorkflow: () => void;
  onOpenPost?: (postId: number) => void;
  reopenTarget: { id: number; titulo: string } | null;
  onReopenWorkflow: (target: { id: number; titulo: string }) => void;
  onReopenConfirm: () => void;
  onReopenCancel: () => void;
  onReopenProcess: (process: PostProcessWithPost) => void;
  formatDateShort: (iso: string) => string;
}

function clientStats(g: ConcludedClientGroup, t: TFunction<'entregasPhone'>): string {
  const p = g.processes.length;
  const fluxos = t('concluded.fluxosConcluded', { count: g.workflows.length });
  return p > 0 ? `${fluxos} · ${t('concluded.individualPosts', { count: p })}` : fluxos;
}

function SearchField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className="phone-ent-v-search">
      <Search aria-hidden="true" />
      <input
        type="search"
        className="phone-ent-v-search__input"
        placeholder={label}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** A row that swipes left to "Reabrir" (also reachable by Tab, see SwipeRow). */
function ReopenableRow({
  icon,
  title,
  meta,
  reopenLabel,
  onOpen,
  onReopen,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  reopenLabel: string;
  onOpen: () => void;
  onReopen: () => void;
}) {
  return (
    <SwipeRow
      as="li"
      className="phone-cell"
      trailingActions={[
        {
          label: reopenLabel,
          icon: <RotateCcw />,
          tone: 'ink',
          onAction: onReopen,
        },
      ]}
    >
      <button type="button" className="phone-cell__main" onClick={onOpen}>
        <span className="phone-cell__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="phone-cell__body">
          <span className="phone-cell__text">
            <span className="phone-cell__label">{title}</span>
            <span className="phone-cell__subtitle">{meta}</span>
          </span>
          <ChevronRight className="phone-cell__chevron" aria-hidden="true" />
        </span>
      </button>
    </SwipeRow>
  );
}

function ClientSheetBody({
  group,
  fluxoSearch,
  onFluxoSearchChange,
  visibleWorkflows,
  visibleProcesses,
  onOpenWorkflow,
  onOpenPost,
  onReopenWorkflow,
  onReopenProcess,
  formatDateShort,
}: Pick<
  ConcludedViewPhoneProps,
  | 'fluxoSearch'
  | 'onFluxoSearchChange'
  | 'visibleWorkflows'
  | 'visibleProcesses'
  | 'onOpenWorkflow'
  | 'onOpenPost'
  | 'onReopenWorkflow'
  | 'onReopenProcess'
  | 'formatDateShort'
> & { group: ConcludedClientGroup }) {
  // Opening a workflow or a post replaces this sheet: close it first so its history
  // entry is gone before the next layer pushes its own.
  const { t } = useTranslation('entregasPhone');
  const { closeThen } = useSheetActions();
  const empty = visibleWorkflows.length === 0 && visibleProcesses.length === 0;
  return (
    <div className="phone-ent-v-sheet-body">
      <SearchField
        value={fluxoSearch}
        onChange={onFluxoSearchChange}
        label={t('concluded.searchFluxo')}
      />
      {empty ? (
        <p className="phone-ent-v-empty">{t('concluded.noFluxoFound', { search: fluxoSearch })}</p>
      ) : (
        <GroupedList
          aria-label={t('concluded.groupAria', { cliente: group.cliente.nome })}
          footer={t('concluded.swipeFooter')}
        >
          {visibleWorkflows.map((s) => (
            <ReopenableRow
              key={s.workflow.id}
              icon={<GitFork />}
              title={s.workflow.titulo}
              meta={[
                t('concluded.posts', { count: s.postCount }),
                s.totalDays !== null ? t('concluded.days', { count: s.totalDays }) : null,
                s.completedAt
                  ? t('concluded.concludedOn', { date: formatDateShort(s.completedAt) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              reopenLabel={t('concluded.reopen')}
              onOpen={() => closeThen(() => onOpenWorkflow(s.workflow, group.cliente.nome))}
              onReopen={() => onReopenWorkflow({ id: s.workflow.id!, titulo: s.workflow.titulo })}
            />
          ))}
          {visibleProcesses.map((proc) => (
            <ReopenableRow
              key={`proc-${proc.id}`}
              icon={<FileText />}
              title={proc.post.titulo || t('shared.untitledPost')}
              meta={[
                t('shared.individualPost'),
                proc.template_nome ?? t('concluded.customEtapas'),
                proc.concluido_em
                  ? t('concluded.concludedOn', { date: formatDateShort(proc.concluido_em) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              reopenLabel={t('concluded.reopen')}
              onOpen={() => closeThen(() => onOpenPost?.(proc.post_id))}
              onReopen={() => onReopenProcess(proc)}
            />
          ))}
        </GroupedList>
      )}
    </div>
  );
}

/**
 * Concluídas below 768px: the client search (moved here from the page's toggles row),
 * clients as grouped rows, and the same drill-down as the desktop: client sheet with
 * its fluxo search, workflows and individual posts, then the workflow history or the
 * post. Reabrir keeps its confirmation, as an action sheet.
 */
export function ConcludedViewPhone(p: ConcludedViewPhoneProps) {
  const { t } = useTranslation('entregasPhone');
  useOverlayHistoryEntry(p.workflowOpen, p.onCloseWorkflow);
  const group = p.selectedGroup;

  return (
    <div className="phone-ent-v">
      {p.onClientSearchChange && (
        <SearchField
          value={p.clientSearch}
          onChange={p.onClientSearchChange}
          label={t('concluded.searchCliente')}
        />
      )}

      {p.visibleGroups.length === 0 ? (
        <p className="phone-ent-v-empty">
          {t('concluded.noClienteFound', { search: p.clientSearch })}
        </p>
      ) : (
        <GroupedList aria-label={t('concluded.clientsAria')} className="phone-ent-v-group">
          {p.visibleGroups.map((g) => (
            <Cell
              key={g.cliente.id}
              icon={
                <ClienteAvatar
                  nome={g.cliente.nome}
                  fotoUrl={p.clienteAvatars?.get(g.cliente.id!)}
                  cliente={g.cliente}
                />
              }
              label={g.cliente.nome}
              subtitle={clientStats(g, t)}
              chevron
              onClick={() => {
                p.onFluxoSearchChange('');
                p.onSelectCliente(g.cliente.id!);
              }}
            />
          ))}
        </GroupedList>
      )}

      <BottomSheet
        open={group !== null}
        onOpenChange={(open) => {
          if (!open) p.onSelectCliente(null);
        }}
        title={group?.cliente.nome ?? ''}
        description={
          group ? t('concluded.sheetDescription', { cliente: group.cliente.nome }) : undefined
        }
        detents={['large']}
      >
        {group && (
          <ClientSheetBody
            group={group}
            fluxoSearch={p.fluxoSearch}
            onFluxoSearchChange={p.onFluxoSearchChange}
            visibleWorkflows={p.visibleWorkflows}
            visibleProcesses={p.visibleProcesses}
            onOpenWorkflow={p.onOpenWorkflow}
            onOpenPost={p.onOpenPost}
            onReopenWorkflow={p.onReopenWorkflow}
            onReopenProcess={p.onReopenProcess}
            formatDateShort={p.formatDateShort}
          />
        )}
      </BottomSheet>

      <PhoneConfirmSheet
        open={p.reopenTarget !== null}
        title={t('concluded.reopenTitle')}
        message={t('concluded.reopenMessage', { titulo: p.reopenTarget?.titulo ?? '' })}
        actions={[{ label: t('concluded.reopen'), onSelect: p.onReopenConfirm }]}
        onCancel={p.onReopenCancel}
      />
    </div>
  );
}

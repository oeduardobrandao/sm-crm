import { useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { SwipeRow, type SwipeAction } from '@/components/mobile/SwipeRow';
import type { Membro, TarefaWithRelations } from '../../../store';
import { DUE_BUCKETS, groupByDueBucket, STATUS_LABELS, STATUS_ORDER } from '../tarefasLogic';
import { setTarefaStatus, toggleTarefaConcluida } from '../tarefaCommands';
import { MembroAvatar, membroOf, TarefaCheck, TarefaMeta } from './parts';
import { TarefaActionsMenu, type TarefaActionsMenuApi } from './TarefaActionsMenu';
import './tarefasPhone.css';

export interface TarefasPhoneListProps {
  tarefas: TarefaWithRelations[];
  membros: Membro[];
  onTarefaClick: (tarefa: TarefaWithRelations) => void;
  onRefresh: () => void;
}

/** One list row (FTarefas): completion circle, title + meta line, avatar. Swipe right
 *  completes or reopens, swipe left shows Mais and Excluir, a hold opens the menu. */
export function TarefaPhoneRow({
  tarefa,
  membro,
  now,
  onOpen,
  onRefresh,
}: {
  tarefa: TarefaWithRelations;
  membro: Membro | null;
  now: Date;
  onOpen: () => void;
  onRefresh: () => void;
}) {
  const done = tarefa.status === 'concluida';
  const menuRef = useRef<TarefaActionsMenuApi | null>(null);
  const toggle = () => void toggleTarefaConcluida(tarefa, !done, onRefresh);

  const leading: SwipeAction[] = [
    {
      label: done ? 'Reabrir' : 'Concluir',
      icon: done ? <RotateCcw aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />,
      tone: 'success',
      onAction: toggle,
    },
  ];
  const trailing: SwipeAction[] = [
    {
      label: 'Mais',
      icon: <MoreHorizontal aria-hidden="true" />,
      tone: 'neutral',
      onAction: () => menuRef.current?.openMenu(),
    },
    {
      label: 'Excluir',
      icon: <Trash2 aria-hidden="true" />,
      tone: 'destructive',
      onAction: () => menuRef.current?.requestDelete(),
    },
  ];

  return (
    <SwipeRow as="li" leadingActions={leading} trailingActions={trailing}>
      <TarefaActionsMenu
        tarefa={tarefa}
        apiRef={menuRef}
        moveTitle="Mover para"
        moveTargets={STATUS_ORDER.filter((s) => s !== tarefa.status).map((s) => ({
          id: s,
          label: STATUS_LABELS[s],
        }))}
        onMove={(status) =>
          void setTarefaStatus(tarefa, status as TarefaWithRelations['status'], onRefresh)
        }
        onRefresh={onRefresh}
      >
        {() => (
          <div className="phone-tar-row-item" data-done={done || undefined}>
            <TarefaCheck
              checked={done}
              label={done ? 'Reabrir tarefa' : 'Concluir tarefa'}
              onToggle={toggle}
            />
            <button type="button" className="phone-tar-row-item__main" onClick={onOpen}>
              <span className="phone-tar-row-item__text">
                <span className="phone-tar-row-item__title">{tarefa.titulo}</span>
                <TarefaMeta tarefa={tarefa} now={now} />
              </span>
              <MembroAvatar membro={membro} />
            </button>
          </div>
        )}
      </TarefaActionsMenu>
    </SwipeRow>
  );
}

/**
 * Lista below 768px (FTarefas): one grouped card per due bucket with the same buckets,
 * sorting and "Concluídas" (last 50) as the desktop list.
 */
export function TarefasPhoneList({
  tarefas,
  membros,
  onTarefaClick,
  onRefresh,
}: TarefasPhoneListProps) {
  const [showConcluidas, setShowConcluidas] = useState(false);
  const now = new Date();
  const buckets = groupByDueBucket(tarefas, now);
  const concluidas = tarefas
    .filter((t) => t.status === 'concluida')
    .sort((a, b) => (b.concluida_em ?? '').localeCompare(a.concluida_em ?? ''))
    .slice(0, 50);
  const totalOpen = DUE_BUCKETS.reduce((sum, b) => sum + buckets[b.id].length, 0);

  const row = (t: TarefaWithRelations) => (
    <TarefaPhoneRow
      key={t.id}
      tarefa={t}
      membro={membroOf(membros, t)}
      now={now}
      onOpen={() => onTarefaClick(t)}
      onRefresh={onRefresh}
    />
  );

  return (
    <div className="phone-tar-lista">
      {totalOpen === 0 && (
        <p className="phone-tar-empty">
          Nenhuma tarefa aberta. Crie uma nova ou ajuste os filtros.
        </p>
      )}
      {DUE_BUCKETS.map((bucket) => {
        const items = buckets[bucket.id];
        if (items.length === 0) return null;
        const headId = `phone-tar-bucket-${bucket.id}`;
        return (
          <section key={bucket.id} className="phone-tar-section" aria-labelledby={headId}>
            <h2
              id={headId}
              className="phone-tar-section__head"
              data-danger={bucket.id === 'atrasadas' || undefined}
            >
              {bucket.label}
              <span className="phone-tar-section__count">{items.length}</span>
            </h2>
            <ul className="phone-tar-list">{items.map(row)}</ul>
          </section>
        );
      })}

      {concluidas.length > 0 && (
        <section className="phone-tar-section">
          <ul className="phone-tar-list">
            <li>
              <button
                type="button"
                className="phone-tar-toggle"
                aria-expanded={showConcluidas}
                onClick={() => setShowConcluidas((v) => !v)}
              >
                <span className="phone-tar-toggle__label">Concluídas</span>
                <span className="phone-tar-toggle__count">{concluidas.length}</span>
                <ChevronRight aria-hidden="true" />
              </button>
            </li>
            {showConcluidas && concluidas.map(row)}
          </ul>
        </section>
      )}
    </div>
  );
}

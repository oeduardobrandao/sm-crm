import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Pause, Play, Plus, Repeat, Trash2, X } from 'lucide-react';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { useSheetHistory } from '@/components/mobile/useSheetHistory';
import type {
  Membro,
  Subtarefa,
  TarefaSerieResumo,
  TarefaStatus,
  TarefaWithRelations,
} from '../../../store';
import { parseDateOnly, STATUS_LABELS, STATUS_ORDER } from '../tarefasLogic';
import { describeRecorrencia, modoLabel, type SerieEstado } from '../recorrenciaLogic';
import { rescheduleTarefa } from '../tarefaCommands';
import { TarefaDescriptionContent } from '../components/TarefaDescriptionContent';
import { DueChip, MembroAvatar, TagChip, TarefaCheck } from './parts';
import { PrazoSheet } from './PrazoSheet';
import { TarefaDeleteConfirm } from './TarefaDeleteConfirm';
import './tarefasPhone.css';

export interface TarefaDetailPhoneProps {
  /** Keep it mounted and toggle this: the history entry is popped on close only while
   *  the screen is mounted (useOverlayHistoryEntry never pops on unmount). */
  open: boolean;
  tarefa: TarefaWithRelations;
  membros: Membro[];
  subtarefas: Subtarefa[];
  serie: TarefaSerieResumo | null;
  estado: SerieEstado | null;
  estadoLabel: string | null;
  serieBusy: boolean;
  newSubtarefa: string;
  onNewSubtarefaChange: (value: string) => void;
  onAddSubtarefa: () => void;
  onToggleSubtarefa: (id: number, concluida: boolean) => void;
  onDeleteSubtarefa: (id: number) => void;
  onStatusChange: (status: TarefaStatus) => void;
  onAssign: (responsavelId: number | null) => void;
  onSerieEstado: (verbo: 'pausar' | 'retomar' | 'encerrar') => void;
  onClose: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}

/**
 * TarefaDetailSheet's phone face (FTarefaDetalhe): a pushed screen with a nav bar
 * (Voltar, Excluir, Editar), the status as a segmented control, responsável as a picker
 * row, prazo, cliente, the series controls, the description and the subtarefas. Every
 * write is the sheet's own handler; confirms are action sheets.
 *
 * Portaled full-screen region, not a dialog: the screen can stay open for a while and
 * `isDocumentBusy` (silent deploy swaps) treats any open dialog as unsaved work. It sits
 * over the tab bar and under the kit sheets, so pickers, confirms and the edit form
 * stack over it.
 */
export function TarefaDetailPhone(p: TarefaDetailPhoneProps) {
  const { open, onClose } = p;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => onCloseRef.current(), []);
  useSheetHistory(open, close);

  // Focus the screen when it opens (a screen reader starts at its heading); give focus
  // back to whatever opened it on close.
  const rootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={rootRef}
      role="region"
      aria-label={`Tarefa: ${p.tarefa.titulo}`}
      tabIndex={-1}
      className="phone-kit phone-tar-screen"
      data-testid="tarefa-detail-phone"
    >
      <DetailBody {...p} />
    </div>,
    document.body,
  );
}

function DetailBody({
  tarefa,
  membros,
  subtarefas,
  serie,
  estado,
  estadoLabel,
  serieBusy,
  newSubtarefa,
  onNewSubtarefaChange,
  onAddSubtarefa,
  onToggleSubtarefa,
  onDeleteSubtarefa,
  onStatusChange,
  onAssign,
  onSerieEstado,
  onClose,
  onEdit,
  onRefresh,
}: TarefaDetailPhoneProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEncerrar, setConfirmEncerrar] = useState(false);
  const [prazoOpen, setPrazoOpen] = useState(false);
  const now = new Date();
  const membro = membros.find((m) => m.id === tarefa.responsavel_id) ?? null;
  const sortedMembros = membros
    .filter((m) => m.id != null)
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const doneCount = subtarefas.filter((s) => s.concluida).length;
  const hasDescription = !!(tarefa.descricao_rich || tarefa.descricao);

  return (
    <>
      <div className="phone-tar-screen__bar">
        <PhoneNavBar
          backLabel="Voltar para Tarefas"
          onBack={onClose}
          trailing={
            <>
              <PhoneIconButton
                label="Excluir"
                className="phone-tar-detail__delete"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden="true" />
              </PhoneIconButton>
              <button type="button" className="phone-tar-detail__edit" onClick={onEdit}>
                Editar
              </button>
            </>
          }
        />
      </div>

      <div className="phone-tar-screen__body">
        <h1 className="phone-tar-detail__title">{tarefa.titulo}</h1>
        {tarefa.tags.length > 0 && (
          <div className="phone-tar-tags phone-tar-detail__tags">
            {tarefa.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </div>
        )}

        <SegmentedControl
          aria-label="Status da tarefa"
          className="phone-tar-detail__status"
          value={tarefa.status}
          onChange={onStatusChange}
          options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        />

        <GroupedList aria-label="Detalhes da tarefa">
          <PickerCell<number>
            label="Responsável"
            icon={<MembroAvatar membro={membro} />}
            options={sortedMembros.map((m) => ({
              value: m.id!,
              label: m.nome,
              icon: <MembroAvatar membro={m} large />,
            }))}
            emptyOption={{ label: 'Sem responsável' }}
            searchable={sortedMembros.length > 8}
            value={tarefa.responsavel_id ?? null}
            onChange={(id) => onAssign(id)}
          />
          <Cell
            label="Prazo"
            value={
              tarefa.data_limite
                ? parseDateOnly(tarefa.data_limite).toLocaleDateString('pt-BR')
                : 'Sem prazo'
            }
            accessory={<DueChip tarefa={tarefa} now={now} />}
            chevron
            aria-haspopup="dialog"
            onClick={() => setPrazoOpen(true)}
          />
          {tarefa.cliente_nome && <Cell label="Cliente" value={tarefa.cliente_nome} />}
        </GroupedList>

        {serie && estado && (
          <GroupedList header="Repetição">
            <li className="phone-cell">
              <div className="phone-tar-detail__repeat">
                <Repeat aria-hidden="true" />
                <span>
                  Repete: {describeRecorrencia(serie)} · {modoLabel(serie.modo)}
                  {estadoLabel && <span className="phone-tar-detail__estado">{estadoLabel}</span>}
                </span>
              </div>
            </li>
            {estado === 'ativa' && (
              <Cell
                label="Pausar série"
                icon={<Pause aria-hidden="true" />}
                disabled={serieBusy}
                onClick={() => onSerieEstado('pausar')}
              />
            )}
            {estado === 'pausada' && (
              <Cell
                label="Retomar série"
                icon={<Play aria-hidden="true" />}
                disabled={serieBusy}
                onClick={() => onSerieEstado('retomar')}
              />
            )}
            {(estado === 'ativa' || estado === 'pausada') && (
              <Cell
                label="Encerrar série"
                icon={<Ban aria-hidden="true" />}
                disabled={serieBusy}
                onClick={() => setConfirmEncerrar(true)}
              />
            )}
          </GroupedList>
        )}

        {hasDescription && (
          <>
            <h2 className="phone-tar-detail__desc-head">Descrição</h2>
            <div className="phone-tar-detail__desc">
              <TarefaDescriptionContent
                richContent={tarefa.descricao_rich}
                plainText={tarefa.descricao}
              />
            </div>
          </>
        )}

        <h2 className="phone-tar-detail__desc-head">
          Subtarefas{subtarefas.length > 0 && ` · ${doneCount}/${subtarefas.length}`}
        </h2>
        <ul className="phone-tar-list">
          {subtarefas.map((s) => (
            <li key={s.id} className="phone-tar-sub" data-done={s.concluida || undefined}>
              <TarefaCheck
                small
                checked={s.concluida}
                label={s.concluida ? `Desmarcar ${s.titulo}` : `Marcar ${s.titulo}`}
                onToggle={() => onToggleSubtarefa(s.id!, !s.concluida)}
              />
              <span className="phone-tar-sub__title">{s.titulo}</span>
              <button
                type="button"
                className="phone-tar-sub__remove"
                aria-label={`Remover subtarefa ${s.titulo}`}
                onClick={() => onDeleteSubtarefa(s.id!)}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
          <li className="phone-tar-sub">
            <input
              type="text"
              aria-label="Nova subtarefa"
              placeholder="Nova subtarefa..."
              enterKeyHint="done"
              value={newSubtarefa}
              onChange={(e) => onNewSubtarefaChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onAddSubtarefa();
                }
              }}
            />
            <button
              type="button"
              className="phone-tar-sub__add"
              aria-label="Adicionar subtarefa"
              disabled={!newSubtarefa.trim()}
              onClick={onAddSubtarefa}
            >
              <Plus aria-hidden="true" />
            </button>
          </li>
        </ul>
        {serie && (
          <p className="phone-tar-footnote">
            As próximas ocorrências usam a lista da série. Para mudar, edite a tarefa e escolha Esta
            e as próximas.
          </p>
        )}
      </div>

      <TarefaDeleteConfirm
        tarefa={tarefa}
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onRefresh={onRefresh}
        onDeleted={onClose}
      />
      <PhoneConfirmSheet
        open={confirmEncerrar}
        onCancel={() => setConfirmEncerrar(false)}
        title="Encerrar série?"
        message="As ocorrências já criadas continuam como estão. Nenhuma nova será criada."
        actions={[
          {
            label: 'Encerrar',
            destructive: true,
            disabled: serieBusy,
            onSelect: () => {
              setConfirmEncerrar(false);
              onSerieEstado('encerrar');
            },
          },
        ]}
      />
      <PrazoSheet
        tarefa={tarefa}
        open={prazoOpen}
        onOpenChange={setPrazoOpen}
        onSave={(date) => void rescheduleTarefa(tarefa, date, onRefresh)}
      />
    </>
  );
}

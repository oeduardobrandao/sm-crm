import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  CopyPlus,
  Edit2,
  ExternalLink,
  FileText,
  FolderMinus,
  Trash2,
  User,
  UserRound,
} from 'lucide-react';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import {
  ContextMenu,
  type ContextMenuAction,
  type ContextMenuTriggerProps,
} from '@/components/mobile/ContextMenu';
import { copyAppLink } from '@/lib/copyAppLink';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials } from '@/lib/initials';
import { sanitizeUrl } from '@/utils/security';
import { updateWorkflowEtapa, type Membro } from '../../../store';
import type { BoardCard } from '../hooks/useEntregasData';
import type { PostEntity } from '../boardEntity';
import { WorkflowHistoryView } from '../components/WorkflowHistoryView';
import { workflowForwardLabel } from './phoneFormat';
import './entregasPhone.css';

type MenuChildren = (api: { triggerProps: ContextMenuTriggerProps }) => ReactNode;

export interface WorkflowCardMenuProps {
  card: BoardCard;
  /** Present: "Atribuir/Trocar responsável" opens the member picker. */
  membros?: Membro[];
  onRefresh?: () => void;
  onOpenPosts?: () => void;
  onEdit?: () => void;
  onForward?: () => void;
  onRevert?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** Reordenar mode: the hold belongs to the drag. */
  disabled?: boolean;
  preview?: ReactNode;
  className?: string;
  children: MenuChildren;
}

/**
 * Long-press menu (and "…" button) of a fluxo card on phones, with everything the
 * desktop card offers across its kebab, the check button, the assignee dropdown, the
 * Hub chip, the cliente link and the history popover (EntregasCardMenu mockup).
 * Shared by the Kanban, Lista and Minha fila rows.
 */
export function WorkflowCardMenu({
  card,
  membros,
  onRefresh,
  onOpenPosts,
  onEdit,
  onForward,
  onRevert,
  onDuplicate,
  onDelete,
  disabled,
  preview,
  className,
  children,
}: WorkflowCardMenuProps) {
  const navigate = useNavigate();
  const [assignOpen, setAssignOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const stage: ContextMenuAction[] = [];
  if (onForward)
    stage.push({
      label: workflowForwardLabel(card),
      icon: <Check aria-hidden="true" />,
      onSelect: onForward,
    });
  if (onRevert && card.etapaIdx > 0)
    stage.push({
      label: 'Voltar etapa',
      icon: <ArrowLeft aria-hidden="true" />,
      onSelect: onRevert,
    });
  if (membros)
    stage.push({
      label: card.membro ? 'Trocar responsável' : 'Atribuir responsável',
      icon: <User aria-hidden="true" />,
      onSelect: () => setAssignOpen(true),
    });

  const open: ContextMenuAction[] = [];
  if (onOpenPosts)
    open.push({
      label: 'Abrir posts',
      icon: <FileText aria-hidden="true" />,
      onSelect: onOpenPosts,
    });
  if (onEdit) open.push({ label: 'Editar', icon: <Edit2 aria-hidden="true" />, onSelect: onEdit });
  if (onDuplicate)
    open.push({
      label: 'Duplicar fluxo',
      icon: <CopyPlus aria-hidden="true" />,
      onSelect: onDuplicate,
    });
  open.push({
    label: 'Copiar link do fluxo',
    icon: <Copy aria-hidden="true" />,
    onSelect: () => void copyAppLink(`/entregas?drawer=${card.workflow.id}`),
  });
  if (card.hubUrl) {
    const hubUrl = card.hubUrl;
    open.push({
      label: 'Abrir Hub do cliente',
      icon: <ExternalLink aria-hidden="true" />,
      onSelect: () => window.open(sanitizeUrl(hubUrl), '_blank', 'noopener,noreferrer'),
    });
  }
  if (card.cliente?.id != null) {
    const clienteId = card.cliente.id;
    open.push({
      label: 'Abrir cliente',
      icon: <UserRound aria-hidden="true" />,
      onSelect: () => navigate(`/clientes/${clienteId}`),
    });
  }
  open.push({
    label: 'Histórico do fluxo',
    icon: <Clock aria-hidden="true" />,
    onSelect: () => setHistoryOpen(true),
  });

  const danger: ContextMenuAction[] = onDelete
    ? [
        {
          label: 'Excluir',
          icon: <Trash2 aria-hidden="true" />,
          onSelect: onDelete,
          destructive: true,
        },
      ]
    : [];

  return (
    <>
      <ContextMenu
        label="Ações do fluxo"
        sections={[stage, open, danger].filter((s) => s.length > 0)}
        preview={preview}
        disabled={disabled}
        className={className}
      >
        {children}
      </ContextMenu>
      {membros && (
        <AssignResponsavelSheet
          open={assignOpen}
          onOpenChange={setAssignOpen}
          card={card}
          membros={membros}
          onRefresh={onRefresh}
        />
      )}
      <BottomSheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title="Histórico do fluxo"
        detents={['medium', 'large']}
      >
        {historyOpen && (
          <div className="phone-ent-history">
            <WorkflowHistoryView workflowId={card.workflow.id!} />
          </div>
        )}
      </BottomSheet>
    </>
  );
}

/**
 * Member picker for the etapa's responsável: the same write the desktop card's
 * assignee dropdown does (updateWorkflowEtapa + toast + refresh).
 */
function AssignResponsavelSheet({
  open,
  onOpenChange,
  card,
  membros,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: BoardCard;
  membros: Membro[];
  onRefresh?: () => void;
}) {
  const assign = async (m: Membro) => {
    onOpenChange(false);
    try {
      await updateWorkflowEtapa(card.etapa.id!, { responsavel_id: m.id });
      toast.success('Responsável atualizado!');
      onRefresh?.();
    } catch {
      toast.error('Erro ao atualizar');
    }
  };
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Responsável"
      description={`Responsável pela etapa ${card.etapa.nome}`}
      detents={['medium', 'large']}
    >
      <GroupedList header={`Etapa ${card.etapa.nome}`}>
        {membros.map((m) => (
          <Cell
            key={m.id}
            label={m.nome}
            current={m.id === card.membro?.id}
            icon={
              <span
                className={`avatar ${avatarColorClass(m.id ?? m.nome)} phone-ent-avatar`}
                aria-hidden="true"
              >
                {getInitials(m.nome)}
              </span>
            }
            accessory={
              m.id === card.membro?.id ? (
                <Check className="phone-ent-check" aria-label="Atual" />
              ) : undefined
            }
            onClick={() => void assign(m)}
          />
        ))}
      </GroupedList>
    </BottomSheet>
  );
}

export interface PostProcessCardMenuProps {
  entity: PostEntity;
  onOpen?: () => void;
  onForward?: () => void;
  forwardLabel?: 'Avançar etapa' | 'Concluir processo';
  canRevert?: boolean;
  onRevert?: () => void;
  onRemoveProcess?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  disabled?: boolean;
  preview?: ReactNode;
  className?: string;
  children: MenuChildren;
}

/** Long-press menu of a post individual card: everything PostProcessCard's kebab
 *  and check button do. */
export function PostProcessCardMenu({
  entity,
  onOpen,
  onForward,
  forwardLabel,
  canRevert,
  onRevert,
  onRemoveProcess,
  onDuplicate,
  onDelete,
  disabled,
  preview,
  className,
  children,
}: PostProcessCardMenuProps) {
  const stage: ContextMenuAction[] = [];
  if (onForward)
    stage.push({
      label: forwardLabel ?? 'Avançar etapa',
      icon: <Check aria-hidden="true" />,
      onSelect: onForward,
    });
  if (canRevert && onRevert)
    stage.push({
      label: 'Voltar etapa',
      icon: <ArrowLeft aria-hidden="true" />,
      onSelect: onRevert,
    });

  const open: ContextMenuAction[] = [];
  if (onOpen)
    open.push({ label: 'Abrir', icon: <ExternalLink aria-hidden="true" />, onSelect: onOpen });
  if (onDuplicate)
    open.push({
      label: 'Duplicar post',
      icon: <CopyPlus aria-hidden="true" />,
      onSelect: onDuplicate,
    });
  open.push({
    label: 'Copiar link do post',
    icon: <Copy aria-hidden="true" />,
    onSelect: () => void copyAppLink(`/entregas?post=${entity.process.post.id}`),
  });

  const end: ContextMenuAction[] = [];
  if (onRemoveProcess)
    end.push({
      label: 'Encerrar processo',
      icon: <FolderMinus aria-hidden="true" />,
      onSelect: onRemoveProcess,
    });
  if (onDelete)
    end.push({
      label: 'Excluir post',
      icon: <Trash2 aria-hidden="true" />,
      onSelect: onDelete,
      destructive: true,
    });

  return (
    <ContextMenu
      label="Ações do post"
      sections={[stage, open, end].filter((s) => s.length > 0)}
      preview={preview}
      disabled={disabled}
      className={className}
    >
      {children}
    </ContextMenu>
  );
}

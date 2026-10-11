import type { ReactNode } from 'react';
import { Copy, Eye, Lock, MoreHorizontal, Pencil, Plus, Star, Trash2, Type } from 'lucide-react';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { ContextMenu, type ContextMenuAction } from '@/components/mobile/ContextMenu';
import type { ReportTemplateRow } from '../../../../services/reportTemplates';
import { ConfigNavTextButton } from '../../phone/ConfigPhoneScreen';
import './relatoriosPhone.css';

export interface ReportTemplatesPhoneProps {
  templates: ReportTemplateRow[];
  isLoading: boolean;
  systemName: string;
  /** A create/duplicate is running (the same flag that disables them on desktop). */
  busy: boolean;
  onCreate: () => void;
  onViewSystem: () => void;
  onDuplicateSystem: () => void;
  onEdit: (t: ReportTemplateRow) => void;
  onMakeDefault: (t: ReportTemplateRow) => void;
  makeDefaultPending: boolean;
  onRename: (t: ReportTemplateRow) => void;
  onDuplicate: (t: ReportTemplateRow) => void;
  onDelete: (t: ReportTemplateRow) => void;
  renaming: ReportTemplateRow | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onCloseRename: () => void;
  onSubmitRename: () => void;
  renamePending: boolean;
  deleting: ReportTemplateRow | null;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  removePending: boolean;
  blockCount: (n: number) => string;
}

/** A row with a tap action and the same actions in a hold menu ("…" for keyboards). */
function TemplateRow({
  label,
  subtitle,
  icon,
  accessory,
  menuLabel,
  sections,
  onTap,
  testId,
}: {
  label: ReactNode;
  subtitle: ReactNode;
  icon?: ReactNode;
  accessory?: ReactNode;
  menuLabel: string;
  sections: ContextMenuAction[][];
  onTap: () => void;
  testId: string;
}) {
  return (
    <li className="phone-cell" data-template-row={testId}>
      <ContextMenu label={menuLabel} sections={sections}>
        {({ triggerProps }) => (
          <div className="phone-reltpl-row__inner">
            <button
              type="button"
              className="phone-cell__main phone-reltpl-row__main"
              onClick={onTap}
            >
              {icon && (
                <span className="phone-cell__icon" aria-hidden="true">
                  {icon}
                </span>
              )}
              <span className="phone-cell__body">
                <span className="phone-cell__text">
                  <span className="phone-cell__label">{label}</span>
                  <span className="phone-cell__subtitle">{subtitle}</span>
                </span>
                {accessory}
              </span>
            </button>
            <button {...triggerProps} className="phone-reltpl-row__more" aria-label={menuLabel}>
              <MoreHorizontal aria-hidden="true" />
            </button>
          </div>
        )}
      </ContextMenu>
    </li>
  );
}

/** ReportTemplatesCard's phone face: the "Modelos" list, the rename sheet and the
 *  delete confirmation. State and mutations stay in ReportTemplatesCard. */
export function ReportTemplatesPhone({
  templates,
  isLoading,
  systemName,
  busy,
  onCreate,
  onViewSystem,
  onDuplicateSystem,
  onEdit,
  onMakeDefault,
  makeDefaultPending,
  onRename,
  onDuplicate,
  onDelete,
  renaming,
  renameValue,
  onRenameValueChange,
  onCloseRename,
  onSubmitRename,
  renamePending,
  deleting,
  onConfirmDelete,
  onCancelDelete,
  removePending,
  blockCount,
}: ReportTemplatesPhoneProps) {
  const canSubmitRename = !renamePending && !!renameValue.trim();
  return (
    <>
      <GroupedList
        header="Modelos de relatório"
        footer={
          !isLoading && templates.length === 0
            ? 'Layouts usados ao gerar relatórios. O padrão vem pré-selecionado. Crie um modelo para reaproveitar a mesma estrutura em todos os relatórios.'
            : 'Layouts usados ao gerar relatórios. O padrão vem pré-selecionado.'
        }
      >
        <Cell
          label="Novo modelo"
          icon={<Plus />}
          className="phone-reltpl-action"
          disabled={busy}
          onClick={onCreate}
        />
        <TemplateRow
          testId="system"
          label={systemName}
          subtitle="embutido"
          icon={<Lock />}
          menuLabel={`Ações de ${systemName}`}
          onTap={onViewSystem}
          sections={[
            [
              { label: 'Visualizar', icon: <Eye />, onSelect: onViewSystem },
              { label: 'Duplicar', icon: <Copy />, disabled: busy, onSelect: onDuplicateSystem },
            ],
          ]}
        />
        {templates.map((t) => (
          <TemplateRow
            key={t.id}
            testId={t.id}
            label={t.name}
            subtitle={blockCount(t.layout.blocks.length)}
            accessory={t.is_default ? <span className="phone-reltpl-badge">padrão</span> : null}
            menuLabel={`Mais ações de ${t.name}`}
            onTap={() => onEdit(t)}
            sections={[
              [
                { label: 'Editar', icon: <Pencil />, onSelect: () => onEdit(t) },
                ...(t.is_default
                  ? []
                  : [
                      {
                        label: 'Definir como padrão',
                        icon: <Star />,
                        disabled: makeDefaultPending,
                        onSelect: () => onMakeDefault(t),
                      },
                    ]),
                { label: 'Renomear', icon: <Type />, onSelect: () => onRename(t) },
                {
                  label: 'Duplicar',
                  icon: <Copy />,
                  disabled: busy,
                  onSelect: () => onDuplicate(t),
                },
              ],
              [
                {
                  label: 'Excluir',
                  icon: <Trash2 />,
                  destructive: true,
                  onSelect: () => onDelete(t),
                },
              ],
            ]}
          />
        ))}
      </GroupedList>

      <BottomSheet
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) onCloseRename();
        }}
        title="Renomear modelo"
        detents={['fit']}
        showClose
        headerTrailing={
          <ConfigNavTextButton
            onClick={onSubmitRename}
            disabled={!canSubmitRename}
            busy={renamePending}
          >
            Salvar
          </ConfigNavTextButton>
        }
      >
        <GroupedList aria-label="Modelo">
          <FormRow
            label="Nome do modelo"
            layout="stacked"
            input={{
              value: renameValue,
              onChange: (e) => onRenameValueChange(e.target.value),
              enterKeyHint: 'done',
              onKeyDown: (e) => {
                if (e.key === 'Enter' && canSubmitRename) onSubmitRename();
              },
            }}
          />
        </GroupedList>
      </BottomSheet>

      <PhoneConfirmSheet
        open={deleting !== null}
        title="Excluir o modelo?"
        message={`${deleting?.name ?? ''}. Relatórios já gerados com ele não mudam.`}
        actions={[
          {
            label: 'Excluir modelo',
            destructive: true,
            disabled: removePending,
            onSelect: onConfirmDelete,
          },
        ]}
        onCancel={onCancelDelete}
      />
    </>
  );
}

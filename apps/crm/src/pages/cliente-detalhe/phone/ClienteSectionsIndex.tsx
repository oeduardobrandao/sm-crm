import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, MoreHorizontal } from 'lucide-react';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { useAuth } from '@/context/AuthContext';
import { getInitials, type Cliente } from '@/store';
import { useClienteFoto } from '../ClienteAvatarUpload';
import {
  CLIENTE_TAB_GROUP_LABELS,
  visibleClienteTabs,
  type ClienteTab,
  type ClienteTabGroup,
} from '../clienteTabs.model';
import './clienteDetalhePhone.css';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ativo: 'success',
  pausado: 'warning',
  encerrado: 'danger',
};

/**
 * /clientes/:id on phones (FClienteDetalhe mockup): the client's header and quick facts
 * over the four groups of sections, in place of the desktop's eleven-pill strip. Each row
 * is the section's real route. Tabs the member can't open aren't listed, exactly like
 * the desktop nav (`visibleClienteTabs`), and the route guard still checks a typed URL.
 */
export function ClienteSectionsIndex({
  cliente,
  onEdit,
}: {
  cliente: Cliente;
  /** Opens ClienteEditDialog (owned by ClienteDetalhePage). */
  onEdit?: () => void;
}) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const { can } = useAuth();
  const canEdit = can('clientes', 'editar') === true;
  const tabs = visibleClienteTabs(can);
  const clienteId = cliente.id!;
  const foto = useClienteFoto(clienteId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const groups: { group: ClienteTabGroup; tabs: ClienteTab[] }[] = [];
  for (const tab of tabs) {
    const last = groups[groups.length - 1];
    if (last && last.group === tab.group) last.tabs.push(tab);
    else groups.push({ group: tab.group, tabs: [tab] });
  }

  const facts = [
    cliente.data_pagamento
      ? {
          label: t('sectionsIndex.payment'),
          value: t('detail.dayN', { day: cliente.data_pagamento }),
        }
      : null,
    cliente.dia_entrega
      ? {
          label: t('sectionsIndex.delivery'),
          value: t('detail.dayN', { day: cliente.dia_entrega }),
        }
      : null,
    cliente.especialidade ? { label: t('detail.specialty'), value: cliente.especialidade } : null,
  ].filter((f): f is { label: string; value: string } => f !== null);

  const menuActions: ActionSheetAction[] = [];
  if (onEdit) menuActions.push({ label: t('detail.nav.editar'), onSelect: onEdit });
  // `immediate`: the file picker only opens inside the tap on iOS Safari.
  menuActions.push({ label: tc('photo.change'), onSelect: foto.pick, immediate: true });
  if (cliente.foto_url)
    menuActions.push({
      label: tc('photo.remove'),
      destructive: true,
      onSelect: () => setRemoveOpen(true),
    });

  const statusLabel = tc(`status.${cliente.status}`, { defaultValue: cliente.status });
  const showImage = !!cliente.foto_url && !imageFailed;
  const avatar = showImage ? (
    <img
      className="phone-cli-hero__avatar"
      src={cliente.foto_url!}
      alt=""
      onError={() => setImageFailed(true)}
    />
  ) : (
    <span
      className="phone-cli-hero__avatar phone-cli-hero__avatar--initials"
      style={{ background: cliente.cor }}
      aria-hidden="true"
    >
      {getInitials(cliente.nome)}
    </span>
  );

  return (
    <div className="phone-cli-index">
      <PhoneNavBar
        backLabel={t('detail.nav.backToClients')}
        fallbackTo="/clientes"
        trailing={
          canEdit ? (
            <PhoneIconButton
              label={t('sectionsIndex.moreActions')}
              aria-haspopup="dialog"
              onClick={() => setMenuOpen(true)}
            >
              <MoreHorizontal aria-hidden="true" />
            </PhoneIconButton>
          ) : undefined
        }
      />

      <div className="phone-cli-hero">
        {canEdit ? (
          <button
            type="button"
            className="phone-cli-hero__photo"
            aria-label={t('avatar.changeAria')}
            disabled={foto.uploading}
            onClick={foto.pick}
          >
            {avatar}
            <span className="phone-cli-hero__camera" aria-hidden="true">
              <Camera />
            </span>
          </button>
        ) : (
          <span className="phone-cli-hero__photo">{avatar}</span>
        )}
        <div className="phone-cli-hero__text">
          <h1 className="phone-cli-hero__name">{cliente.nome}</h1>
          <p className="phone-cli-hero__meta">
            <span className="phone-cli-hero__plan">{cliente.plano}</span>
            <span aria-hidden="true">·</span>
            <span className="phone-cli-chip" data-tone={STATUS_TONE[cliente.status] ?? 'neutral'}>
              {statusLabel}
            </span>
          </p>
        </div>
      </div>

      {facts.length > 0 && (
        <div className="phone-cli-facts" role="group" aria-label={t('sectionsIndex.summary')}>
          {facts.map((f) => (
            <div key={f.label} className="phone-cli-facts__item">
              <span className="phone-cli-facts__label">{f.label}</span>
              <span className="phone-cli-facts__value">{f.value}</span>
            </div>
          ))}
        </div>
      )}

      <nav aria-label={t('detail.pageNav')}>
        {groups.map(({ group, tabs: groupTabs }) => (
          <GroupedList
            key={group}
            header={t(CLIENTE_TAB_GROUP_LABELS[group])}
            className="phone-cli-index__group"
          >
            {groupTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <Cell
                  key={tab.key}
                  to={`/clientes/${clienteId}/${tab.key}`}
                  label={t(tab.labelKey)}
                  icon={<Icon />}
                  iconColor="var(--phone-fill)"
                />
              );
            })}
          </GroupedList>
        ))}
      </nav>

      {canEdit && (
        <input {...foto.inputProps} className="hidden" aria-hidden="true" tabIndex={-1} />
      )}

      <ActionSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title={cliente.nome}
        hideTitle
        actions={menuActions}
      />
      <PhoneConfirmSheet
        open={removeOpen}
        title={t('avatar.removeTitle')}
        message={t('avatar.removeDescription')}
        actions={[
          {
            label: tc('actions.delete'),
            destructive: true,
            onSelect: () => {
              setRemoveOpen(false);
              void foto.remove().then(() => setImageFailed(false));
            },
          },
        ]}
        onCancel={() => setRemoveOpen(false)}
      />
    </div>
  );
}

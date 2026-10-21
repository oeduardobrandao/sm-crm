import { useState } from 'react';
import { Building2, Upload } from 'lucide-react';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import {
  ConfigNavTextButton,
  ConfigPhoneScreen,
  ConfigPhoneSkeleton,
} from '../../phone/ConfigPhoneScreen';
import './workspacePhone.css';

export interface WorkspacePhoneProps {
  loaded: boolean;
  canEdit: boolean;
  name: string;
  onNameChange: (value: string) => void;
  onSaveName: () => void;
  logoUrl: string | null;
  logoBusy: boolean;
  /** Opens the file picker (the hidden input stays in WorkspaceTab). */
  onPickLogo: () => void;
  onRemoveLogo: () => void;
  /** Null when no Instagram account is connected: the switch isn't shown. */
  autoSync: { enabled: boolean; onChange: (checked: boolean) => void } | null;
}

/** Workspace on phones: logo, name, Instagram auto-sync and the import wizard link. */
export function WorkspacePhone(props: WorkspacePhoneProps) {
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  if (!props.loaded) {
    return (
      <ConfigPhoneScreen title="Workspace">
        <ConfigPhoneSkeleton groups={2} rows={2} />
      </ConfigPhoneScreen>
    );
  }

  const logoLabel = props.logoUrl ? 'Trocar logo' : 'Enviar logo';

  return (
    <ConfigPhoneScreen
      title="Workspace"
      subtitle={props.canEdit ? undefined : 'Somente leitura'}
      trailing={
        props.canEdit ? (
          <ConfigNavTextButton
            onClick={props.onSaveName}
            disabled={!props.name.trim()}
            aria-label="Salvar nome do workspace"
          >
            Salvar
          </ConfigNavTextButton>
        ) : undefined
      }
    >
      <GroupedList
        aria-label="Identidade"
        footer="PNG, JPG ou WebP. Máx 2MB. Será redimensionado para 512px."
      >
        <Cell
          label="Logo"
          subtitle={props.logoBusy ? 'Enviando…' : props.logoUrl ? undefined : 'Sem logo'}
          icon={
            props.logoUrl ? (
              <img src={props.logoUrl} alt="" className="phone-workspace-logo" />
            ) : (
              <Building2 />
            )
          }
          value={props.canEdit ? logoLabel : undefined}
          chevron={props.canEdit}
          disabled={!props.canEdit || props.logoBusy}
          aria-haspopup={props.logoUrl ? 'dialog' : undefined}
          onClick={
            props.canEdit
              ? () => (props.logoUrl ? setLogoMenuOpen(true) : props.onPickLogo())
              : undefined
          }
        />
        <FormRow
          label="Nome"
          input={{
            value: props.name,
            disabled: !props.canEdit,
            'aria-label': 'Nome do Workspace',
            onChange: (e) => props.onNameChange(e.target.value),
          }}
        />
      </GroupedList>

      {props.autoSync && (
        <GroupedList
          header="Auto-Sync Instagram"
          footer="Quando ativada, os dados do Instagram são sincronizados automaticamente uma vez por dia."
        >
          <Cell
            label="Sincronização automática"
            disabled={!props.canEdit}
            switch={{ checked: props.autoSync.enabled, onCheckedChange: props.autoSync.onChange }}
          />
        </GroupedList>
      )}

      <GroupedList
        header="Importar dados"
        footer="Traga clientes, posts, entregas e ideias de Notion, Trello, ClickUp ou planilhas."
      >
        <Cell
          label="Abrir assistente de importação"
          icon={<Upload />}
          iconColor="#007aff"
          to="/importar"
        />
      </GroupedList>

      <ActionSheet
        open={logoMenuOpen}
        onOpenChange={setLogoMenuOpen}
        title="Logo do workspace"
        hideTitle
        actions={[
          // The file picker only opens from inside the tap itself on iOS.
          { label: 'Trocar logo', onSelect: props.onPickLogo, immediate: true },
          { label: 'Remover', destructive: true, onSelect: () => setRemoveOpen(true) },
        ]}
      />
      <PhoneConfirmSheet
        open={removeOpen}
        title="Remover logo?"
        actions={[
          {
            label: 'Remover',
            destructive: true,
            onSelect: () => {
              setRemoveOpen(false);
              props.onRemoveLogo();
            },
          },
        ]}
        onCancel={() => setRemoveOpen(false)}
      />
    </ConfigPhoneScreen>
  );
}

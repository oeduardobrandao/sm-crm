import { useState } from 'react';
import { Building2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('settings');
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  if (!props.loaded) {
    return (
      <ConfigPhoneScreen title={t('tabs.workspace')}>
        <ConfigPhoneSkeleton groups={2} rows={2} />
      </ConfigPhoneScreen>
    );
  }

  const logoLabel = props.logoUrl
    ? t('workspace.phone.changeLogo')
    : t('workspace.phone.uploadLogo');

  return (
    <ConfigPhoneScreen
      title={t('tabs.workspace')}
      subtitle={props.canEdit ? undefined : t('shared.readOnly')}
      trailing={
        props.canEdit ? (
          <ConfigNavTextButton
            onClick={props.onSaveName}
            disabled={!props.name.trim()}
            aria-label={t('workspace.phone.saveNameAria')}
          >
            {t('actions.save')}
          </ConfigNavTextButton>
        ) : undefined
      }
    >
      <GroupedList aria-label={t('workspace.phone.identity')} footer={t('workspace.logoHint')}>
        <Cell
          label={t('workspace.logo')}
          subtitle={
            props.logoBusy
              ? t('workspace.phone.uploading')
              : props.logoUrl
                ? undefined
                : t('workspace.phone.noLogo')
          }
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
          label={t('shared.name')}
          input={{
            value: props.name,
            disabled: !props.canEdit,
            'aria-label': t('workspace.workspaceName'),
            onChange: (e) => props.onNameChange(e.target.value),
          }}
        />
      </GroupedList>

      {props.autoSync && (
        <GroupedList header={t('workspace.autoSyncTitle')} footer={t('workspace.autoSyncHint')}>
          <Cell
            label={t('workspace.phone.autoSync')}
            disabled={!props.canEdit}
            switch={{ checked: props.autoSync.enabled, onCheckedChange: props.autoSync.onChange }}
          />
        </GroupedList>
      )}

      <GroupedList header={t('workspace.importTitle')} footer={t('workspace.importBody')}>
        <Cell
          label={t('workspace.importOpen')}
          icon={<Upload />}
          iconColor="#007aff"
          to="/importar"
        />
      </GroupedList>

      <ActionSheet
        open={logoMenuOpen}
        onOpenChange={setLogoMenuOpen}
        title={t('workspace.phone.logoMenuTitle')}
        hideTitle
        actions={[
          // The file picker only opens from inside the tap itself on iOS.
          {
            label: t('workspace.phone.changeLogo'),
            onSelect: props.onPickLogo,
            immediate: true,
          },
          { label: t('shared.remove'), destructive: true, onSelect: () => setRemoveOpen(true) },
        ]}
      />
      <PhoneConfirmSheet
        open={removeOpen}
        title={t('workspace.removeLogoTitle')}
        actions={[
          {
            label: t('shared.remove'),
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

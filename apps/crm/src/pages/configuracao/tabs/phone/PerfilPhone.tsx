import { useState, type ReactNode } from 'react';
import { Eye, EyeOff, KeyRound, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '@mesaas/i18n';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import { openConsentPreferences } from '@/lib/consent';
import { ConfigNavTextButton, ConfigPhoneScreen } from '../../phone/ConfigPhoneScreen';
import { useConfigSubScreen } from '../../phone/useConfigSubScreen';
import './perfilPhone.css';

interface Field {
  value: string;
  onChange: (value: string) => void;
}

export interface PerfilPhoneProps {
  user: {
    id: string;
    email?: string;
    created_at?: string;
    last_sign_in_at?: string;
    app_metadata?: { provider?: string };
  };
  displayName: string;
  /** The photo editor (avatar, "Alterar foto", its sheet), built by PerfilTab. */
  fotoEditor: ReactNode;
  nome: Field;
  empresa: Field;
  telefone: Field;
  whatsapp: Field;
  marketingOptIn: boolean;
  onMarketingOptInChange: (value: boolean) => void;
  profileSaving: boolean;
  onSaveProfile: () => void;
  senha: Field;
  confirmar: Field;
  passwordSaving: boolean;
  onSavePassword: () => void;
  /** The role has no other Configurações section: explain why. */
  showRestriction: boolean;
  onSignOut: () => void;
}

function PasswordRow({ label, field }: { label: string; field: Field }) {
  const { t } = useTranslation('settings');
  const [visible, setVisible] = useState(false);
  return (
    <FormRow
      label={label}
      input={{
        type: visible ? 'text' : 'password',
        autoComplete: 'new-password',
        value: field.value,
        onChange: (e) => field.onChange(e.target.value),
      }}
      accessory={
        <button
          type="button"
          className="phone-perfil-eye"
          aria-label={
            visible ? t('perfil.phoneScreen.hidePassword') : t('perfil.phoneScreen.showPassword')
          }
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      }
    />
  );
}

/** Perfil on phones (FConfigPerfil): grouped form, account details, cookies, sign-out. */
export function PerfilPhone(props: PerfilPhoneProps) {
  const { t } = useTranslation('settings');
  const intlLocale = useIntlLocale();
  const sub = useConfigSubScreen<'senha'>();
  const { user } = props;

  if (sub.screen === 'senha') {
    return (
      <ConfigPhoneScreen title={t('perfil.phoneScreen.changePassword')} onBack={sub.close}>
        <GroupedList
          aria-label={t('perfil.phoneScreen.passwordAria')}
          footer={t('perfil.phoneScreen.passwordFooter')}
        >
          <PasswordRow label={t('perfil.phoneScreen.newPassword')} field={props.senha} />
          <PasswordRow label={t('actions.confirm')} field={props.confirmar} />
        </GroupedList>
        <BottomActionBar aboveTabBar>
          <button
            type="button"
            className="phone-config-primary"
            onClick={props.onSavePassword}
            disabled={props.passwordSaving}
            aria-busy={props.passwordSaving || undefined}
          >
            {t('perfil.phoneScreen.updatePassword')}
          </button>
        </BottomActionBar>
      </ConfigPhoneScreen>
    );
  }

  const textRow = (label: string, field: Field, extra?: { required?: boolean; type?: string }) => (
    <FormRow
      label={label}
      input={{
        type: extra?.type ?? 'text',
        value: field.value,
        required: extra?.required,
        'aria-required': extra?.required || undefined,
        onChange: (e) => field.onChange(e.target.value),
      }}
    />
  );

  return (
    <ConfigPhoneScreen
      title={t('tabs.perfil')}
      trailing={
        <ConfigNavTextButton
          onClick={props.onSaveProfile}
          busy={props.profileSaving}
          aria-label={t('perfil.phoneScreen.saveProfileAria')}
        >
          {t('actions.save')}
        </ConfigNavTextButton>
      }
    >
      <div className="mb-5 flex justify-center">{props.fotoEditor}</div>

      <div className="phone-perfil-card">
        <span className="phone-perfil-card__text">
          <span className="phone-perfil-card__name">{props.displayName}</span>
          <span className="phone-perfil-card__email">{user.email}</span>
          <span className="phone-perfil-card__badge">{t('perfil.activeAccount')}</span>
        </span>
      </div>

      <GroupedList aria-label={t('perfil.phoneScreen.profileData')}>
        {textRow(t('shared.name'), props.nome, { required: true })}
        {textRow(t('perfil.company'), props.empresa)}
        {textRow(t('perfil.phone'), props.telefone, { type: 'tel' })}
        {textRow(t('perfil.whatsapp'), props.whatsapp, { type: 'tel' })}
      </GroupedList>

      <GroupedList aria-label={t('perfil.phoneScreen.communications')}>
        <Cell
          label={t('perfil.marketing')}
          subtitle={props.marketingOptIn ? t('perfil.marketingOn') : t('perfil.marketingOff')}
          switch={{
            checked: props.marketingOptIn,
            onCheckedChange: props.onMarketingOptInChange,
          }}
        />
      </GroupedList>

      <GroupedList aria-label={t('perfil.phoneScreen.security')}>
        <Cell
          label={t('perfil.phoneScreen.changePassword')}
          icon={<KeyRound />}
          iconColor="#8e8e93"
          chevron
          onClick={() => sub.open('senha')}
        />
      </GroupedList>

      {props.showRestriction && (
        <GroupedList header={t('perfil.restrictionTitle')} footer={t('perfil.restrictionBody')}>
          <Cell label={t('perfil.phoneScreen.ownersAndAdmins')} icon={<Lock />} />
        </GroupedList>
      )}

      <GroupedList header={t('perfil.account')}>
        <FormRow label={t('perfil.phoneScreen.userId')} value={`${user.id.substring(0, 18)}…`} />
        <FormRow
          label={t('perfil.createdAt')}
          value={user.created_at ? new Date(user.created_at).toLocaleDateString(intlLocale) : '-'}
        />
        <FormRow
          label={t('perfil.lastAccess')}
          value={
            user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString(intlLocale) : '-'
          }
        />
        <FormRow label={t('perfil.provider')} value={user.app_metadata?.provider ?? 'email'} />
      </GroupedList>

      <GroupedList header={t('nav.privacidade')} footer={t('perfil.privacyBody')}>
        <Cell label={t('perfil.cookies')} chevron onClick={() => openConsentPreferences()} />
      </GroupedList>

      <GroupedList aria-label={t('perfil.session')}>
        <Cell label={t('perfil.phoneScreen.signOut')} destructive onClick={props.onSignOut} />
      </GroupedList>
    </ConfigPhoneScreen>
  );
}

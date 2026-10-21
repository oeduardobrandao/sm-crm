import { useState, type ReactNode } from 'react';
import { Eye, EyeOff, KeyRound, Lock } from 'lucide-react';
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
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
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
  const sub = useConfigSubScreen<'senha'>();
  const { user } = props;

  if (sub.screen === 'senha') {
    return (
      <ConfigPhoneScreen title="Alterar senha" onBack={sub.close}>
        <GroupedList aria-label="Senha" footer="Mínimo de 8 caracteres.">
          <PasswordRow label="Nova senha" field={props.senha} />
          <PasswordRow label="Confirmar" field={props.confirmar} />
        </GroupedList>
        <BottomActionBar aboveTabBar>
          <button
            type="button"
            className="phone-config-primary"
            onClick={props.onSavePassword}
            disabled={props.passwordSaving}
            aria-busy={props.passwordSaving || undefined}
          >
            Atualizar senha
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
      title="Perfil"
      trailing={
        <ConfigNavTextButton
          onClick={props.onSaveProfile}
          busy={props.profileSaving}
          aria-label="Salvar perfil"
        >
          Salvar
        </ConfigNavTextButton>
      }
    >
      <div className="mb-5 flex justify-center">{props.fotoEditor}</div>

      <div className="phone-perfil-card">
        <span className="phone-perfil-card__text">
          <span className="phone-perfil-card__name">{props.displayName}</span>
          <span className="phone-perfil-card__email">{user.email}</span>
          <span className="phone-perfil-card__badge">Conta Ativa</span>
        </span>
      </div>

      <GroupedList aria-label="Dados do perfil">
        {textRow('Nome', props.nome, { required: true })}
        {textRow('Empresa', props.empresa)}
        {textRow('Telefone', props.telefone, { type: 'tel' })}
        {textRow('WhatsApp', props.whatsapp, { type: 'tel' })}
      </GroupedList>

      <GroupedList aria-label="Comunicações">
        <Cell
          label="Comunicações de marketing"
          subtitle={
            props.marketingOptIn
              ? 'Você receberá novidades e comunicações de marketing por SMS e WhatsApp.'
              : 'Você não receberá comunicações de marketing. Mensagens sobre sua conta continuam sendo enviadas.'
          }
          switch={{
            checked: props.marketingOptIn,
            onCheckedChange: props.onMarketingOptInChange,
          }}
        />
      </GroupedList>

      <GroupedList aria-label="Segurança">
        <Cell
          label="Alterar senha"
          icon={<KeyRound />}
          iconColor="#8e8e93"
          chevron
          onClick={() => sub.open('senha')}
        />
      </GroupedList>

      {props.showRestriction && (
        <GroupedList
          header="Configurações do workspace"
          footer="As configurações de workspace, sincronização do Instagram e gerenciamento de membros estão disponíveis apenas para proprietários e administradores."
        >
          <Cell label="Disponível para donos e admins" icon={<Lock />} />
        </GroupedList>
      )}

      <GroupedList header="Conta">
        <FormRow label="ID do usuário" value={`${user.id.substring(0, 18)}…`} />
        <FormRow
          label="Criado em"
          value={user.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '-'}
        />
        <FormRow
          label="Último acesso"
          value={
            user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('pt-BR') : '-'
          }
        />
        <FormRow label="Provedor" value={user.app_metadata?.provider ?? 'email'} />
      </GroupedList>

      <GroupedList
        header="Privacidade"
        footer="Escolha quais ferramentas opcionais (análise de uso e chat de suporte) podem usar o armazenamento do seu navegador."
      >
        <Cell label="Preferências de cookies" chevron onClick={() => openConsentPreferences()} />
      </GroupedList>

      <GroupedList aria-label="Sessão">
        <Cell label="Sair da conta" destructive onClick={props.onSignOut} />
      </GroupedList>
    </ConfigPhoneScreen>
  );
}

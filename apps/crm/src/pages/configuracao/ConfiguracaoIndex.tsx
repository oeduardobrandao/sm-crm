import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { useAuth } from '../../context/AuthContext';
import { visibleConfigTabs, type ConfigTab } from './configTabs';
import './phone/configPhone.css';

/** iOS Settings tile colours, per tab (FConfig mockup). */
const TILE_COLORS: Record<string, string> = {
  notificacoes: '#ff3b30',
  workspace: '#5856d6',
  membros: '#34c759',
  papeis: '#007aff',
  relatorios: '#ff9500',
  status: '#af52de',
  hub: '#30b0c7',
  armazenamento: '#8e8e93',
  mcp: '#12151a',
  cobranca: '#ffbf30',
};

/**
 * `/configuracao` itself. Desktop and tablet keep going straight to Perfil (the tab
 * strip is the menu there); phones get the iOS Settings list: the profile row, then
 * Conta / Workspace / Avançado from the same `visibleConfigTabs()` the strip uses, so
 * a tab hidden from a role is never listed.
 */
export default function ConfiguracaoIndex() {
  const isDesktop = useIsDesktop(768);
  if (isDesktop) return <Navigate to="/configuracao/perfil" replace />;
  return <ConfiguracaoIndexPhone />;
}

function ConfiguracaoIndexPhone() {
  const { t } = useTranslation('settings');
  const { user, profile, can, workspaceRole } = useAuth();
  const tabs = visibleConfigTabs(can, workspaceRole);

  const groups: { name: ConfigTab['group']; tabs: ConfigTab[] }[] = [];
  for (const tab of tabs) {
    const last = groups[groups.length - 1];
    if (last && last.name === tab.group) last.tabs.push(tab);
    else groups.push({ name: tab.group, tabs: [tab] });
  }

  const name = profile?.nome || user?.email || t('tabs.perfil');

  return (
    <div className="phone-kit phone-config-screen">
      <PhonePageHeader title={t('nav.configuracoes')} />
      {groups.map((group) => (
        <GroupedList key={group.name} header={t(`tabs.groups.${group.name}`)}>
          {group.tabs.map((tab) => {
            if (tab.path === 'perfil') {
              return (
                <Cell
                  key={tab.path}
                  to="/configuracao/perfil"
                  className="phone-config-profile-cell"
                  aria-label={t('index.profileAria', { name })}
                  icon={
                    <PessoaAvatar
                      nome={profile?.nome || '?'}
                      fotoUrl={profile?.avatar_url}
                      seed={user?.id}
                      className="phone-config-avatar phone-config-avatar--large"
                    />
                  }
                  label={name}
                  subtitle={user?.email}
                />
              );
            }
            const Icon = tab.icon;
            return (
              <Cell
                key={tab.path}
                to={`/configuracao/${tab.path}`}
                icon={<Icon />}
                iconColor={TILE_COLORS[tab.path] ?? '#8e8e93'}
                label={t(tab.labelKey)}
              />
            );
          })}
        </GroupedList>
      ))}
    </div>
  );
}

import type { RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Moon, Sparkles } from 'lucide-react';
import { BottomSheet, Cell, GroupedList, useSheetActions } from '@mesaas/ios-kit';
import { MAIS_GROUPS } from '../../lib/nav-items';
import { AccountAvatar } from './AccountAvatar';

export interface MaisSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  email: string | null;
  theme: 'light' | 'dark';
  onSetTheme: (t: 'light' | 'dark') => void;
  glassEnabled: boolean;
  onToggleGlass: () => void;
  onSignOut: () => void;
}

type MaisContentProps = Omit<MaisSheetProps, 'open' | 'onOpenChange' | 'returnFocusRef'>;

function MaisContent({
  email,
  theme,
  onSetTheme,
  glassEnabled,
  onToggleGlass,
  onSignOut,
}: MaisContentProps) {
  const navigate = useNavigate();
  const { closeThen } = useSheetActions();
  return (
    <>
      {email && (
        <GroupedList aria-label="Conta">
          <Cell
            label={email}
            subtitle="Admin da plataforma"
            icon={<AccountAvatar email={email} large />}
          />
        </GroupedList>
      )}
      {MAIS_GROUPS.map((group) => (
        <GroupedList key={group.label} header={group.label}>
          {group.items.map(({ id, to, label, icon: Icon, tile }) => (
            <Cell
              key={id}
              label={label}
              icon={<Icon />}
              iconColor={tile}
              chevron
              onClick={() => closeThen(() => navigate(to))}
            />
          ))}
        </GroupedList>
      ))}
      {/* Tema escuro stays hidden while glass is on: glass forces the dark theme. */}
      <GroupedList
        header="Aparência"
        footer={glassEnabled ? 'Com o Liquid Glass ligado o tema fica escuro.' : undefined}
      >
        <Cell
          label="Liquid Glass"
          icon={<Sparkles />}
          iconColor="var(--admin-tile-glass)"
          switch={{ checked: glassEnabled, onCheckedChange: onToggleGlass }}
        />
        {!glassEnabled && (
          <Cell
            label="Tema escuro"
            icon={<Moon />}
            iconColor="var(--admin-tile-theme)"
            switch={{
              checked: theme === 'dark',
              onCheckedChange: (on) => onSetTheme(on ? 'dark' : 'light'),
            }}
          />
        )}
      </GroupedList>
      <GroupedList aria-label="Sessão">
        <Cell label="Sair" icon={<LogOut />} destructive onClick={() => closeThen(onSignOut)} />
      </GroupedList>
    </>
  );
}

/**
 * The phone shell's "Mais" sheet (board Mais): the account on top, the pages outside the tab
 * bar, Aparência (Liquid Glass, Tema escuro) and Sair.
 */
export function MaisSheet({ open, onOpenChange, returnFocusRef, ...rest }: MaisSheetProps) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Mais"
      className="admin-mais-sheet"
      returnFocusRef={returnFocusRef}
      detents={['large']}
      // Crossing 768px unmounts the whole tab bar with the sheet open: pop its entry then.
      popOnUnmount
    >
      <MaisContent {...rest} />
    </BottomSheet>
  );
}

import type { RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { BottomSheet, Cell, GroupedList, useSheetActions } from '@mesaas/ios-kit';
import { MAIS_GROUPS } from '../../lib/nav-items';

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
      <GroupedList header="Conta">
        {email && <Cell label={email} subtitle="Admin da plataforma" />}
        <Cell
          label="Liquid Glass"
          switch={{ checked: glassEnabled, onCheckedChange: onToggleGlass }}
        />
        {!glassEnabled && (
          <Cell
            label="Tema escuro"
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

/** The phone shell's "Mais" sheet: the pages outside the tab bar, the account and Sair. */
export function MaisSheet({ open, onOpenChange, returnFocusRef, ...rest }: MaisSheetProps) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Mais"
      hideTitle
      returnFocusRef={returnFocusRef}
      detents={['large']}
      // Crossing 768px unmounts the whole tab bar with the sheet open: pop its entry then.
      popOnUnmount
    >
      <MaisContent {...rest} />
    </BottomSheet>
  );
}

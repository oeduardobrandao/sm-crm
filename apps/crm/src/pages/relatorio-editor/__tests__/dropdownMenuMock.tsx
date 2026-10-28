// Mock do DropdownMenu (padrão da casa, ver ClientesPage.test.tsx): o Radix real
// não abre com fireEvent puro no jsdom (precisa de pointer events reais, e este
// repo não tem @testing-library/user-event). Conteúdo sempre visível; cada item
// vira um <button> que chama onSelect. Uso:
//   vi.mock('@/components/ui/dropdown-menu', () => import('./dropdownMenuMock'));
import type { ReactNode } from 'react';

export function DropdownMenu({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
export function DropdownMenuTrigger({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export function DropdownMenuContent({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
export function DropdownMenuItem({
  children,
  onSelect,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" disabled={disabled} onClick={() => onSelect?.()}>
      {children}
    </button>
  );
}
export function DropdownMenuSeparator() {
  return <hr />;
}

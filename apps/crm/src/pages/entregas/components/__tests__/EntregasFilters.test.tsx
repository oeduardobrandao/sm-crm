import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Membro } from '../../../../store';

// useStatusRegistry reaches the status-definitions query; the filters only need its options.
vi.mock('@/hooks/useStatusRegistry', () => ({
  useStatusRegistry: () => ({ options: [] }),
}));

import { EMPTY_FILTERS, EntregasFilters } from '../EntregasFilters';

const membro = (id: number, nome: string, avatar_url: string | null): Membro => ({
  id,
  nome,
  cargo: '',
  tipo: 'clt',
  custo_mensal: null,
  avatar_url,
});

function renderWithResponsavel(selected: Membro) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EntregasFilters
        filters={{ ...EMPTY_FILTERS, filterMembros: [selected.id!] }}
        onChange={() => {}}
        clientes={[]}
        membros={[selected]}
        templates={[]}
        etapaNames={[]}
      />
    </QueryClientProvider>,
  );
}

describe('EntregasFilters responsável avatars', () => {
  it('EntregasFilters shows photos in the responsável list', () => {
    const { container } = renderWithResponsavel(membro(7, 'Ana Lima', 'https://x.test/a.jpg'));
    // The selected responsável's avatar leads the "Responsável" trigger summary.
    const photo = container.querySelector<HTMLImageElement>('img.avatar--photo');
    expect(photo).toHaveAttribute('src', 'https://x.test/a.jpg');
    expect(photo!.style.width).toBe('18px');
  });

  it('EntregasFilters shows initials without a photo', () => {
    const { container } = renderWithResponsavel(membro(8, 'Bruno Souza', null));
    expect(container.querySelector('img.avatar--photo')).toBeNull();
    const avatar = container.querySelector<HTMLElement>('.avatar')!;
    expect(avatar).toHaveTextContent('BS');
    expect(avatar.style.width).toBe('18px');
  });
});

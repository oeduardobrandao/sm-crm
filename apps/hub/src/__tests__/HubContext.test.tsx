import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HubContext, useHub } from '../HubContext';

const providerValue = {
  bootstrap: {
    workspace: {
      name: 'Mesaas',
      logo_url: 'https://cdn.mesaas.com/logo.png',
      brand_color: '#0f766e',
    },
    cliente_nome: 'Clínica Aurora',
    is_active: true,
    cliente_id: 14,
  },
  token: 'token-publico',
  workspace: 'mesaas',
};

describe('HubContext', () => {
  it('returns the hub context value from the provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <HubContext.Provider value={providerValue}>
        {children}
      </HubContext.Provider>
    );

    const { result } = renderHook(() => useHub(), { wrapper });

    expect(result.current).toEqual(providerValue);
  });

  it('throws when used outside HubContext.Provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(() => renderHook(() => useHub())).toThrow('useHub must be used inside HubContext.Provider');
    } finally {
      spy.mockRestore();
    }
  });
});

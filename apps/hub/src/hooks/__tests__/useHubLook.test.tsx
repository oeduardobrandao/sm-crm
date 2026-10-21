import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { HubContext } from '../../HubContext';
import { useHubLook } from '../useHubLook';

const wrap =
  (bootstrap: unknown) =>
  ({ children }: { children: ReactNode }) => (
    <HubContext.Provider
      value={
        {
          bootstrap,
          token: 't',
          workspace: 'w',
          theme: 'light',
          toggleTheme: () => {},
        } as never
      }
    >
      {children}
    </HubContext.Provider>
  );

describe('useHubLook', () => {
  it('is classic without a provider', () => {
    expect(renderHook(() => useHubLook()).result.current).toBe('classic');
  });
  it('is classic when the flag is absent or false', () => {
    expect(renderHook(() => useHubLook(), { wrapper: wrap({}) }).result.current).toBe('classic');
    expect(
      renderHook(() => useHubLook(), { wrapper: wrap({ feature_hub_pauta: false }) }).result
        .current,
    ).toBe('classic');
  });
  it('is pauta when the flag is true', () => {
    expect(
      renderHook(() => useHubLook(), { wrapper: wrap({ feature_hub_pauta: true }) }).result.current,
    ).toBe('pauta');
  });
});

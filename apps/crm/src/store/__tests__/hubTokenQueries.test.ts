import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateHubTokenQueries } from '../hub';

describe('invalidateHubTokenQueries', () => {
  it('invalida a chave por cliente E a chave agregada do guia', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateHubTokenQueries(qc, 42);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['hub-token', 42] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['hub-token-any'] });
  });
});

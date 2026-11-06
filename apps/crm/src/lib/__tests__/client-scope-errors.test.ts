import { afterEach, describe, expect, it } from 'vitest';
import {
  clientScopeErrorMessage,
  isClientScopeError,
  scopeErrorOr,
  setClientScopedForErrors,
} from '../client-scope-errors';

const MSG = 'Seu acesso é limitado aos clientes atribuídos.';
const pg = (message: string, code = 'P0001') => ({ message, code, details: null, hint: null });

describe('client-scope-errors', () => {
  afterEach(() => setClientScopedForErrors(false));

  it('copy is the pt-BR message', () => {
    expect(clientScopeErrorMessage()).toBe(MSG);
  });

  it('the client_scope_restricted token is a scope error for anyone', () => {
    expect(isClientScopeError(pg('client_scope_restricted', '42501'))).toBe(true);
    expect(isClientScopeError(pg('client_scope_restricted'))).toBe(true);
  });

  it('the token must be a whole word', () => {
    expect(isClientScopeError(pg('not_client_scope_restricted_x'))).toBe(false);
  });

  it('a bare 42501 is a scope error only while the member is restricted', () => {
    const rls = pg('new row violates row-level security policy for table "workflows"', '42501');
    expect(isClientScopeError(rls)).toBe(false);
    setClientScopedForErrors(true);
    expect(isClientScopeError(rls)).toBe(true);
  });

  it('other codes and non-objects are not scope errors', () => {
    setClientScopedForErrors(true);
    expect(isClientScopeError(pg('boom', '23505'))).toBe(false);
    expect(isClientScopeError(null)).toBe(false);
    expect(isClientScopeError('client_scope_restricted')).toBe(false);
  });

  it('scopeErrorOr picks the scope copy or the fallback', () => {
    expect(scopeErrorOr(pg('client_scope_restricted', '42501'), 'Erro')).toBe(MSG);
    expect(scopeErrorOr(new Error('boom'), 'Erro')).toBe('Erro');
  });
});

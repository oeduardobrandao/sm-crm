import { describe, expect, it } from 'vitest';
import { AuthError, AuthRetryableFetchError, AuthApiError } from '@supabase/supabase-js';
import { describeSignInError } from '../login-error';

describe('describeSignInError', () => {
  it('reports bad credentials only when that is what came back', () => {
    const error = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials');
    expect(describeSignInError(error)).toBe('Email ou senha inválidos.');
  });

  it('reports a connection problem when the request never got a reply', () => {
    // What supabase-js throws when fetch itself fails (offline, DNS, CORS, server down).
    const error = new AuthRetryableFetchError('Failed to fetch', 0);
    expect(describeSignInError(error)).toMatch(/conectar ao servidor/);
    expect(describeSignInError(error)).not.toMatch(/senha inválidos/);
  });

  it('reports a rate limit rather than blaming the password', () => {
    const error = new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit');
    expect(describeSignInError(error)).toMatch(/Muitas tentativas/);
    expect(describeSignInError(error)).not.toMatch(/senha inválidos/);
  });

  it('flags an app-level API key failure as a config problem, not a user error', () => {
    const error = new AuthApiError('Invalid API key', 401, 'bad_jwt');
    expect(describeSignInError(error)).toMatch(/chave de API/);
    expect(describeSignInError(error)).not.toMatch(/senha inválidos/);
  });

  it('reports an unconfirmed email distinctly', () => {
    const error = new AuthApiError('Email not confirmed', 400, 'email_not_confirmed');
    expect(describeSignInError(error)).toMatch(/não foi confirmado/);
  });

  it('reports a server-side failure distinctly', () => {
    const error = new AuthApiError('Internal Server Error', 500, undefined);
    expect(describeSignInError(error)).toMatch(/servidor de autenticação/);
  });

  it('falls back to the underlying message instead of inventing a cause', () => {
    const error = new AuthError('Something unexpected', 418, 'teapot');
    expect(describeSignInError(error)).toContain('Something unexpected');
  });
});

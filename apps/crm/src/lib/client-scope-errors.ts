import { i18n } from '@mesaas/i18n';

/**
 * Writes a member restricted to assigned clients cannot make (a post or etapa of a
 * hidden client, a reorder batch with one, the Financeiro writes, a template that
 * drives a hidden client's flow) fail in one of two shapes:
 * - an RPC or trigger raises `client_scope_restricted` (usually ERRCODE 42501);
 * - an RLS policy refuses the row: bare 42501 ("new row violates row-level
 *   security policy"), with nothing in the message that names the scope.
 *
 * The token is always a scope error. A bare 42501 is read as one only while the
 * signed-in member is restricted: for everyone else it keeps meaning whatever
 * the caller already maps it to. AuthProvider keeps the flag in sync with the
 * membership (`setClientScopedForErrors`), so plain store functions and event
 * handlers, which have no access to the context, can call this too.
 */
let clientScoped = false;

export function setClientScopedForErrors(scoped: boolean): void {
  clientScoped = scoped;
}

const TOKEN = /\bclient_scope_restricted\b/;

function read(err: unknown): { message: string; code: string } {
  if (!err || typeof err !== 'object') return { message: '', code: '' };
  const { message, code } = err as { message?: unknown; code?: unknown };
  return {
    message: typeof message === 'string' ? message : '',
    code: typeof code === 'string' ? code : '',
  };
}

export function isClientScopeError(err: unknown): boolean {
  const { message, code } = read(err);
  if (TOKEN.test(message)) return true;
  return clientScoped && code === '42501';
}

export function clientScopeErrorMessage(): string {
  return i18n.t('common:toast.clientScopeRestricted');
}

/** The scope copy when `err` is a scope error, `fallback` otherwise. */
export function scopeErrorOr(err: unknown, fallback: string): string {
  return isClientScopeError(err) ? clientScopeErrorMessage() : fallback;
}

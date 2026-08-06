import { describe, expect, test } from 'vitest';
import { resolveIgError } from '../instagram-oauth-errors';

describe('resolveIgError', () => {
  test('null when there is no error code', () => {
    expect(resolveIgError(null)).toBeNull();
    expect(resolveIgError('')).toBeNull();
  });

  test('off_meta_activity opens the dedicated dialog', () => {
    expect(resolveIgError('off_meta_activity')).toEqual({ kind: 'off_meta' });
  });

  test('cancelled is informational, not an error', () => {
    expect(resolveIgError('cancelled')).toEqual({
      kind: 'toast',
      level: 'info',
      i18nKey: 'detail.igCancelled',
    });
  });

  test('known codes map to their own copy', () => {
    expect(resolveIgError('no_business_account')).toEqual({
      kind: 'toast',
      level: 'error',
      i18nKey: 'detail.igNotBusiness',
    });
    expect(resolveIgError('link_revoked')).toEqual({
      kind: 'toast',
      level: 'error',
      i18nKey: 'detail.igLinkRevoked',
    });
  });

  test('unknown codes fall back to the generic message', () => {
    expect(resolveIgError('1')).toEqual({
      kind: 'toast',
      level: 'error',
      i18nKey: 'detail.igError',
    });
    expect(resolveIgError('something-new')).toEqual({
      kind: 'toast',
      level: 'error',
      i18nKey: 'detail.igError',
    });
  });
});

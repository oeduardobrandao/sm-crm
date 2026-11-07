import { describe, expect, it } from 'vitest';
import {
  isPlaceholderSlug,
  isValidBrPhone,
  safeNextPath,
  slugifyWorkspaceName,
  workspaceSlugSuffix,
} from '../setupHelpers';

const WS_ID = '3f9a1c2b-0000-4000-8000-000000000000';

describe('slugifyWorkspaceName', () => {
  it('strips accents and joins words with hyphens', () => {
    expect(slugifyWorkspaceName('Agência Ótima & Cia')).toBe('agencia-otima-cia');
  });

  it('maps letters NFD does not decompose', () => {
    expect(slugifyWorkspaceName('Straße Æon')).toBe('strasse-aeon');
    expect(slugifyWorkspaceName('Œuvre Ørsted Łódź Đắk Þór')).toBe('oeuvre-orsted-lodz-dak-thor');
  });

  it('falls back to "workspace" when nothing readable is left', () => {
    expect(slugifyWorkspaceName('✨')).toBe('workspace');
    expect(slugifyWorkspaceName('   ')).toBe('workspace');
  });

  it('trims surrounding spaces and hyphens', () => {
    expect(slugifyWorkspaceName('  Estúdio Lumen  ')).toBe('estudio-lumen');
    expect(slugifyWorkspaceName('--Estúdio--Lumen--')).toBe('estudio-lumen');
  });
});

describe('workspaceSlugSuffix', () => {
  it('takes the first 8 hex characters of the workspace id', () => {
    expect(workspaceSlugSuffix(WS_ID)).toBe('3f9a1c2b');
  });
});

describe('isPlaceholderSlug', () => {
  it('recognises the signup placeholder for this workspace only', () => {
    expect(isPlaceholderSlug('workspace-3f9a1c2b', WS_ID)).toBe(true);
    expect(isPlaceholderSlug('agencia-3f9a1c2b', WS_ID)).toBe(false);
    expect(isPlaceholderSlug('workspace-aaaaaaaa', WS_ID)).toBe(false);
    expect(isPlaceholderSlug(null, WS_ID)).toBe(false);
    expect(isPlaceholderSlug(undefined, WS_ID)).toBe(false);
  });
});

describe('isValidBrPhone', () => {
  it('accepts a phone typed with formatting', () => {
    expect(isValidBrPhone('(11) 99999-9999')).toBe(true);
    expect(isValidBrPhone('+55 11 99999-9999')).toBe(true);
    expect(isValidBrPhone('11 3333-4444')).toBe(true);
  });

  it('rejects too few or too many digits', () => {
    expect(isValidBrPhone('1234')).toBe(false);
    expect(isValidBrPhone('12345678901234')).toBe(false);
    expect(isValidBrPhone('')).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('keeps a same-origin path with its query', () => {
    expect(safeNextPath('/comecar?plan=pro&interval=year')).toBe('/comecar?plan=pro&interval=year');
    expect(safeNextPath('/oauth/consent?authorization_id=abc')).toBe(
      '/oauth/consent?authorization_id=abc',
    );
  });

  it('refuses anything that could leave the origin', () => {
    expect(safeNextPath('//evil.com')).toBeNull();
    expect(safeNextPath('/\\evil.com')).toBeNull();
    expect(safeNextPath('https://evil.com')).toBeNull();
    expect(safeNextPath('evil.com/path')).toBeNull();
    expect(safeNextPath('/\t/evil.com')).toBeNull();
  });

  it('refuses the setup page itself, in any case', () => {
    expect(safeNextPath('/workspace-setup?next=x')).toBeNull();
    expect(safeNextPath('/Workspace-Setup')).toBeNull();
    expect(safeNextPath('/workspace-setup/')).toBeNull();
  });

  it('returns null for a missing value', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath('')).toBeNull();
  });
});

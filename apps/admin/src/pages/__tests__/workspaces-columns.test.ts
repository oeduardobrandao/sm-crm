import { beforeEach, describe, expect, it } from 'vitest';
import {
  COLUMNS_STORAGE_KEY,
  DEFAULT_COLUMN_PREFS,
  DENSITY_STORAGE_KEY,
  readColumnPrefs,
  toggleColumn,
  WORKSPACE_COLUMNS,
  writeColumnPrefs,
} from '../workspaces-columns';

beforeEach(() => localStorage.clear());

describe('workspaces-columns', () => {
  it('defaults to every column visible and comfortable density', () => {
    expect(readColumnPrefs()).toEqual(DEFAULT_COLUMN_PREFS);
    expect(DEFAULT_COLUMN_PREFS.visible).toEqual(WORKSPACE_COLUMNS.map((c) => c.key));
    expect(DEFAULT_COLUMN_PREFS.density).toBe('confortavel');
  });

  it('round-trips through localStorage', () => {
    writeColumnPrefs({ visible: ['name', 'plan'], density: 'compacta' });
    expect(readColumnPrefs()).toEqual({ visible: ['name', 'plan'], density: 'compacta' });
  });

  it('drops unknown column keys and bad density', () => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(['name', 'bogus', 'plan']));
    localStorage.setItem(DENSITY_STORAGE_KEY, 'huge');
    expect(readColumnPrefs()).toEqual({ visible: ['name', 'plan'], density: 'confortavel' });
  });

  it('always keeps the name column visible', () => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(['plan']));
    expect(readColumnPrefs().visible).toEqual(['name', 'plan']);
    expect(toggleColumn(DEFAULT_COLUMN_PREFS, 'name').visible).toContain('name');
  });

  it('survives garbage and a throwing storage', () => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, '{not json');
    expect(readColumnPrefs()).toEqual(DEFAULT_COLUMN_PREFS);
    const boom = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    expect(readColumnPrefs(boom)).toEqual(DEFAULT_COLUMN_PREFS);
    expect(() => writeColumnPrefs(DEFAULT_COLUMN_PREFS, boom)).not.toThrow();
  });

  it('toggleColumn hides and shows hideable columns preserving registry order', () => {
    const hidden = toggleColumn(DEFAULT_COLUMN_PREFS, 'owner');
    expect(hidden.visible).not.toContain('owner');
    const shown = toggleColumn(hidden, 'owner');
    expect(shown.visible).toEqual(DEFAULT_COLUMN_PREFS.visible);
  });
});

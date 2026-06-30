export const LIQUID_GLASS_STORAGE_KEY = 'admin-liquid-glass';

export function readEnabled(storage: Pick<Storage, 'getItem'>): boolean {
  const v = storage.getItem(LIQUID_GLASS_STORAGE_KEY);
  if (v === null) return true; // default ON
  return v !== 'false';
}

export function writeEnabled(storage: Pick<Storage, 'setItem'>, value: boolean): void {
  storage.setItem(LIQUID_GLASS_STORAGE_KEY, value ? 'true' : 'false');
}

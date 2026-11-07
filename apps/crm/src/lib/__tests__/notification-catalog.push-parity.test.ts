import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CATALOG, isPushEligibleType } from '../notification-catalog';
import type { NotificationType } from '@/store/notifications';

const MIGRATIONS = resolve(__dirname, '../../../../../supabase/migrations');
const readMigration = (name: string) => readFileSync(resolve(MIGRATIONS, name), 'utf8');

/** The quoted words of a SQL list, e.g. `'a','b'` -> ['a', 'b']. */
const quoted = (sqlList: string) => [...sqlList.matchAll(/'([^']+)'/g)].map((m) => m[1]);

/** Types the push cron claims (claim_notification_pushes, current version). */
function claimTypes(): string[] {
  const sql = readMigration('20261121000001_post_material_requests.sql');
  const match = sql.match(/n2\.type\s*=\s*any\s*\(\s*array\[([\s\S]*?)\]\s*\)/i);
  if (!match) throw new Error('claim type array not found');
  return quoted(match[1]);
}

/** Types notification_push_prefs accepts (the widened CHECK). */
function checkTypes(): string[] {
  const sql = readMigration('20261123000001_push_prefs_linha_editorial.sql');
  const match = sql.match(
    /add constraint notification_push_prefs_type_check\s+check\s*\(\s*type\s+in\s*\(([\s\S]*?)\)\s*\)/i,
  );
  if (!match) throw new Error('CHECK list not found');
  return quoted(match[1]);
}

const pushEligible = (Object.keys(NOTIFICATION_CATALOG) as NotificationType[]).filter(
  (t) => NOTIFICATION_CATALOG[t].pushEligible,
);

describe('notification-catalog: push parity with the database', () => {
  it('the pushEligible types are exactly the types claim_notification_pushes sends', () => {
    const claim = claimTypes();
    expect(claim.length).toBeGreaterThan(0);
    expect([...pushEligible].sort()).toEqual([...claim].sort());
  });

  it('every pushEligible type (and the master pause) is accepted by the prefs CHECK', () => {
    const check = checkTypes();
    for (const type of pushEligible) expect(check).toContain(type);
    expect(check).toContain('__all__');
  });

  it('the CHECK covers the linha editorial types the claim added', () => {
    const check = checkTypes();
    expect(check).toContain('linha_editorial_aprovada');
    expect(check).toContain('linha_editorial_ajustes');
  });

  it('the CHECK keeps post_material_complete (added by the post material requests migration)', () => {
    expect(checkTypes()).toContain('post_material_complete');
  });

  it('isPushEligibleType follows the catalog and rejects unknown strings', () => {
    expect(isPushEligibleType('mention')).toBe(true);
    expect(isPushEligibleType('event_reminder')).toBe(true);
    expect(isPushEligibleType('step_activated')).toBe(false);
    expect(isPushEligibleType('team_message')).toBe(false);
    expect(isPushEligibleType('__all__')).toBe(false);
    expect(isPushEligibleType('toString')).toBe(false);
    expect(isPushEligibleType('nope')).toBe(false);
  });
});

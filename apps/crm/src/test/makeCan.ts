import type { MyMembership } from '@/store/workspace';
import {
  derivePermission,
  type PermissionAction,
  type PermissionCheck,
  type PermissionModule,
} from '@/lib/permissions';

/**
 * Test-only `can()` factory built on the REAL `derivePermission` truth table
 * (lib/permissions.ts) — never a hand-rolled re-implementation of role/preset
 * semantics. Mirrors exactly what `AuthContext`'s own `can` does:
 * `derivePermission(membership, module, action)`.
 *
 * Pass `null` for an unresolved membership (matches the real app's hydration
 * state) — every check then resolves 'unknown', same as a fresh AuthContext
 * before the membership fetch settles.
 */
export function makeCan(
  membership: MyMembership | null,
): (module: PermissionModule, action?: PermissionAction) => PermissionCheck {
  return (module, action = 'ver') => derivePermission(membership, module, action);
}

/**
 * Builds a fake `MyMembership` row for tests, with sane legacy-agent
 * defaults. Pass `role_id` + `permissions` to simulate a custom role instead
 * of a legacy owner/admin/agent membership.
 */
export function fakeMembership(overrides: Partial<MyMembership> = {}): MyMembership {
  return {
    role: 'agent',
    can_see_financials: false,
    role_id: null,
    permissions: null,
    ...overrides,
  };
}

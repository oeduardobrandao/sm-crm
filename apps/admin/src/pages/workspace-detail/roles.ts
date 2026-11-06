/** Member/invite role names as the boards show them. Kept apart from shared.tsx so the invites
 * card (whose test mocks lib/api without its constants) does not load the limits tables. */
export const ROLE_LABELS: Record<string, string> = {
  owner: 'Dono',
  admin: 'Admin',
  agent: 'Agente',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

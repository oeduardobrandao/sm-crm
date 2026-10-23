// Deploy-order guard: a merge deploys the frontend at once, so a read that depends on
// a new table, view or embed can reach production before its migration. These codes
// mean "that relation is not there", never a transient failure, so callers may fall
// back to the old read. Any other error must still surface.
//   PGRST200: embed relationship not in the schema cache
//   PGRST205: table/view not in the schema cache
//   42P01:    undefined_table (Postgres)
const MISSING_RELATION_CODES = new Set(['PGRST200', 'PGRST205', '42P01']);

export function isMissingRelationError(error: unknown, relation: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  // Every one of these messages names the relation; requiring it keeps a missing
  // OTHER relation (a real bug) from being swallowed.
  if (typeof message !== 'string' || !message.includes(relation)) return false;
  return (
    (typeof code === 'string' && MISSING_RELATION_CODES.has(code)) ||
    /does not exist|could not find|schema cache/i.test(message)
  );
}

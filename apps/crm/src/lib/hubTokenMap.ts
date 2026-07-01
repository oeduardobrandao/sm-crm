export function buildUsableTokenMap(
  rows: Array<{ cliente_id: number | null; token: string | null; expires_at: string | null }>,
  nowIso: string,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of rows) {
    if (row.cliente_id && row.token && row.expires_at && row.expires_at > nowIso) {
      map.set(row.cliente_id, row.token);
    }
  }
  return map;
}

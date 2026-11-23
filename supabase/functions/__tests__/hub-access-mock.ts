/** Shared mock for the `hub_access_context` RPC. Returns null for any other
 *  function so the caller falls through to its own rpc mock. */
export function hubAccessRpc(
  fn: string,
  override?: unknown,
): { data: unknown; error: null } | null {
  if (fn !== "hub_access_context") return null;
  return { data: override ?? { require_login: false, person: null }, error: null };
}

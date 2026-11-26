import { type Lang, resolveLang } from "./lang.ts";

// Minimal structural type: callers pass a Supabase client. Kept loose on purpose
// (deno check needs query builders to be PromiseLike, which `any` satisfies).
// deno-lint-ignore no-explicit-any
export type DbClient = { from: (table: string) => any };

type WsRow = { language?: unknown; created_at?: string };

/** Language of one workspace. Any failure logs and falls back to pt; never throws. */
export async function workspaceLang(db: DbClient, contaId: string): Promise<Lang> {
  try {
    const { data, error } = await db.from("workspaces").select("language").eq("id", contaId)
      .maybeSingle();
    if (error || !data) {
      console.error("[i18n] workspace lang lookup failed", { contaId });
      return "pt";
    }
    return resolveLang((data as WsRow).language);
  } catch {
    console.error("[i18n] workspace lang lookup failed", { contaId });
    return "pt";
  }
}

/** Language of the oldest workspace the user owns. None or failure: pt. */
export async function ownerLang(db: DbClient, userId: string): Promise<Lang> {
  try {
    const { data, error } = await db.from("workspace_members")
      .select("workspaces!inner(language, created_at)")
      .eq("user_id", userId).eq("role", "owner");
    if (error) {
      console.error("[i18n] owner lang lookup failed", { userId });
      return "pt";
    }
    const rows = ((data ?? []) as { workspaces: WsRow | WsRow[] | null }[])
      .map((r) => (Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces))
      .filter((w): w is WsRow => !!w);
    rows.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
    return rows.length ? resolveLang(rows[0].language) : "pt";
  } catch {
    console.error("[i18n] owner lang lookup failed", { userId });
    return "pt";
  }
}

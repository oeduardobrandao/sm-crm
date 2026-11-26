import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chunk, fetchAllRows } from "../_shared/paginate.ts";
import { loadPricedMrrRows } from "./mrr.ts";
import {
  type AcqRow,
  type AcqWorkspace,
  aggregateChannels,
  monthBounds,
} from "./acquisition-logic.ts";

/**
 * Signups per acquisition channel for workspaces created in [from_month, to_month] (São Paulo
 * months), with ever-paid, paying-now and MRR (per currency). Paying/MRR reuse get-mrr's pipeline.
 */
export async function handleGetAcquisitionChannels(
  svc: SupabaseClient,
  body: { from_month?: string; to_month?: string },
  headers: Record<string, string>,
  deps: { loadPriced?: typeof loadPricedMrrRows } = {},
) {
  const bounds = monthBounds(body.from_month as string, body.to_month as string);
  if (!bounds) {
    return new Response(JSON.stringify({ error: "invalid_range" }), { status: 400, headers });
  }
  const loadPriced = deps.loadPriced ?? loadPricedMrrRows;

  const workspaces = await fetchAllRows<AcqWorkspace>((from, to) =>
    svc
      .from("workspaces")
      .select("id, created_at, demo_created_at, is_internal")
      .gte("created_at", bounds.startIso)
      .lt("created_at", bounds.endIso)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const ids = workspaces.map((w) => w.id);

  const acquisition = new Map<string, AcqRow>();
  const everPaidIds = new Set<string>();
  for (const part of chunk(ids)) {
    const { data, error } = await svc
      .from("workspace_acquisition")
      .select("workspace_id, channel, campaign")
      .in("workspace_id", part);
    if (error) throw error;
    for (const r of (data ?? []) as AcqRow[]) acquisition.set(r.workspace_id, r);

    const { data: paid, error: paidErr } = await svc.rpc("ever_paid_workspace_ids", {
      p_ids: part,
    });
    if (paidErr) throw paidErr;
    for (const r of (paid ?? []) as { workspace_id: string }[]) everPaidIds.add(r.workspace_id);
  }

  const { priced } = await loadPriced(svc);
  const inRange = new Set(ids);

  const channels = aggregateChannels({
    workspaces,
    acquisition,
    priced: priced
      .filter((p) => inRange.has(p.workspace_id))
      .map((p) => ({
        workspace_id: p.workspace_id,
        currency: p.currency === "usd" ? ("usd" as const) : ("brl" as const),
        monthly_cents: p.monthly_cents,
      })),
    everPaidIds,
  });
  return new Response(JSON.stringify({ channels }), { status: 200, headers });
}

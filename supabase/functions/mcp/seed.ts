import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { effectivePlanLimit } from "../_shared/entitlements-rpc.ts";

// The two custom-property definitions the agent reads as first-class fields.
export const MCP_PROP_MODO = "modo";
export const MCP_PROP_ANOTACAO = "anotacao_qualitativa";
export const MODO_OPTIONS = ["storytelling", "autoridade", "objecao", "pauta_quente"];

export interface PropDefSeed {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

// NOTE (PR 2): the `select` config shape must be aligned with the CRM's select renderer /
// workflow_select_options when seeding is wired into feature enablement. The MCP read path only
// consumes post_property_values.value, so this shape does not affect reads.
export const MCP_SEED_DEFS: readonly PropDefSeed[] = [
  { name: MCP_PROP_MODO, type: "select", config: { options: MODO_OPTIONS } },
  { name: MCP_PROP_ANOTACAO, type: "text", config: {} },
];

/**
 * Decide which seed defs to add to a template WITHOUT exceeding its custom-property cap.
 *  - skips defs whose name already exists (idempotent)
 *  - never returns more than (max - currentCount) defs; max === null => unlimited
 * This is what prevents the `trg_limit_custom_props` BEFORE INSERT trigger from blocking the seed.
 */
export function planTemplateSeed(
  existingNames: string[],
  currentCount: number,
  max: number | null,
): PropDefSeed[] {
  const missing = MCP_SEED_DEFS.filter((d) => !existingNames.includes(d.name));
  if (max === null) return missing;
  const slots = Math.max(0, max - currentCount);
  return missing.slice(0, slots);
}

export interface SeedSummary {
  seeded: number;
  skippedAtCap: number[]; // template ids skipped because they were at their cap
}

/**
 * Guarded auto-seed: add modo + anotacao to every workflow_template in the workspace, skipping
 * (and reporting) any template already at its max_custom_properties_per_template cap.
 * Intended to run at feature enablement (PR 2). Idempotent.
 */
export async function seedMcpProperties(
  db: SupabaseClient,
  contaId: string,
): Promise<SeedSummary> {
  const max = await effectivePlanLimit(db, contaId, "max_custom_properties_per_template");
  const { data: templates } = await db
    .from("workflow_templates")
    .select("id")
    .eq("conta_id", contaId);

  const summary: SeedSummary = { seeded: 0, skippedAtCap: [] };
  for (const tpl of templates ?? []) {
    const templateId = tpl.id as number;
    const { data: defs } = await db
      .from("template_property_definitions")
      .select("name")
      .eq("template_id", templateId);
    const existingNames = (defs ?? []).map((d) => d.name as string);
    const toAdd = planTemplateSeed(existingNames, existingNames.length, max);
    if (toAdd.length === 0) {
      if (max !== null && existingNames.length >= max) summary.skippedAtCap.push(templateId);
      continue;
    }
    const rows = toAdd.map((d) => ({
      template_id: templateId,
      conta_id: contaId,
      name: d.name,
      type: d.type,
      config: d.config,
    }));
    const { error } = await db.from("template_property_definitions").insert(rows);
    if (error) {
      summary.skippedAtCap.push(templateId);
    } else {
      summary.seeded += rows.length;
    }
  }
  return summary;
}

// deno-lint-ignore-file no-explicit-any
import { z } from "npm:zod@3";
import { insertAuditLog } from "../_shared/audit.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import {
  McpInputError,
  McpOwnerError,
  McpScopeError,
  requireOwner,
  requireScope,
} from "../_shared/mcp-token.ts";
import type { Deps } from "./queries.ts";
import { FINANCEIRO_ERROS } from "./financeiro-errors.ts";
import { TOOL_META } from "./tool-meta.ts";

export function jsonResult(data: unknown, meta?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    ...(meta && Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}

export function errorResult(e: unknown) {
  const message = e instanceof McpScopeError
    ? `Permission denied: missing scope '${e.scope}'.`
    : e instanceof McpOwnerError
    ? FINANCEIRO_ERROS.owner_only
    : e instanceof McpInputError
    ? e.message
    : "Internal error.";
  // Never leak raw error details (logged internally instead).
  if (!(e instanceof McpScopeError) && !(e instanceof McpOwnerError) && !(e instanceof McpInputError)) {
    console.error("[mcp] tool error:", e);
  }
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

export async function audit(deps: Deps, name: string, args: Record<string, unknown>) {
  await insertAuditLog(deps.db as any, {
    conta_id: deps.ctx.conta_id,
    actor_user_id: deps.ctx.created_by,
    action: `mcp.${name}`,
    resource_type: "mcp",
    resource_id: String(
      (args.post_id ?? args.client_id ?? args.workflow_id ?? args.task_id ?? args.member_id ?? args.template_id ??
        args.lancamento_id ?? args.recorrente_id ?? args.membro_id ?? args.cliente_id ?? args.funcao_id ??
        args.inicio ?? "") || "",
    ),
    metadata: { key_id: deps.ctx.key_id, tool: name, args }, // args = ids/filters only, no payload
  });
}

export type FinanceiroFeature = "feature_financial" | "feature_financeiro_v2";

export interface RegisterOpts {
  /** Only the workspace owner (ctx.role === 'owner') may call the tool; also requires feature_financial. */
  ownerOnly?: boolean;
  /** Extra plan feature required before `run` (with `ownerOnly`). */
  feature?: FinanceiroFeature;
  /** Tool `_meta` (descriptor level), e.g. `ui` hints. Omitted from the registration when unset. */
  meta?: Record<string, unknown>;
  /** Awaited after `run` and the audit; a non-empty object is attached as the result's `_meta`. */
  resultMeta?: (args: any, data: any) => Promise<Record<string, unknown> | undefined>;
}

const FEATURE_OFF_MESSAGE: Record<FinanceiroFeature, string> = {
  feature_financial: "O plano deste workspace não inclui o Financeiro.",
  feature_financeiro_v2: "O Financeiro v2 não está ativo neste workspace.",
};

/** Register one tool with scope-gating + audit. `auditArgs` also receives the RESULT, so write
 * audits can carry result metadata (ids, counts) without ever carrying payloads; existing
 * single-param callbacks are unaffected. */
export function register(
  server: any,
  deps: Deps,
  name: string,
  scope: string,
  description: string,
  shape: z.ZodRawShape,
  run: (args: any) => Promise<unknown>,
  auditArgs?: (args: any, result: any) => Record<string, unknown>,
  opts?: RegisterOpts,
) {
  // Per-deps and opt-in (never a module global): the structural test reads it, production skips it.
  const meta = TOOL_META[name];
  if (!meta) throw new Error(`missing TOOL_META for ${name}`);
  deps.registry?.push({ name, scope, ownerOnly: opts?.ownerOnly === true });
  const config: Record<string, unknown> = {
    title: meta.title,
    description,
    inputSchema: shape,
    annotations: {
      title: meta.title,
      readOnlyHint: meta.readOnly,
      destructiveHint: meta.destructive ?? false,
      openWorldHint: meta.openWorld ?? false,
    },
  };
  if (opts?.meta !== undefined) config._meta = opts.meta;
  server.registerTool(name, config, async (args: any) => {
    try {
      requireScope(deps.ctx, scope);
      if (opts?.ownerOnly) {
        requireOwner(deps.ctx);
        // The service role ignores RLS, so the plan gate has to run here, before any read or write.
        const features: FinanceiroFeature[] = ["feature_financial"];
        if (opts.feature === "feature_financeiro_v2") features.push("feature_financeiro_v2");
        for (const feature of features) {
          if (!(await effectivePlanFeature(deps.db as any, deps.ctx.conta_id, feature))) {
            throw new McpInputError(FEATURE_OFF_MESSAGE[feature]);
          }
        }
      }
      const data = await run(args ?? {});
      // Owner-only tools never audit raw args (they carry valores/nomes); without an explicit
      // auditArgs the metadata is empty.
      const defaultAudit = opts?.ownerOnly ? () => ({}) : (a: any) => a;
      await audit(deps, name, (auditArgs ?? defaultAudit)(args ?? {}, data));
      const resultMeta = opts?.resultMeta ? await opts.resultMeta(args ?? {}, data) : undefined;
      return jsonResult(data, resultMeta);
    } catch (e) {
      return errorResult(e);
    }
  });
}

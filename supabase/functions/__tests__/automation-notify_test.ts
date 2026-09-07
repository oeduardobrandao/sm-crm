import { assertEquals } from "./assert.ts";
import { notifyAutomationFailure } from "../_shared/automation-notify.ts";

// --- Mock helpers -------------------------------------------------------------
// Um `.eq()` genérico (encadeia indefinidamente) em vez de uma cadeia com
// profundidade fixa: o dedupe ganhou um `.eq("metadata->>reason", ...)` a
// mais na Correção 2, e uma cadeia hardcoded em 3 níveis quebraria por engano
// de "profundidade errada" em vez de testar o comportamento de verdade.
// deno-lint-ignore no-explicit-any
function selectChain(resolver: () => { data: unknown; error: unknown }): any {
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.gt = () => chain;
  chain.limit = () => Promise.resolve(resolver());
  return chain;
}

type StoredNotification = {
  type: string;
  workspace_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

// Mock com estado: mantém as notificações "inseridas" e aplica o MESMO filtro
// que a query de dedupe real usa (type + workspace_id + client_id + reason,
// dentro da janela de 24h), pra provar o comportamento fim-a-fim de duas
// chamadas em sequência -- não só os parâmetros passados pra Graph/RPC.
function makeStatefulSvc() {
  const notifications: StoredNotification[] = [];
  const rpcCalls: Record<string, unknown>[] = [];

  const svc = {
    from(table: string) {
      if (table !== "notifications") throw new Error(`makeStatefulSvc: unexpected table "${table}"`);
      const filters: Array<(n: StoredNotification) => boolean> = [];
      // deno-lint-ignore no-explicit-any
      const chain: Record<string, any> = {};
      chain.select = () => chain;
      chain.eq = (col: string, val: unknown) => {
        filters.push((n) => {
          if (col === "type") return n.type === val;
          if (col === "workspace_id") return n.workspace_id === val;
          if (col === "metadata->>client_id") return String(n.metadata.client_id) === val;
          if (col === "metadata->>reason") return n.metadata.reason === val;
          throw new Error(`makeStatefulSvc: unexpected eq column "${col}"`);
        });
        return chain;
      };
      chain.gt = (col: string, val: string) => {
        if (col !== "created_at") throw new Error(`makeStatefulSvc: unexpected gt column "${col}"`);
        filters.push((n) => n.created_at > val);
        return chain;
      };
      chain.limit = (n: number) =>
        Promise.resolve({ data: notifications.filter((row) => filters.every((f) => f(row))).slice(0, n), error: null });
      return chain;
    },
    rpc(name: string, params: Record<string, unknown>) {
      rpcCalls.push({ name, params });
      if (name === "resolve_notification_targets") return Promise.resolve({ data: ["u1"], error: null });
      if (name === "insert_notification_batch") {
        notifications.push({
          type: params.p_type as string,
          workspace_id: params.p_workspace_id as string,
          metadata: params.p_metadata as Record<string, unknown>,
          created_at: new Date().toISOString(),
        });
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`makeStatefulSvc: unexpected rpc "${name}"`);
    },
  };

  return { svc, notifications, rpcCalls };
}

// --- Tests ---------------------------------------------------------------------

Deno.test("notifyAutomationFailure inclui extraMetadata no insert", async () => {
  const calls: Record<string, unknown>[] = [];
  const svc = {
    from: () => ({ select: () => selectChain(() => ({ data: [], error: null })) }),
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === "resolve_notification_targets") return { data: ["u1"], error: null };
      return { data: null, error: null };
    },
  };

  await notifyAutomationFailure(svc as never, {
    contaId: "w1",
    clientId: 42,
    reason: "target_never_published",
    extraMetadata: { automation_id: "a1", automation_name: "Calendario Setembro" },
  });

  const insert = calls.find((c) => c.name === "insert_notification_batch")!;
  const meta = (insert.params as Record<string, Record<string, unknown>>).p_metadata;
  assertEquals(meta.reason, "target_never_published");
  assertEquals(meta.client_id, 42);
  assertEquals(meta.automation_id, "a1");
  assertEquals(meta.automation_name, "Calendario Setembro");
});

// --- Correção 3: extraMetadata hostil não pode sobrescrever campo canônico ---
//
// O spread do `extraMetadata` vinha DEPOIS dos campos canônicos no objeto de
// metadata: um chamador que (por engano ou não) incluísse `reason`/`client_id`
// dentro de `extraMetadata` sobrescrevia o valor real em silêncio. Isso virou
// load-bearing com a Correção 2, porque o dedupe passou a filtrar por
// `metadata->>reason`.
Deno.test("notifyAutomationFailure: extraMetadata hostil nao sobrescreve reason nem client_id", async () => {
  const calls: Record<string, unknown>[] = [];
  const svc = {
    from: () => ({ select: () => selectChain(() => ({ data: [], error: null })) }),
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === "resolve_notification_targets") return { data: ["u1"], error: null };
      return { data: null, error: null };
    },
  };

  await notifyAutomationFailure(svc as never, {
    contaId: "w1",
    clientId: 42,
    reason: "target_never_published",
    extraMetadata: { reason: "token_expired", client_id: 999, automation_id: "a1" },
  });

  const insert = calls.find((c) => c.name === "insert_notification_batch")!;
  const meta = (insert.params as Record<string, Record<string, unknown>>).p_metadata;
  assertEquals(meta.reason, "target_never_published");
  assertEquals(meta.client_id, 42);
  assertEquals(meta.automation_id, "a1");
});

// --- Correção 2: dedupe agora considera o `reason` -----------------------------
//
// Motivos diferentes tem remédios diferentes (token_expired manda reconectar,
// target_never_published manda escolher o post publicado): colapsar os dois
// no mesmo dedupe de 24h escondia a orientação certa. Duas chamadas com
// motivos diferentes pro MESMO cliente, dentro da janela, devem gerar DUAS
// notificações; o mesmo motivo repetido continua gerando UMA.
Deno.test("notifyAutomationFailure: motivos diferentes, mesmo cliente, geram duas notificacoes", async () => {
  const { svc, notifications } = makeStatefulSvc();

  await notifyAutomationFailure(svc as never, { contaId: "w1", clientId: 42, reason: "token_expired" });
  await notifyAutomationFailure(svc as never, { contaId: "w1", clientId: 42, reason: "target_never_published" });

  assertEquals(notifications.length, 2);
  assertEquals(notifications.map((n) => n.metadata.reason).sort(), ["target_never_published", "token_expired"]);
});

Deno.test("notifyAutomationFailure: o MESMO motivo repetido continua gerando uma unica notificacao", async () => {
  const { svc, notifications } = makeStatefulSvc();

  await notifyAutomationFailure(svc as never, { contaId: "w1", clientId: 42, reason: "token_expired" });
  await notifyAutomationFailure(svc as never, { contaId: "w1", clientId: 42, reason: "token_expired" });

  assertEquals(notifications.length, 1);
});

// Handlers puros de hub-report-docs (spec §9): lista união legado+docs, doc
// por token de portal, print-doc por HMAC. Injetam db para teste sem
// Deno.serve.
import { verifyPrintToken } from "../_shared/report-docs/print-token.ts";
import type { HubToken } from "../_shared/hub-token.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type HubReportListItem =
  | {
      kind: "legacy";
      month: string;
      status: string;
      generated_at: string | null;
      has_pdf: boolean;
      has_html: boolean;
    }
  | { kind: "doc"; id: string; title: string; month: string; generated_at: string };

export async function listHandler(db: Db, hubToken: HubToken): Promise<HubReportListItem[]> {
  const [{ data: legacy }, { data: docs }] = await Promise.all([
    db
      .from("analytics_reports")
      .select("report_month, status, generated_at, storage_path, html_storage_path")
      .eq("client_id", hubToken.cliente_id)
      .eq("conta_id", hubToken.conta_id)
      .eq("status", "ready"),
    db
      .from("report_documents")
      .select("id, title, period_start, created_at")
      .eq("client_id", hubToken.cliente_id)
      .eq("conta_id", hubToken.conta_id)
      .eq("status", "ready")
      // Pino a ordem no banco (mais recente primeiro) pra dois docs do MESMO
      // mês (period_start) terem uma ordem estável e significativa -- sem
      // isso a ordem entre eles dependia da ordem física de retorno do
      // Postgres, que não é garantida. O `.sort()` por mês abaixo (linha ~63)
      // é estável (Array.prototype.sort, ES2019+), então essa ordenação do
      // banco sobrevive intacta como desempate dentro de cada mês.
      .order("period_start", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  const items: HubReportListItem[] = [
    ...(docs ?? []).map(
      (d: { id: string; title: string; period_start: string; created_at: string }) => ({
        kind: "doc" as const,
        id: d.id,
        title: d.title,
        month: String(d.period_start).slice(0, 7),
        generated_at: d.created_at,
      }),
    ),
    ...(legacy ?? []).map(
      (r: {
        report_month: string;
        status: string;
        generated_at: string | null;
        storage_path: string | null;
        html_storage_path: string | null;
      }) => ({
        kind: "legacy" as const,
        month: r.report_month,
        status: r.status,
        generated_at: r.generated_at,
        has_pdf: !!r.storage_path,
        has_html: !!r.html_storage_path,
      }),
    ),
  ];
  return items.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
}

export interface HubReportDocPayload {
  id: string;
  title: string;
  layout: unknown;
  data_snapshot: unknown;
  period_start: string;
}

async function loadReadyDoc(
  db: Db,
  docId: string,
): Promise<(HubReportDocPayload & { client_id: number; conta_id: string }) | null> {
  const { data } = await db
    .from("report_documents")
    .select("id, title, layout, data_snapshot, period_start, client_id, conta_id, status")
    .eq("id", docId)
    .maybeSingle();
  if (!data || data.status !== "ready") return null;
  return data;
}

export async function docHandler(
  db: Db,
  hubToken: HubToken,
  docId: string,
): Promise<HubReportDocPayload | null> {
  const doc = await loadReadyDoc(db, docId);
  // Cadeia inteira (spec §9): documento de outro cliente do MESMO workspace = 404.
  if (!doc || doc.client_id !== hubToken.cliente_id || doc.conta_id !== hubToken.conta_id) {
    return null;
  }
  return stripInternalFields(doc);
}

export async function printDocHandler(
  db: Db,
  secret: string,
  docId: string,
  pt: string,
  nowEpochS: number,
): Promise<HubReportDocPayload | null> {
  if (!secret || !(await verifyPrintToken(pt, docId, nowEpochS, secret))) return null;
  const doc = await loadReadyDoc(db, docId);
  if (!doc) return null;
  return stripInternalFields(doc);
}

// loadReadyDoc's row carries client_id/conta_id/status for the ownership and
// readiness checks above; none of the three are part of the public
// HubReportDocPayload contract, so strip all three before the payload leaves
// the handler.
function stripInternalFields(
  doc: HubReportDocPayload & { client_id: number; conta_id: string; status?: string },
): HubReportDocPayload {
  const { client_id: _c, conta_id: _w, status: _s, ...payload } = doc;
  return payload;
}

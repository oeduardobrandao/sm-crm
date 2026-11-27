/** Inputs for the team transactional pt-unchanged fixtures (fixtures/team-email-pt.json). */
import type { DunningStage } from "../../_shared/dunning-logic.ts";

export const APP = "https://app.test";
export const WS_NAMES = ["Agência Lume", `Agência <Lume> & "Cia"`];
export const INVITE_LINKS = [`${APP}/verify?t=1&redirect_to=${APP}/configurar-senha`, "javascript:alert(1)"];
export const STAGES: DunningStage[] = ["first", "retry", "final"];
export const NEXT_LABELS: (string | null)[] = [null, "24 de julho"];
export const ATTEMPT_ISOS: (string | null)[] = [null, "2026-07-24T10:00:00.000Z", "2026-01-02T15:30:00.000Z", "2026-12-31T23:00:00.000Z"];
export const CONNECT_AGENCIES = ["Agência Lume", "Agência\nLume\r\n<b>"];
export const CONNECT = { clienteName: "Clínica <Sorriso>", connectUrl: `${APP}/conectar/abc?x=1&y=2`, appBaseUrl: APP };
export const CONNECTED = { clienteName: "Clínica Sorriso", igUsername: "clinica", clienteUrl: `${APP}/clientes/1`, appBaseUrl: APP };
export const REPORT_BASE = {
  clientName: "Ana Lima", month: "2026-09", workspaceName: "Agência Lume", brandColor: "#7c3aed", logoUrl: null,
  aiSummary: "Mês forte.", pdfUrl: `${APP}/r.pdf`, hubUrl: `${APP}/lume/hub/tok`,
};
export const REPORT_CASES: Record<string, Record<string, unknown>> = {
  "3kpis": { emailKpis: { views: { value: 48200, pct_change: 18 }, interactions: { value: 1200 }, followers_gained: { value: 87 } } },
  "neg": { emailKpis: { views: { value: 9999, pct_change: -9 }, interactions: { value: 10000, pct_change: 0 }, followers_gained: { value: 1_250_000, pct_change: 3 } } },
  "1kpi": { emailKpis: { views: { value: 48200 } } },
  "none": { emailKpis: null },
  "nohub": { hubUrl: "", pdfUrl: "", emailKpis: null },
  "nosummary": { aiSummary: null, month: "2026-01", clientName: "Marina Arrais Souza", emailKpis: null },
  "dec": { month: "2026-12", workspaceName: "A <b>", emailKpis: { views: { value: 5, pct_change: 12 } } },
};
export const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];

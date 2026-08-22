// Núcleo da geração: recebe db (service client) e deps injetáveis, devolve o id
// do documento criado. Síncrono, sem fila: spec §5.
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { generateAINarrative, type GenerateResult } from "../_shared/report-template/ai.ts";
import { type ThumbnailStorage } from "../_shared/instagram-thumbnail-cache.ts";
import { monthWindow } from "../_shared/report-docs/month-window.ts";
import { buildDefaultLayout } from "../_shared/report-docs/default-layout.ts";
import {
  aiGoalsDoc, aiRecommendationsDoc, aiSummaryDoc, fallbackSummaryParagraphs,
  fillAiBlocks, textDoc,
} from "../_shared/report-docs/tiptap-doc.ts";
import { snapshotToReportData } from "../_shared/report-docs/ai-input.ts";
import { validateLayout, type ReportLayout } from "../_shared/report-docs/layout.ts";
import { GenerateError } from "./errors.ts";
import { loadClientSnapshot } from "./snapshot-source.ts";

export { GenerateError } from "./errors.ts";

export interface GenerateDeps {
  fetch: typeof fetch;
  storage: ThumbnailStorage;
  geminiKey: string;
  userId: string;
}

// deno-lint-ignore no-explicit-any
type Db = any;

export async function generateReportDocument(
  db: Db,
  deps: GenerateDeps,
  contaId: string,
  clientId: number,
  month: string,
  templateId: string | null,
): Promise<{ id: string }> {
  // Mês válido e não futuro.
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  let w;
  try {
    w = monthWindow(month);
  } catch {
    throw new GenerateError("bad_month");
  }
  if (month > currentMonth) throw new GenerateError("bad_month");

  // Ownership explícito de TODO id: service role bypassa RLS (spec §5).
  const { data: cliente } = await db.from("clientes")
    .select("id, conta_id, nome, especialidade, include_ai_analysis")
    .eq("id", clientId).maybeSingle();
  if (!cliente || cliente.conta_id !== contaId) throw new GenerateError("not_found");

  if (!(await effectivePlanFeature(db, contaId, "feature_analytics_reports"))) {
    throw new GenerateError("feature_disabled");
  }

  // Layout base: template explícito > default do workspace > padrão do sistema
  // (spec §5 passo 3). Template explícito inválido é erro do request; default
  // inválido só degrada com warn (o usuário não pediu esse template pelo nome).
  //
  // templateId === "system" é a sentinela explícita do "Padrão do sistema" no
  // dialog do CRM (achado de review externo, PR #379): pula TANTO a busca do
  // template explícito QUANTO o fallback do is_default do workspace, mesmo
  // quando um default existe. `null`/ausente continua caindo no fallback do
  // is_default -- outros clientes (ex.: automações) dependem desse
  // comportamento omitido.
  let templateLayout: ReportLayout | null = null;
  if (templateId === "system") {
    // Nada a buscar: templateLayout permanece null e o layout nasce de
    // buildDefaultLayout() abaixo, ignorando o is_default do workspace.
  } else if (templateId) {
    const { data: tpl } = await db.from("report_templates")
      .select("id, conta_id, layout").eq("id", templateId).maybeSingle();
    if (!tpl || tpl.conta_id !== contaId) throw new GenerateError("not_found");
    const check = validateLayout(tpl.layout);
    if (!check.ok) throw new GenerateError("invalid_template");
    templateLayout = check.layout;
  } else {
    const { data: tpl } = await db.from("report_templates")
      .select("id, conta_id, layout").eq("conta_id", contaId)
      .eq("is_default", true).maybeSingle();
    if (tpl) {
      const check = validateLayout(tpl.layout);
      if (check.ok) templateLayout = check.layout;
      else console.warn("[report-docs] template default com layout inválido; usando o padrão do sistema");
    }
  }

  const { snapshot, igAccountId } = await loadClientSnapshot(
    db, deps, contaId, { id: cliente.id, especialidade: cliente.especialidade }, month,
  );

  // IA: nunca derruba a geração (padrão do v2, index.ts:987-1017).
  let aiContent: unknown = null;
  let summaryDoc = textDoc(fallbackSummaryParagraphs(snapshot.kpis, snapshot.period.label));
  let recsDoc: unknown | null = null;
  let goalsDoc: unknown | null = null;
  const wantsAi = cliente.include_ai_analysis !== false;
  if (wantsAi && deps.geminiKey) {
    const AI_TIMEOUT_MS = 45_000;
    // Ao vencer o teto de 45s, aborta o fetch do Gemini em voo (achado de
    // review externo: sem isso, o fetch perdedor do race seguia rodando
    // órfão na isolate até a plataforma matá-lo). O signal é opcional em
    // generateAINarrative -- o pipeline legado (instagram-report-generator-v2)
    // não passa nada e continua idêntico.
    const controller = new AbortController();
    let timer: number | undefined;
    const timeoutPromise = new Promise<GenerateResult>((resolve) => {
      timer = setTimeout(
        () => {
          controller.abort();
          resolve({ output: null, status: "generation_failed", error: "ai timeout" });
        },
        AI_TIMEOUT_MS,
      );
    });
    try {
      const ai = await Promise.race([
        generateAINarrative(snapshotToReportData(snapshot), deps.geminiKey, controller.signal),
        timeoutPromise,
      ]);
      if (ai.status === "success" && ai.output) {
        aiContent = ai.output;
        summaryDoc = aiSummaryDoc(ai.output);
        recsDoc = aiRecommendationsDoc(ai.output);
        goalsDoc = aiGoalsDoc(ai.output);
      } else {
        console.warn(`[report-docs] AI falhou: ${"error" in ai ? ai.error : ai.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // hasAi é derivado do CONTEÚDO (recsDoc !== null), não da intenção
  // (wantsAi): se a IA falhar ou GEMINI_API_KEY faltar, recsDoc/goalsDoc
  // ficam null e fillAiBlocks remove os blocos -- usar wantsAi aqui deixaria
  // um "Próximos passos" órfão, sem nenhum bloco de conteúdo embaixo.
  // Só entra no fallback do padrão do sistema quando não há template
  // (explícito ou default) válido.
  const baseLayout = templateLayout ?? buildDefaultLayout({
    hasAi: recsDoc !== null,
    hasAudience: snapshot.audience !== null,
    hasBestTimes: snapshot.best_times.length > 0,
    hasTags: snapshot.tags_performance.length > 0,
  });
  const layout = fillAiBlocks(baseLayout, {
    summary: summaryDoc, recommendations: recsDoc, goals: goalsDoc,
  });

  const { data: inserted, error: insertError } = await db.from("report_documents")
    .insert({
      conta_id: contaId,
      client_id: clientId,
      instagram_account_id: igAccountId,
      title: `Relatório de ${w.label}`,
      period_start: w.startDate,
      period_end: w.endDateExclusive,
      layout,
      data_snapshot: snapshot,
      ai_content: aiContent,
      status: "ready",
      created_by: deps.userId,
    })
    .select("id").single();
  if (insertError || !inserted) {
    throw new Error(`insert failed: ${insertError?.message ?? "no row"}`);
  }
  return { id: inserted.id };
}

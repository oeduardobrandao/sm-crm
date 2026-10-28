// Núcleo da geração: recebe db (service client) e deps injetáveis, devolve o id
// do documento criado. Síncrono, sem fila: spec §5.
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { generateAINarrative, type GenerateResult } from "../_shared/report-template/ai.ts";
import { type ThumbnailStorage } from "../_shared/instagram-thumbnail-cache.ts";
import { monthWindow } from "../_shared/report-docs/month-window.ts";
import { buildDefaultLayout, NEXT_STEPS_TITLE } from "../_shared/report-docs/default-layout.ts";
import {
  addMissingPlatformSections, dropUnselectedPlatformBlocks, narrativePlatforms,
} from "../_shared/report-docs/platform-filter.ts";
import {
  aiGoalsDoc, aiRecommendationsDoc, aiSummaryDoc, fallbackSummaryParagraphs,
  fillAiBlocks, textDoc,
} from "../_shared/report-docs/tiptap-doc.ts";
import { prefixTikTokGoalMetrics, snapshotToReportData } from "../_shared/report-docs/ai-input.ts";
import {
  blockPlatform, normalizeCoverSize, sanitizeLayoutForTemplate, validateLayout, type ReportLayout,
} from "../_shared/report-docs/layout.ts";
import type { ReportPlatform } from "./client-id.ts";
import { GenerateError } from "./errors.ts";
import { connectedPlatforms, loadClientSnapshot } from "./snapshot-source.ts";
import { saoPauloDate } from "../_shared/sao-paulo-date.ts";

export { GenerateError } from "./errors.ts";

const METRIC_PRIORITY_INSTAGRAM =
  "METRIC PRIORITY: 'views' (visualizações) is the primary performance metric for " +
  "this report. Lead the executive summary, analysis, recommendations and " +
  "suggested_goals with views wherever the data provides them; treat reach as " +
  "secondary context.";

const METRIC_PRIORITY_INSTAGRAM_WITH_TIKTOK =
  "METRIC PRIORITY: on Instagram, 'views' (visualizações) is the primary performance metric. " +
  "Lead the Instagram part of the executive summary, analysis, recommendations and " +
  "suggested_goals with Instagram views wherever the data provides them; treat reach as " +
  "secondary context. This priority does not apply to the TikTok data.";

/** Direcionamento de views do Instagram (pedido 2026-08). Só entra quando o Instagram está na
 * narrativa e o dado existe; com TikTok junto, fica restrito ao Instagram. O texto só Instagram
 * é o de sempre. */
export function metricPriorityGuidance(n: {
  instagram: boolean;
  tiktok: boolean;
  instagramHasViews: boolean;
}): string | undefined {
  if (!n.instagram || !n.instagramHasViews) return undefined;
  return n.tiktok ? METRIC_PRIORITY_INSTAGRAM_WITH_TIKTOK : METRIC_PRIORITY_INSTAGRAM;
}

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
  /** Plataformas pedidas no dialog; null = todas as conectadas (automações e chamadores antigos). */
  platforms: ReportPlatform[] | null = null,
): Promise<{ id: string }> {
  // Mês válido e não futuro.
  // Mês corrente em São Paulo: das 21h às 24h do último dia, o mês UTC já virou.
  const currentMonth = saoPauloDate(new Date()).slice(0, 7);
  let w;
  try {
    w = monthWindow(month);
  } catch {
    throw new GenerateError("bad_month");
  }
  if (month > currentMonth) throw new GenerateError("bad_month");

  // Ownership explícito de TODO id: service role bypassa RLS (spec §5).
  const { data: cliente } = await db.from("clientes")
    .select("id, conta_id, nome, especialidade, include_ai_analysis, foto_url")
    .eq("id", clientId).maybeSingle();
  if (!cliente || cliente.conta_id !== contaId) throw new GenerateError("not_found");

  if (!(await effectivePlanFeature(db, contaId, "feature_analytics_reports"))) {
    throw new GenerateError("feature_disabled");
  }
  // TikTok no relatório só com feature_tiktok (lido uma vez aqui). Desligada, a conta TikTok
  // conta como não conectada: snapshot.tiktok null e tiktok_account_id null. Erro na RPC
  // derruba a geração, como o feature_analytics_reports acima.
  const tiktokEnabled = await effectivePlanFeature(db, contaId, "feature_tiktok");

  // Plataformas pedidas (spec 2026-10-28 §B1): só as conectadas, conferidas pelas linhas de conta
  // antes do snapshot completo (que chama a Graph e baixa thumbnails). A escolha molda só o
  // layout; os dados de toda rede conectada entram no snapshot de qualquer jeito.
  if (platforms) {
    const connectedNow = await connectedPlatforms(db, clientId, tiktokEnabled);
    if (platforms.some((p) => !connectedNow.includes(p))) throw new GenerateError("invalid_platforms");
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
  // Só para log (aviso de teto ao acrescentar seção): nunca dado do cliente.
  let templateRowId: string | null = null;
  if (templateId === "system") {
    // Nada a buscar: templateLayout permanece null e o layout nasce de
    // buildDefaultLayout() abaixo, ignorando o is_default do workspace.
  } else if (templateId) {
    const { data: tpl } = await db.from("report_templates")
      .select("id, conta_id, layout").eq("id", templateId).maybeSingle();
    if (!tpl || tpl.conta_id !== contaId) throw new GenerateError("not_found");
    const check = validateLayout(normalizeCoverSize(tpl.layout));
    if (!check.ok) throw new GenerateError("invalid_template");
    // Defesa no servidor (spec 2026-10-02): modelo nunca carrega imagem; a
    // invariante já vale no banco, isto cobre layout legado/escrito por fora.
    templateLayout = sanitizeLayoutForTemplate(check.layout);
    templateRowId = tpl.id;
  } else {
    const { data: tpl } = await db.from("report_templates")
      .select("id, conta_id, layout").eq("conta_id", contaId)
      .eq("is_default", true).maybeSingle();
    if (tpl) {
      const check = validateLayout(normalizeCoverSize(tpl.layout));
      if (check.ok) {
        // Defesa no servidor (spec 2026-10-02): modelo nunca carrega imagem; a
        // invariante já vale no banco, isto cobre layout legado/escrito por fora.
        templateLayout = sanitizeLayoutForTemplate(check.layout);
        templateRowId = tpl.id;
      }
      else console.warn("[report-docs] template default com layout inválido; usando o padrão do sistema");
    }
  }

  const { snapshot, igAccountId, tiktokAccountId } = await loadClientSnapshot(
    db, deps, contaId,
    { id: cliente.id, especialidade: cliente.especialidade, nome: cliente.nome, foto_url: cliente.foto_url },
    month,
    { tiktokEnabled },
  );

  const connected: ReportPlatform[] = [];
  if (igAccountId) connected.push("instagram");
  if (tiktokAccountId) connected.push("tiktok");
  // A escolha molda o layout (seção por plataforma no padrão; no template, filtro + seção das
  // plataformas que ele não cobre); os dados de toda rede conectada já estão no snapshot.
  const selectedPlatforms: ReportPlatform[] = platforms ?? connected;
  const wantsAi = cliente.include_ai_analysis !== false;

  // Layout montado ANTES da IA: a narrativa cobre as plataformas que o layout final mostra. No
  // padrão do sistema, "Próximos passos" nasce quando a IA vai rodar e sai abaixo se ela não
  // entregar conteúdo (sem título órfão).
  const aiWillRun = wantsAi && !!deps.geminiKey;
  // Só modelo com algum bloco de plataforma ganha a seção que falta: um modelo neutro (capa,
  // resumo, texto, imagem) segue exatamente como antes do TikTok.
  const templateHasPlatformBlocks = !!templateLayout?.blocks.some((b) => blockPlatform(b.type) !== null);
  const filteredTemplate = templateLayout
    ? dropUnselectedPlatformBlocks(templateLayout, selectedPlatforms)
    : null;
  const baseLayout = filteredTemplate
    ? templateHasPlatformBlocks
      ? addMissingPlatformSections(
        filteredTemplate,
        selectedPlatforms,
        { instagram: snapshot.instagram_connected !== false, tiktok: !!snapshot.tiktok },
        {
          hasAudience: snapshot.audience !== null,
          hasBestTimes: snapshot.best_times.length > 0,
          hasTags: snapshot.tags_performance.length > 0,
          hasTikTokBestTimes: (snapshot.tiktok?.best_times.length ?? 0) > 0,
        },
        {
          onCapSkip: (platform) =>
            console.warn(
              `[report-docs] template ${templateRowId} sem espaço para a seção ${platform}; seção não acrescentada`,
            ),
        },
      )
      : filteredTemplate
    : buildDefaultLayout({
      hasAi: aiWillRun,
      hasAudience: snapshot.audience !== null,
      hasBestTimes: snapshot.best_times.length > 0,
      hasTags: snapshot.tags_performance.length > 0,
      platforms: selectedPlatforms,
      hasTikTokBestTimes: (snapshot.tiktok?.best_times.length ?? 0) > 0,
    });
  const narrative = narrativePlatforms(baseLayout, selectedPlatforms);
  const narrativeInstagram = narrative.includes("instagram") && snapshot.instagram_connected !== false;
  const narrativeTiktok = narrative.includes("tiktok") ? snapshot.tiktok?.kpis ?? null : null;

  // IA: nunca derruba a geração (padrão do v2, index.ts:987-1017).
  let aiContent: unknown = null;
  // Sem Instagram no relatório o resumo de fallback fala do TikTok, nunca da raiz Instagram vazia.
  let summaryDoc = textDoc(fallbackSummaryParagraphs(
    snapshot.kpis,
    snapshot.period.label,
    narrativeTiktok ? { instagram: narrativeInstagram, tiktok: narrativeTiktok } : undefined,
  ));
  let recsDoc: unknown | null = null;
  let goalsDoc: unknown | null = null;
  if (aiWillRun) {
    const AI_TIMEOUT_MS = 45_000;
    // Ao vencer o teto de 45s, aborta o fetch do Gemini em voo (achado de
    // review externo: sem isso, o fetch perdedor do race seguia rodando
    // órfão na isolate até a plataforma matá-lo). O signal é opcional em
    // generateAINarrative -- o pipeline legado (instagram-report-generator-v2)
    // não passa nada e continua idêntico.
    const controller = new AbortController();
    // ReturnType<typeof setTimeout>, not `number`: under --node-modules-dir the
    // npm graph's @types/node can win the setTimeout overload (seen in CI).
    let timer: ReturnType<typeof setTimeout> | undefined;
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
      // Visualizações são a métrica-guia do relatório de blocos (pedido
      // 2026-08). O direcionamento só entra quando o dado existe — empurrar a
      // IA para uma métrica ausente convida invenção que a DATA RULE proíbe.
      const guidance = metricPriorityGuidance({
        instagram: narrativeInstagram,
        tiktok: narrativeTiktok !== null,
        instagramHasViews: snapshot.kpis.views?.value != null,
      });
      const promptOpts = guidance ? { extraGuidance: guidance } : undefined;
      const ai = await Promise.race([
        generateAINarrative(
          snapshotToReportData(snapshot, narrative),
          deps.geminiKey,
          controller.signal,
          promptOpts,
        ),
        timeoutPromise,
      ]);
      if (ai.status === "success" && ai.output) {
        // Só TikTok: meta "views" é a do TikTok, então ganha o prefixo antes do rótulo.
        const output = narrativeInstagram ? ai.output : prefixTikTokGoalMetrics(ai.output);
        aiContent = output;
        summaryDoc = aiSummaryDoc(output);
        recsDoc = aiRecommendationsDoc(output);
        goalsDoc = aiGoalsDoc(output);
      } else {
        const reason = "error" in ai ? ai.error : (ai as GenerateResult).status;
        console.warn(`[report-docs] AI falhou: ${reason}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // Sem conteúdo de IA (falha, timeout ou IA desligada), fillAiBlocks remove os blocos de IA; no
  // padrão do sistema o título "Próximos passos" sai junto, para não sobrar órfão. Modelo do
  // workspace mantém os títulos como o usuário salvou.
  const finalBase = !templateLayout && recsDoc === null
    ? {
      ...baseLayout,
      blocks: baseLayout.blocks.filter(
        (b) => !(b.type === "section_header" && b.config?.title === NEXT_STEPS_TITLE),
      ),
    }
    : baseLayout;
  const layout = fillAiBlocks(finalBase, {
    summary: summaryDoc, recommendations: recsDoc, goals: goalsDoc,
  });

  const { data: inserted, error: insertError } = await db.from("report_documents")
    .insert({
      conta_id: contaId,
      client_id: clientId,
      instagram_account_id: igAccountId,
      tiktok_account_id: tiktokAccountId,
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

// supabase/functions/tiktok-analytics/ai.ts
//
// Gemini narrative for TikTok accounts. The prompt skeleton and the response JSON schemas are the
// Instagram ones (instagram-analytics/index.ts), so AISection / AIPortfolioSection render the
// result unchanged; the wording is TikTok's. The TikTok Developers API exposes only views, likes,
// comments, shares, duration, title and posted date, so the prompts speak of engagement per view
// and never of the metrics TikTok does not give us.

import { saoPauloDate } from "../_shared/sao-paulo-date.ts";
import { type FollowerPoint, type TikTokVideoRow, videoEngagementRate } from "../_shared/tiktok-analytics/kpis.ts";
import type { PortfolioRow } from "../_shared/tiktok-analytics/queries.ts";

export interface Prompts {
  system: string;
  user: string;
}

export type AiVideo = TikTokVideoRow & { title: string | null; duration: number | null };

const MAX_PROMPT_VIDEOS = 50;
const MAX_PROMPT_HISTORY = 30;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/** Marker `raw` values the client can show generically; never an upstream message. */
export const AI_UNAVAILABLE = "ai_unavailable";
export const AI_FAILED = "ai_failed";

const pct = (value: number | null): string => (value === null ? "sem dados" : `${value.toFixed(2)}%`);

const spDay = (iso: string | null): string | null => (iso ? saoPauloDate(new Date(iso)) : null);

const MIX_DATA_NOTE =
  "Os únicos dados disponíveis por vídeo são: visualizações, curtidas, comentários, compartilhamentos, duração, título e data de publicação. Baseie TODA a análise nesses dados e não invente nenhum outro número. Tudo que não vier dos dados deve ser tratado como hipótese, não como fato.";

const COMPARISON_REFERENCE = `REFERÊNCIA DE COMPARAÇÃO:
- Não existe benchmark oficial de mercado para engajamento por visualização no TikTok. NUNCA cite faixas de mercado nem afirme que um valor é "bom" ou "ruim" em termos absolutos.
- Compare sempre contra a mediana da própria conta no período (informada nos dados) e, no portfólio, contra a mediana das contas.
- A nota de engajamento deve refletir a posição relativa dos vídeos frente a essa mediana. A de crescimento só pode usar o histórico de seguidores fornecido.`;

const WORST_VIDEOS = 5;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildAccountPrompts(input: {
  username: string;
  clientName: string;
  specialty: string | null;
  days: number;
  followers: number | null;
  history: FollowerPoint[];
  videos: AiVideo[];
}): Prompts {
  const { username, clientName, specialty, days, followers, history, videos } = input;

  const toPromptVideo = (v: AiVideo) => ({
    titulo: (v.title || "").slice(0, 120),
    duracaoSegundos: v.duration,
    visualizacoes: v.views,
    curtidas: v.likes,
    comentarios: v.comments,
    compartilhamentos: v.shares,
    data: spDay(v.posted_at),
    engajamentoPorVisualizacao: pct(videoEngagementRate(v)),
  });
  const byViewsDesc = [...videos].sort((a, b) => (b.views || 0) - (a.views || 0));
  const ranked = byViewsDesc.slice(0, MAX_PROMPT_VIDEOS).map(toPromptVideo);
  // Past the cap the weakest videos would never reach the model, so worstPerformer would be
  // picked from the top of the list; send the lowest few separately.
  const lowest = videos.length > MAX_PROMPT_VIDEOS
    ? byViewsDesc.slice(-WORST_VIDEOS).reverse().map(toPromptVideo)
    : null;
  const rates = videos.map(videoEngagementRate).filter((r): r is number => r !== null);
  const meanRate = rates.length ? rates.reduce((acc, r) => acc + r, 0) / rates.length : null;

  const sum = (key: "views" | "likes" | "comments" | "shares") => videos.reduce((acc, v) => acc + (v[key] || 0), 0);
  const totalViews = sum("views");
  const interactions = sum("likes") + sum("comments") + sum("shares");
  const periodEngagement = totalViews > 0 ? pct((interactions / totalViews) * 100) : "sem dados";

  const trend = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(-MAX_PROMPT_HISTORY);
  const followerHistoryBlock = trend.length >= 2
    ? `Histórico de seguidores (do mais antigo ao mais recente):
${JSON.stringify(trend.map((h) => ({ data: h.date, seguidores: h.follower_count })))}`
    : `Histórico de seguidores: INDISPONÍVEL. Apenas o valor atual é conhecido: ${followers ?? "desconhecido"} seguidores.`;

  const system = `Você é um estrategista sênior de conteúdo para TikTok especializado em profissionais de saúde no Brasil. Seu trabalho é transformar dados em decisões — não em relatórios genéricos.

${MIX_DATA_NOTE}

REGRAS DE ANÁLISE:
1. Nunca diga "poste mais vídeos" ou "seja consistente" — isso é óbvio. Toda recomendação deve ser uma AÇÃO ESPECÍFICA com tema, duração e timing.
2. Quando identificar um vídeo de alto desempenho, explique o MECANISMO por trás (ex: "a pergunta no título puxou comentários porque..."), não apenas "esse vídeo foi bem".
3. Compare métricas entre si, não isoladamente. O engajamento aqui é POR VISUALIZAÇÃO (curtidas + comentários + compartilhamentos, divididos pelas visualizações) e só faz sentido relativo ao número de seguidores e à duração do vídeo.
4. Para a área de saúde, considere: restrições do CFM/CRO sobre publicidade, sazonalidade (Janeiro Branco, Outubro Rosa, etc.), e que o objetivo final quase sempre é agendamento de consulta, não viralizar.

FORMATO DE ESCRITA:
- SEMPRE use bullet points curtos e diretos em vez de parágrafos longos.
- Cada bullet deve ter no máximo 1-2 frases.
- CRÍTICO: Cada bullet point DEVE começar em uma NOVA LINHA com "• ". NUNCA junte múltiplos bullets na mesma linha separados por vírgula ou ponto.
- Priorize dados e ações concretas, elimine preâmbulos e explicações redundantes.
- Exemplo BOM (formato, sem números reais):
"• Vídeos curtos com pergunta no título: engajamento por visualização acima da mediana da conta → replicar formato
• Vídeos educativos geram mais comentários que bastidores
• Melhor horário: dias e faixas com mais visualizações nos dados"
- Exemplo RUIM: "• Vídeos curtos com pergunta no título: engajamento acima da mediana → replicar formato,• Vídeos educativos geram mais comentários,• Melhor horário: dias com mais visualizações"
- NUNCA use ",•" ou ".," para separar bullets. Sempre use quebra de linha ("\\n") antes de cada "•".

${COMPARISON_REFERENCE}
- Visualizações é a métrica principal de distribuição. Compare os vídeos entre si, identifique quais tiveram distribuição acima ou abaixo da média do perfil.

DADOS INCOMPLETOS:
Nem sempre haverá histórico de seguidores. Quando o histórico estiver marcado como INDISPONÍVEL:
- Em growthAnalysis.trajectory: informe que não há dados suficientes para calcular taxa de crescimento. Avalie sinais indiretos (visualizações e curtidas dos vídeos recentes vs mais antigos, tamanho da base).
- Em growthAnalysis.projection: substitua a projeção numérica por uma estimativa qualitativa baseada nos sinais de engajamento disponíveis, deixando explícito que é uma leitura indireta.
- Em healthScore.breakdown.crescimento: atribua null em vez de uma nota inventada, e na justificativa escreva "sem dados de histórico para avaliar".
- NUNCA invente números de crescimento. É melhor dizer que o dado não existe do que fabricar uma tendência.`;

  const user = `Analise a conta @${username} do(a) ${clientName} (${specialty || "especialidade não informada"}).

DADOS DOS ÚLTIMOS ${days} DIAS:

Seguidores atuais: ${followers ?? "desconhecido"}
Total de vídeos no período: ${videos.length}
Visualizações no período: ${totalViews}
Engajamento por visualização no período: ${periodEngagement}
Mediana do engajamento por visualização dos vídeos da conta no período (referência de comparação): ${pct(median(rates))}
Média do engajamento por visualização dos vídeos da conta no período: ${pct(meanRate)}

${followerHistoryBlock}

Vídeos do período (ordenados por visualizações${lowest ? `, os ${MAX_PROMPT_VIDEOS} com mais visualizações` : ""}):
${JSON.stringify(ranked)}
${lowest ? `\nOs ${WORST_VIDEOS} vídeos com MENOS visualizações do período (use estes para o worstPerformer):\n${JSON.stringify(lowest)}\n` : ""}
---

Responda APENAS com um JSON válido, sem markdown, sem comentários, sem texto fora do JSON. Não use aspas simples nem aspas duplas dentro dos valores de texto — use apenas apóstrofos se necessário.

{
  "performanceMap": {
    "topPerformer": "em 3-4 bullets curtos: qual vídeo, métricas-chave, o MECANISMO (hook, duração, tema, horário), e 2 variações concretas para replicar",
    "worstPerformer": "em 3-4 bullets curtos: qual vídeo, o problema principal (duração errada? título fraco? horário?), e como o mesmo tema performaria melhor com outra abordagem",
    "contentMix": "em 2-3 bullets: distribuição atual de durações e temas dos vídeos, o que está sobrando e o que está faltando"
  },
  "captionDiagnostic": "em 3-4 bullets: padrão estrutural dos 3 melhores títulos (ex: hook + promessa + CTA) e um template prático de título no final",
  "growthAnalysis": {
    "trajectory": "em 2-3 bullets: taxa de crescimento real no histórico fornecido, classificação (acelerando/estável/desacelerando/queda). Se histórico INDISPONÍVEL, usar sinais indiretos e deixar explícito",
    "projection": "em 2-3 bullets: projeção 30d e 90d, e se o ritmo for ruim, qual taxa precisa atingir. Se histórico INDISPONÍVEL, estimativa qualitativa"
  },
  "healthScore": {
    "score": 0,
    "breakdown": {
      "engajamento": "nota 0-100 com justificativa de 1 frase comparando o engajamento por visualização dos vídeos com a mediana da própria conta",
      "crescimento": "nota 0-100 com justificativa de 1 frase OU null se histórico indisponível",
      "consistencia": "nota 0-100 baseada em frequência e regularidade de vídeos",
      "mixDeConteudo": "nota 0-100 baseada na diversidade de durações e temas"
    },
    "summary": "1 frase direta sobre a saúde geral da conta"
  },
  "actionPlan": [
    {
      "acao": "descrição específica da ação (ex: Gravar um vídeo de 20s com antes/depois de procedimento X usando o hook Y)",
      "porque": "qual métrica essa ação ataca e qual resultado esperado",
      "prioridade": "alta/media/baixa"
    }
  ]
}

O campo actionPlan deve ter entre 3 e 5 ações. Pelo menos 1 deve ser uma ação que o cliente provavelmente NUNCA tentou (ex: collab com outro profissional, série semanal temática, usar comentários como conteúdo, vídeo respondendo dúvida real de paciente).`;

  return { system, user };
}

export function buildPortfolioPrompts(input: { days: number; accounts: PortfolioRow[] }): Prompts {
  const { days, accounts } = input;

  const accountMedian = median(accounts.map((a) => a.engagement_rate).filter((r): r is number => r !== null));
  const summaries = accounts.map((a) => ({
    name: a.client_name,
    specialty: a.especialidade,
    username: a.username,
    followers: a.follower_count,
    // Observed follower points only; null means there were too few to compute a change.
    followerDelta: a.followers_gained,
    views: a.views,
    videos: a.posts_count,
    engagementPerView: pct(a.engagement_rate),
    // The account's newest video, whatever the window.
    lastVideo: spDay(a.last_posted_at),
  }));

  const system = `Você é um estrategista sênior de conteúdo para TikTok especializado em profissionais de saúde no Brasil. Você gerencia múltiplas contas e seu trabalho é fazer análise comparativa do portfólio — identificando padrões cruzados, oportunidades de aprendizado entre contas, e priorizando onde investir esforço.

${MIX_DATA_NOTE} Por conta você recebe: seguidores, variação de seguidores, visualizações, quantidade de vídeos, engajamento por visualização e a data do último vídeo.

REGRAS DE ANÁLISE:
1. Nunca dê conselhos genéricos como "poste mais" ou "seja consistente". Toda recomendação deve ser uma AÇÃO ESPECÍFICA vinculada a uma conta e uma métrica.
2. Compare contas entre si: quem está crescendo mais rápido, quem tem melhor engajamento por visualização relativo ao tamanho, quem está estagnado.
3. Identifique padrões transferíveis: se uma conta tem engajamento alto com um tipo de vídeo, explique como outra conta do portfólio poderia adaptar isso.
4. Para a área de saúde, considere: restrições do CFM/CRO, sazonalidade, e que o objetivo final é agendamento de consulta.

FORMATO DE ESCRITA:
- SEMPRE use bullet points curtos e diretos em vez de parágrafos longos.
- Cada bullet deve ter no máximo 1-2 frases.
- Priorize dados e ações concretas, elimine preâmbulos e explicações redundantes.

${COMPARISON_REFERENCE}
- Visualizações é a métrica principal de distribuição. Compare as contas entre si e identifique quais tiveram distribuição acima ou abaixo da média do portfólio.

DADOS INCOMPLETOS:
- Se followerDelta for null, não há pontos de histórico suficientes — não assuma estagnação sem outros sinais.
- NUNCA invente números. Se um dado não existe, diga explicitamente.`;

  const user = `Analise o portfólio de ${accounts.length} contas TikTok nos últimos ${days} dias:

Mediana do engajamento por visualização entre as contas (referência de comparação): ${pct(accountMedian)}

${JSON.stringify(summaries, null, 1)}

---

Responda APENAS com um JSON válido, sem markdown, sem comentários. Não use aspas simples nem aspas duplas dentro dos valores de texto.

{
  "portfolioHealth": {
    "score": 0,
    "summary": "1 frase sobre a saúde geral do portfólio"
  },
  "accountRanking": [
    {
      "username": "@conta",
      "status": "destaque/estável/atenção/crítico",
      "keyMetric": "a métrica mais relevante pra essa conta agora e por quê"
    }
  ],
  "crossAccountInsights": "em 3-4 bullets: padrões que funcionam em uma conta e podem ser replicados em outras — cite contas e tipos de vídeo específicos",
  "resourceAllocation": "em 2-3 bullets: onde concentrar esforço esse mês, quais contas precisam de atenção e quais estão no piloto automático",
  "priorityActions": [
    {
      "conta": "@username",
      "acao": "ação específica com tema, duração e timing",
      "impacto": "qual métrica melhora e resultado esperado",
      "prioridade": "alta/media/baixa"
    }
  ],
  "monthlyDigest": "em 3-4 bullets: resumo comparativo do período com dados concretos"
}

O campo priorityActions deve ter entre 3 e 5 ações distribuídas entre as contas. O accountRanking deve listar todas as contas.`;

  return { system, user };
}

/** Same extraction as the Instagram routes: strip fences, else grab the outermost object. */
function parseAnalysis(content: string): unknown {
  try {
    return JSON.parse(content.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
  } catch (_e) {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (_e2) {
      // fall through to the error shape
    }
    return { error: true, raw: content || "Empty AI response" };
  }
}

/** Parsed JSON from Gemini, or `{error:true, raw}`. Upstream failures are logged here and only a
 * fixed marker reaches the caller. */
export async function callGemini(fetchImpl: typeof fetch, key: string, prompts: Prompts): Promise<unknown> {
  try {
    const res = await fetchImpl(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompts.system }] },
        contents: [{ role: "user", parts: [{ text: prompts.user }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: "application/json" },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[tiktok-analytics] gemini error", res.status, data?.error?.message ?? JSON.stringify(data).slice(0, 300));
      return { error: true, raw: AI_FAILED };
    }
    return parseAnalysis(data.candidates?.[0]?.content?.parts?.[0]?.text || "");
  } catch (err) {
    console.error("[tiktok-analytics] gemini request failed", err);
    return { error: true, raw: AI_FAILED };
  }
}

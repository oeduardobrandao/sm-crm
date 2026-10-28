// Parse estrito do clientId de entrada. `Number(...)` sozinho aceita `true`
// (-> 1) e strings tipo "0x10" (-> 16) -- convenção da casa é rejeitar
// coerção e só aceitar um número inteiro positivo real (o que o CRM envia).
export function parseClientId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

// Parse do corpo de POST /generate. `req.json()` aceita qualquer JSON válido
// -- `null`, `5`, `"x"`, um array -- não só objetos. Ler `.clientId` de um
// desses lança TypeError antes de chegar em parseClientId, o que o catch
// externo do index.ts converte num 500 genérico em vez do 400 invalid_body
// pretendido. Este guard centraliza o narrowing para não repetir a checagem
// `typeof body !== "object" || body === null` em cada chamador.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "system" é a sentinela explícita do "Padrão do sistema" no dialog do CRM
// (NewReportDialog.tsx): distinta de ausente/null, que continua significando
// "usa o template is_default do workspace" (outros clientes dependem disso --
// achado de review externo, PR #379). Só o literal exato é aceito; qualquer
// outra string não-uuid rejeita o corpo, igual antes.
const SYSTEM_SENTINEL = "system";

export const REPORT_PLATFORMS = ["instagram", "tiktok"] as const;
export type ReportPlatform = (typeof REPORT_PLATFORMS)[number];

// `platforms` (spec 2026-10-28 §B1): ausente/null = todas as redes conectadas, o que mantém
// automações e chamadores antigos funcionando. Presente, precisa ser uma lista não vazia só com
// plataformas conhecidas; qualquer outra coisa invalida o corpo inteiro (400), como templateId.
// Repetições caem e a ordem do pedido fica (a capa usa a primeira plataforma do layout).
function parsePlatforms(value: unknown): ReportPlatform[] | null | undefined {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: ReportPlatform[] = [];
  for (const p of value) {
    if (!(REPORT_PLATFORMS as readonly unknown[]).includes(p)) return undefined;
    if (!out.includes(p as ReportPlatform)) out.push(p as ReportPlatform);
  }
  return out;
}

export function parseGenerateBody(
  raw: unknown,
): {
  clientId: number;
  month: string;
  templateId: string | null;
  platforms: ReportPlatform[] | null;
} | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { clientId, month, templateId, platforms } = raw as {
    clientId?: unknown;
    month?: unknown;
    templateId?: unknown;
    platforms?: unknown;
  };
  const parsedClientId = parseClientId(clientId);
  if (parsedClientId === null) return null;
  let parsedTemplate: string | null = null;
  if (templateId !== undefined && templateId !== null) {
    if (typeof templateId !== "string") return null;
    if (templateId === SYSTEM_SENTINEL) {
      parsedTemplate = SYSTEM_SENTINEL;
    } else if (UUID_RE.test(templateId)) {
      parsedTemplate = templateId;
    } else {
      return null;
    }
  }
  const parsedPlatforms = parsePlatforms(platforms);
  if (parsedPlatforms === undefined) return null;
  return {
    clientId: parsedClientId,
    month: String(month ?? ""),
    templateId: parsedTemplate,
    platforms: parsedPlatforms,
  };
}

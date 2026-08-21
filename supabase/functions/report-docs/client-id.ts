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
export function parseGenerateBody(raw: unknown): { clientId: number; month: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { clientId, month } = raw as { clientId?: unknown; month?: unknown };
  const parsedClientId = parseClientId(clientId);
  if (parsedClientId === null) return null;
  return { clientId: parsedClientId, month: String(month ?? "") };
}

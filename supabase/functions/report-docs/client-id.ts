// Parse estrito do clientId de entrada. `Number(...)` sozinho aceita `true`
// (-> 1) e strings tipo "0x10" (-> 16) -- convenção da casa é rejeitar
// coerção e só aceitar um número inteiro positivo real (o que o CRM envia).
export function parseClientId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

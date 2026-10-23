// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "./assert.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import {
  CATEGORIAS_FINANCEIRO,
  FINANCEIRO_ERROS,
  mapFinanceiroError,
} from "../mcp/financeiro-errors.ts";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

Deno.test("mcp-financeiro-errors: errors table covers every RAISE", async () => {
  const codes = new Set<string>();
  let files = 0;
  for await (const entry of Deno.readDir(MIGRATIONS)) {
    if (!entry.isFile || !/^(20261027|20261029).*\.sql$/.test(entry.name)) continue;
    files++;
    const sql = await Deno.readTextFile(new URL(entry.name, MIGRATIONS));
    for (const m of sql.matchAll(/RAISE EXCEPTION '([a-z_:0-9]+)'/g)) codes.add(m[1]);
  }
  assert(files > 0, "found the financeiro migrations");
  assert(codes.size > 0, "found RAISE EXCEPTION codes");
  const missing = [...codes].filter((c) => !Object.hasOwn(FINANCEIRO_ERROS, c));
  assertEquals(missing, [], `codes missing from FINANCEIRO_ERROS: ${missing.join(", ")}`);
});

Deno.test("mcp-financeiro-errors: table has the spec codes and the lançamento RPC codes", () => {
  for (
    const key of [
      "feature_disabled:feature_financial",
      "feature_disabled:feature_financeiro_v2",
      "financial_access_denied",
      "owner_only",
      "nao_configurado",
      "not_found",
      "periodo_invalido",
      "periodo_fechado",
      "periodo_estado_invalido",
      "periodo_dia_invalido",
      "funcao_duplicada",
      "acordo_invalido",
      "cliente_encerrado",
      "itens_invalidos",
      "mudancas_invalidas",
      "sem_atribuicao",
      "ja_confirmado",
      "origem_invalida",
      "nao_agendado",
      "valor_indefinido",
    ]
  ) {
    assert(Object.hasOwn(FINANCEIRO_ERROS, key), `has ${key}`);
  }
  for (const [k, v] of Object.entries(FINANCEIRO_ERROS)) {
    assert(!v.includes("—") && !v.includes("–"), `${k}: no dashes in copy`);
    assert(v.trim().length > 0, `${k}: non-empty`);
  }
});

Deno.test("mcp-financeiro-errors: mapFinanceiroError maps a P0001 code, 23514, 23503 and ignores the rest", () => {
  const p = mapFinanceiroError({ message: "periodo_fechado", code: "P0001" });
  assert(p instanceof McpInputError);
  assertEquals(p!.message, FINANCEIRO_ERROS.periodo_fechado);

  const owner = mapFinanceiroError({ message: "owner_only", code: "42501" });
  assertEquals(owner!.message, FINANCEIRO_ERROS.owner_only);
  assertEquals(
    FINANCEIRO_ERROS.owner_only,
    "Permission denied: somente o dono do workspace pode usar as ferramentas do Financeiro.",
  );

  const chk = mapFinanceiroError({ message: 'new row violates check constraint "x_chk"', code: "23514" });
  assertEquals(chk!.message, "Valor fora do permitido.");

  const fk = mapFinanceiroError({ message: "violates foreign key constraint", code: "23503" });
  assertEquals(fk!.message, "Registro relacionado não encontrado.");

  assertEquals(mapFinanceiroError({ message: "boom", code: "XX000" }), null);
  assertEquals(mapFinanceiroError(new Error("boom")), null);
  assertEquals(mapFinanceiroError(null), null);
  assertEquals(mapFinanceiroError("periodo_fechado"), null);
  // Inherited Object keys are not error codes.
  assertEquals(mapFinanceiroError({ message: "constructor" }), null);
  assertEquals(mapFinanceiroError({ message: "toString" }), null);
});

Deno.test("mcp-financeiro-errors: categorias are the CRM list plus the two projection categories", () => {
  assertEquals([...CATEGORIAS_FINANCEIRO], [
    "Mensalidade",
    "Produção",
    "Tráfego",
    "Salário",
    "Imposto",
    "Ferramenta",
    "Outro",
    "Agendamento",
    "Recorrente",
  ]);
});

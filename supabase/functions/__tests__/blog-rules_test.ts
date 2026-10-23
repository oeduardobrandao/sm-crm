// Same fixtures and expected strings as the validateInfograficos cases in
// apps/crm/src/content/__tests__/blog.schema.test.ts: the only check that the
// Deno mirror (zod 3) and the CRM model (zod 4) word every message alike.
import { assertEquals } from "./assert.ts";
import {
  blogImageSchema,
  blogSourceSchema,
  extractInfograficos,
  validateInfograficos,
} from "../_shared/blog-rules.ts";

function fence(value: unknown): string {
  return "```infografico\n" + (typeof value === "string" ? value : JSON.stringify(value)) +
    "\n```";
}

const BARRAS = {
  tipo: "barras",
  titulo: "Alcance por formato",
  fonte: 1,
  itens: [
    { rotulo: "Reels", valor: 42, exibicao: "42%" },
    { rotulo: "Carrossel", valor: 30 },
  ],
};

Deno.test("blog-rules: valid barras, numeros and etapas pass", () => {
  assertEquals(validateInfograficos(fence(BARRAS), 2), []);
  const numeros = {
    tipo: "numeros",
    titulo: "Em números",
    fonte: 0,
    itens: [
      { valor: "2 bi", legenda: "usuários ativos" },
      { valor: "38%", legenda: "do tempo em Reels" },
    ],
  };
  const etapas = {
    tipo: "etapas",
    titulo: "Como aprovar",
    itens: [{ rotulo: "Envie o link" }, { rotulo: "Cliente revisa" }, { rotulo: "Aprovado" }],
  };
  assertEquals(validateInfograficos(`${fence(numeros)}\n\n${fence(etapas)}`, 1), []);
});

Deno.test("blog-rules: fonte out of range", () => {
  assertEquals(validateInfograficos(fence({ ...BARRAS, fonte: 3 }), 2), [
    "infografico[0].fonte: índice 3 fora de sources (0..1)",
  ]);
  assertEquals(validateInfograficos(`${fence(BARRAS)}\n\n${fence({ ...BARRAS, fonte: 3 })}`, 2), [
    "infografico[1].fonte: índice 3 fora de sources (0..1)",
  ]);
  assertEquals(validateInfograficos(fence({ ...BARRAS, fonte: 0 }), 0), [
    "infografico[0].fonte: índice 0 fora de sources (nenhuma fonte)",
  ]);
});

Deno.test("blog-rules: shape errors use the CRM's wording", () => {
  assertEquals(validateInfograficos(fence({ ...BARRAS, itens: [] }), 2), [
    "infografico[0].itens: mínimo de 2 itens",
  ]);
  const textValor = { ...BARRAS, itens: [{ rotulo: "Reels", valor: "dez" }, BARRAS.itens[1]] };
  assertEquals(validateInfograficos(fence(textValor), 2), [
    "infografico[0].itens[0].valor: deve ser número",
  ]);
  assertEquals(validateInfograficos(fence('{"tipo": "barras",'), 2), [
    "infografico[0]: JSON inválido",
  ]);
  assertEquals(validateInfograficos(fence({ ...BARRAS, tipo: "pizza" }), 2), [
    "infografico[0].tipo: deve ser barras, numeros ou etapas",
  ]);
  assertEquals(
    validateInfograficos(fence({ ...BARRAS, titulo: "x".repeat(91), cor: "azul" }), 2).sort(),
    ["infografico[0].titulo: máximo de 90 caracteres", "infografico[0]: chave desconhecida: cor"],
  );
  assertEquals(validateInfograficos(fence({ ...BARRAS, fonte: 0.5 }), 2), [
    "infografico[0].fonte: deve ser número inteiro",
  ]);
});

Deno.test("blog-rules: unclosed and foreign fences are ignored", () => {
  assertEquals(extractInfograficos('```infografico\n{"tipo": "etapas"}\n'), []);
  assertEquals(extractInfograficos("```json\n{}\n```"), []);
});

Deno.test("blog-rules: source and image schemas reject non-http URLs and empty credit", () => {
  const source = { title: "Anúncio", publisher: "Meta", url: "https://about.fb.com/x" };
  assertEquals(blogSourceSchema.safeParse(source).success, true);
  assertEquals(blogSourceSchema.safeParse({ ...source, url: "ftp://x.com/a" }).success, false);
  const image = {
    key: "grafico-1",
    url: "https://cdn.example.com/g.jpg",
    alt: "Gráfico",
    credit: "Meta",
    license: "Uso editorial",
    source_url: "https://about.fb.com/news",
  };
  assertEquals(blogImageSchema.safeParse(image).success, true);
  assertEquals(blogImageSchema.safeParse({ ...image, credit: "" }).success, false);
});

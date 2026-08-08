import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = path.join(
  process.cwd(),
  'supabase/migrations/20260806000003_kb_primeiro_post_guide.sql',
);

function migrationSource(): string {
  return readFileSync(MIGRATION, 'utf-8');
}

/** Walks from `i` to the delimiter that closes the one already opened, ignoring
 *  anything inside SQL string literals (where '' is an escaped quote). */
function walk(src: string, i: number, open: string, close: string): number {
  let depth = 1;
  let inString = false;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === "'") {
      if (inString && src[i + 1] === "'") i++;
      else inString = !inString;
    } else if (!inString) {
      if (c === open) depth++;
      else if (c === close) depth--;
    }
    i++;
  }
  return i - 1;
}

/** _kb_pp_ol call sites, excluding its CREATE and DROP. */
function countCalls(src: string): number {
  return [...src.matchAll(/_kb_pp_ol\(/g)].filter((m) => {
    const before = src.slice(Math.max(0, m.index! - 60), m.index!);
    return !/CREATE OR REPLACE FUNCTION\s*$|DROP FUNCTION IF EXISTS\s*$/.test(before);
  }).length;
}

/** For each _kb_pp_ol call, the text immediately after its SECOND array literal
 *  (the images one) plus the line it ends on. Independent of formatting. */
function imageArrayLiterals(src: string): { after: string; line: number }[] {
  const out: { after: string; line: number }[] = [];
  for (const m of src.matchAll(/_kb_pp_ol\(/g)) {
    const before = src.slice(Math.max(0, m.index! - 60), m.index!);
    if (/CREATE OR REPLACE FUNCTION\s*$|DROP FUNCTION IF EXISTS\s*$/.test(before)) continue;
    const callEnd = walk(src, m.index! + m[0].length, '(', ')');
    const call = src.slice(m.index! + m[0].length, callEnd);
    const firstOpen = call.indexOf('ARRAY[');
    if (firstOpen === -1) continue;
    const firstClose = walk(call, firstOpen + 'ARRAY['.length, '[', ']');
    const secondOpen = call.indexOf('ARRAY[', firstClose);
    if (secondOpen === -1) continue;
    const secondClose = walk(call, secondOpen + 'ARRAY['.length, '[', ']');
    const absolute = m.index! + m[0].length + secondClose;
    out.push({
      after: src.slice(absolute + 1, absolute + 20),
      line: src.slice(0, absolute).split('\n').length,
    });
  }
  return out;
}

describe('artigo "Como agendar seu primeiro post"', () => {
  it('nunca preenche r2Key numa imagem do corpo', () => {
    // Um r2Key não nulo faz ArtigoPage pedir assinatura a sign-r2-urls, que
    // só assina chaves da própria conta do leitor ou capas de artigo. Uma
    // imagem de corpo não é nenhum dos dois: a assinatura falha em silêncio e
    // o src pré-assinado da autoria expira em 3600s. Passa no smoke test da
    // autoria e quebra no dia seguinte.
    // Capture the value that follows every 'r2Key', and assert each is NULL.
    // Do NOT write this as /'r2Key',\s*(?!NULL)/ -- `\s*` backtracks to zero
    // width, the lookahead then tests the position right after the comma
    // (where a space, not "NULL", sits), succeeds, and the test fails against
    // correct code.
    const src = migrationSource();
    const r2KeyValues = [...src.matchAll(/'r2Key',\s*([A-Za-z0-9_']+)/g)].map((m) => m[1]);
    expect(r2KeyValues.length).toBeGreaterThan(0);
    for (const value of r2KeyValues) {
      expect(value).toBe('NULL');
    }
  });

  it('aponta as imagens para o bucket público permanente', () => {
    const src = migrationSource();
    const urls = src.match(/https:\/\/[^']*kb-images[^']*/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toContain('/storage/v1/object/public/kb-images/');
      expect(url).toContain('como-agendar-seu-primeiro-post/');
    }
  });

  it('sempre converte o array de imagens para jsonb[]', () => {
    // Postgres infere o tipo de um ARRAY[...] pelos elementos. Um array de
    // imagens onde TODOS os passos são NULL, como o da seção 7 enquanto as
    // capturas não existem, não tem de onde inferir e vira text[]. A chamada
    // então não casa com _kb_pp_ol(text[], jsonb[]) e a migration morre com
    //   42883: function _kb_pp_ol(text[], text[]) does not exist
    // Isso aconteceu de verdade, ao rodar a migration pela primeira vez, e os
    // outros testes deste arquivo não pegaram: eles leem o SQL como texto e
    // nunca o executam. O cast explícito remove a inferência da equação, então
    // a composição de NULLs do array deixa de importar.
    // Parsed structurally, NOT with a line-anchored regex. The first version of
    // this test matched `\n\s*\]` and so only saw arrays whose closing bracket
    // started a line. The "E agora?" section writes its array on one line, and
    // the test skipped it silently: 8 call sites, 8 casts, 7 checked. It was
    // green for the wrong reason, and the next single-line all-NULL array would
    // have walked straight past it into the same 42883 failure.
    const src = migrationSource();
    const callSites = countCalls(src);
    const arrays = imageArrayLiterals(src);
    // Every call site must be accounted for, so a parse miss cannot hide as a
    // smaller-but-passing set.
    expect(arrays.length).toBe(callSites);
    expect(callSites).toBeGreaterThan(0);
    for (const { after, line } of arrays) {
      expect(after.startsWith('::jsonb[]'), `array de imagens sem cast na linha ${line}`).toBe(
        true,
      );
    }
  });

  it('não usa travessão na copy do artigo', () => {
    // Regra de estilo da casa para texto voltado ao usuário. Este artigo é o
    // texto mais visível do repositório: vai para a Central de Ajuda de todos
    // os clientes.
    expect(migrationSource()).not.toContain('—');
  });
});

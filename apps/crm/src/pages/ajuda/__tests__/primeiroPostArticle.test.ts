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

  it('não usa travessão na copy do artigo', () => {
    // Regra de estilo da casa para texto voltado ao usuário. Este artigo é o
    // texto mais visível do repositório: vai para a Central de Ajuda de todos
    // os clientes.
    expect(migrationSource()).not.toContain('—');
  });
});

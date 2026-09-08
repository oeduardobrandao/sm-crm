import { describe, expect, it } from 'vitest';
import {
  isAllowedRichTextLinkUrl,
  isAllowedRichTextAutolinkUrl,
  normalizeRichTextLinkUrl,
} from './index';

// Unit coverage for the policy itself (see index.ts for the full rationale). The
// integration-level assertions -- that this function is actually WIRED into both the
// Hub's reader (RichTextContent.tsx) and the CRM's page editor (pageEditorSchema.ts) --
// live in apps/hub/src/components/__tests__/RichTextContent.test.tsx and
// apps/crm/src/pages/cliente-detalhe/hub/__tests__/PaginaRichTextEditor.test.tsx.
describe('isAllowedRichTextLinkUrl', () => {
  it.each([
    'http://exemplo.com',
    'https://exemplo.com/pagina?x=1#y',
    'HTTPS://Exemplo.COM',
    'https:exemplo.com', // no `//` -- still a valid, credential-free https URL
    'mailto:contato@exemplo.com',
    'tel:+5511999999999',
    'TEL:123',
  ])('permite %s', (url) => {
    expect(isAllowedRichTextLinkUrl(url)).toBe(true);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['ftp://exemplo.com/arquivo'],
    ['ftps://exemplo.com/arquivo'],
    ['https://user:pass@exemplo.com'],
    ['http://user:pass@exemplo.com/path'],
    ['/pagina-interna'],
    ['./relativo'],
    ['../relativo'],
    ['#ancora'],
    ['//evil.com'], // protocol-relative
    ['mailto:'], // scheme with nothing after it
    ['tel:'],
    ['https:'],
    ['ja\tvascript:alert(1)'], // classic tab-smuggle bypass
  ])('recusa %s', (url) => {
    expect(isAllowedRichTextLinkUrl(url as string | null | undefined)).toBe(false);
  });

  it('tolera espaço nas pontas sem tratar como esquema ausente', () => {
    expect(isAllowedRichTextLinkUrl('  https://exemplo.com  ')).toBe(true);
  });

  it('um caractere de controle depois do esquema ainda resolve para a URL de verdade', () => {
    // `new URL` faz o strip de tab/CR/LF do WHATWG antes de resolver host/protocolo --
    // isto não é um bypass (o resultado é um http comum, já permitido de qualquer jeito),
    // só confirma que o parsing não quebra nem deixa a credencial escapar da checagem.
    expect(isAllowedRichTextLinkUrl('http:\t//evil.com')).toBe(true);
  });
});

// Unit coverage for the autolink-aware wrapper (Finding 1, task-11 fix round 3). The
// integration-level assertions -- that autolink actually produces a link while TYPING,
// not just that this function returns true in isolation -- live in
// PaginaRichTextEditor.test.tsx and postEditorAutolink.test.ts: that distinction is
// exactly what let the previous round's regression (isAllowedRichTextLinkUrl wired
// straight into `isAllowedUri` on an `autolink: true` extension) slip through.
describe('isAllowedRichTextAutolinkUrl', () => {
  it.each([
    'contato@exemplo.com',
    'contato+tag@exemplo.com.br',
    'www.exemplo.com',
    'exemplo.com',
    'exemplo.com/pagina?x=1',
  ])('permite o candidato sem esquema %s (resolve para mailto:/http: antes de testar)', (url) => {
    expect(isAllowedRichTextAutolinkUrl(url)).toBe(true);
  });

  it.each(['https://exemplo.com', 'mailto:contato@exemplo.com', 'tel:+5511999999999'])(
    'permite um candidato que já tem esquema %s, testado como está',
    (url) => {
      expect(isAllowedRichTextAutolinkUrl(url)).toBe(true);
    },
  );

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['/pagina-interna'],
    ['#ancora'],
    ['./relativo'],
    ['../relativo'],
    ['//evil.com'],
    ['palavra-sem-ponto'],
    ['javascript:alert(1)'],
    ['ftp://exemplo.com/arquivo'],
    ['https://user:pass@exemplo.com'],
  ])('recusa %s', (url) => {
    expect(isAllowedRichTextAutolinkUrl(url as string | null | undefined)).toBe(false);
  });

  it('usa o defaultProtocol do contexto do TipTap ao resolver um domínio nu', () => {
    expect(isAllowedRichTextAutolinkUrl('exemplo.com', { defaultProtocol: 'https' })).toBe(true);
  });

  it('cai para http quando o contexto não vem (mesmo default do TipTap)', () => {
    expect(isAllowedRichTextAutolinkUrl('exemplo.com')).toBe(true);
  });
});

// Unit coverage for the imperative-apply normalizer (Finding, task-11 fix round 4).
// isAllowedRichTextAutolinkUrl (above) makes `isAllowedUri` say "yes" to a schemeless
// candidate by resolving it ONLY for the purposes of that yes/no check -- it never
// changes what gets stored. A toolbar's `setLink({ href: 'exemplo.com' })` sails past
// that check and then persists the raw, unresolved "exemplo.com" as the mark's href,
// which is exactly the dead-link shape (`href=""`) the whole policy exists to prevent.
// `normalizeRichTextLinkUrl` is what a caller must run FIRST and use the return value
// of, instead of the raw typed value, when calling `setLink`/`toggleLink` -- see
// PaginaRichTextEditor.tsx and PostEditor.tsx for the wiring; the integration-level
// assertion that the ANCHOR ELEMENT ends up with the resolved href (not just that this
// function returns the right string in isolation) lives in those components' own tests.
describe('normalizeRichTextLinkUrl', () => {
  it.each([
    ['mesaas.com.br', 'https://mesaas.com.br'],
    ['www.exemplo.com', 'https://www.exemplo.com'],
    ['exemplo.com/pagina', 'https://exemplo.com/pagina'],
    ['contato@exemplo.com', 'mailto:contato@exemplo.com'],
    ['https://exemplo.com', 'https://exemplo.com'],
    ['mailto:contato@exemplo.com', 'mailto:contato@exemplo.com'],
    ['tel:+5511999999999', 'tel:+5511999999999'],
  ])('resolve %s para %s', (input, expected) => {
    expect(normalizeRichTextLinkUrl(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['ftp://exemplo.com/arquivo'],
    ['https://user:pass@exemplo.com'],
    ['/pagina-interna'],
    ['#ancora'],
    ['./relativo'],
    ['palavra-sem-ponto'],
  ])('recusa %s (não há href para aplicar)', (url) => {
    expect(normalizeRichTextLinkUrl(url as string | null | undefined)).toBeNull();
  });
});

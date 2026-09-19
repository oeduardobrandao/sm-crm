# Links úteis do cliente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seção "Links úteis" na aba "Visão geral" do cliente, onde o usuário salva links (Drive, Notion, Figma...) com título, URL e descrição opcional.

**Architecture:** Nova tabela `cliente_links` com RLS no padrão de `cliente_enderecos`, quatro funções CRUD em `store/clients.ts`, e um componente `ClienteLinksSection` com query própria (`['clienteLinks', clienteId]`) renderizado em `VisaoGeralTab` entre o card de informações e "Datas importantes".

**Tech Stack:** Supabase Postgres (RLS), React 19, TanStack Query, react-hook-form + zod, shadcn Dialog/AlertDialog, sonner, i18next, Vitest + Testing Library, psql.

## Global Constraints

Spec: `docs/superpowers/specs/2026-09-19-cliente-links-uteis-design.md`.

- Ordem em `VisaoGeralTab`: card de informações, **Links úteis**, Datas importantes, Endereços.
- Tabela `public.cliente_links`: `titulo` 1 a 120 caracteres, `url` só http(s) até 2048, `descricao` opcional até 300.
- INSERT/UPDATE exigem que `cliente_id` pertença ao mesmo `conta_id` da linha (anti-corrupção da `20260728000004`).
- URL sem protocolo ganha `https://` antes de validar; só http/https.
- Links renderizados com `sanitizeUrl()`, `target="_blank"`, `rel="noopener noreferrer"`.
- Toasts via `toast()` de `sonner`. Ícones só `lucide-react`. Sem travessão nos textos ao usuário.
- Textos em `packages/i18n/locales/{pt,en}/clients.json`, dentro de `detail`.
- Migration com versão única acima da cauda de `main` (`20260925000015`).
- Sem gate de permissão próprio (herda `clientes:ver` da rota).

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260925000016_cliente_links.sql` (novo) | Tabela, índices, RLS, grants |
| `supabase/tests/entitlements/98_cliente_links_rls.sql` (novo) | Isolamento entre workspaces |
| `apps/crm/src/store/clients.ts` (editar) | `ClienteLink` + CRUD |
| `apps/crm/src/pages/cliente-detalhe/linkUrl.ts` (novo) | `normalizeLinkUrl`, `linkDomain` (puros) |
| `apps/crm/src/pages/cliente-detalhe/__tests__/linkUrl.test.ts` (novo) | Testes dos helpers |
| `packages/i18n/locales/{pt,en}/clients.json` (editar) | Textos |
| `apps/crm/src/pages/cliente-detalhe/components/ClienteLinksSection.tsx` (novo) | UI da seção |
| `apps/crm/src/pages/cliente-detalhe/components/__tests__/ClienteLinksSection.test.tsx` (novo) | Testes da seção |
| `apps/crm/src/pages/cliente-detalhe/tabs/VisaoGeralTab.tsx` (editar) | Renderiza a seção |
| `apps/crm/src/pages/cliente-detalhe/tabs/__tests__/VisaoGeralTab.test.tsx` (editar) | Ajusta mocks e chaves de query |

`store/index.ts` já faz `export * from './clients'`, então nada a exportar.

---

### Task 1: Tabela `cliente_links` e teste de RLS

**Files:**
- Create: `supabase/migrations/20260925000016_cliente_links.sql`
- Create: `supabase/tests/entitlements/98_cliente_links_rls.sql`

**Interfaces:**
- Produces: tabela `public.cliente_links(id bigint, cliente_id bigint, conta_id uuid, titulo text, url text, descricao text null, created_at timestamptz, updated_at timestamptz)`.

- [ ] **Step 1: Confirmar que a versão da migration está livre**

Run: `git fetch -q origin main && git ls-tree --name-only origin/main supabase/migrations/ | tail -3`
Expected: última versão é `20260925000015_...`. Se houver versão maior, renomeie o arquivo abaixo para uma versão acima dela.

- [ ] **Step 2: Escrever o teste de RLS (vai falhar sem a tabela)**

Create `supabase/tests/entitlements/98_cliente_links_rls.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Isolamento por workspace de cliente_links, no padrão de
-- 40_cliente_tables_tenant_isolation. O teste PRECISA assumir a role
-- `authenticated` (o dono da tabela ignora RLS).

begin;
select et_grant_hosted_parity();

do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_user uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_seen bigint;
  v_rows bigint;
  v_rejected boolean;
begin
  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('start');

  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_user, v_ws_a, 'owner'), (v_user, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  insert into cliente_links (cliente_id, conta_id, titulo, url)
    values (v_cli_a, v_ws_a, 'A-link', 'https://a.example.com'),
           (v_cli_b, v_ws_b, 'B-CONFIDENTIAL', 'https://b.example.com');

  -- Constraints de formato (como dono da tabela, antes de trocar de role).
  v_rejected := false;
  begin
    insert into cliente_links (cliente_id, conta_id, titulo, url)
      values (v_cli_a, v_ws_a, 'js', 'javascript:alert(1)');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'cliente_links: url nao-http(s) foi aceita';

  v_rejected := false;
  begin
    insert into cliente_links (cliente_id, conta_id, titulo, url)
      values (v_cli_a, v_ws_a, '   ', 'https://a.example.com');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'cliente_links: titulo em branco foi aceito';

  -- ---- agir como o usuario: membro dos DOIS workspaces, ATIVO = A ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_seen from cliente_links;
  assert v_seen = 1, format('cliente_links: esperava 1 linha visivel, veio %s', v_seen);
  select count(*) into v_seen from cliente_links where titulo = 'B-CONFIDENTIAL';
  assert v_seen = 0, 'cliente_links: linha de outro workspace visivel';

  -- RLS nega por filtragem, entao assertar linhas afetadas.
  update cliente_links set titulo = 'HACKED' where conta_id = v_ws_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('cliente_links: atualizou %s linha(s) de outro workspace', v_rows);

  delete from cliente_links where conta_id = v_ws_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('cliente_links: removeu %s linha(s) de outro workspace', v_rows);

  -- Escritas no proprio workspace continuam funcionando.
  update cliente_links set titulo = 'A-renamed' where conta_id = v_ws_a;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, format('cliente_links: update proprio afetou %s linhas', v_rows);

  insert into cliente_links (cliente_id, conta_id, titulo, url, descricao)
    values (v_cli_a, v_ws_a, 'A-new', 'https://a2.example.com', 'desc');

  -- cliente_id de outro workspace com conta_id proprio: rejeitado.
  v_rejected := false;
  begin
    insert into cliente_links (cliente_id, conta_id, titulo, url)
      values (v_cli_b, v_ws_a, 'cross', 'https://x.example.com');
  exception when others then v_rejected := true; end;
  assert v_rejected, 'cliente_links: insert com cliente_id de outro workspace NAO foi rejeitado';

  -- Re-apontar cliente_id via UPDATE: rejeitado.
  v_rejected := false;
  begin
    update cliente_links set cliente_id = v_cli_b
     where conta_id = v_ws_a and titulo = 'A-renamed';
  exception when others then v_rejected := true; end;
  assert v_rejected, 'cliente_links: update re-apontando cliente_id NAO foi rejeitado';

  -- anon nao pode ler nada. Localmente o helper de paridade devolve ALL a anon
  -- (a RLS sem politica para anon filtra tudo); no hosted o REVOKE da migration
  -- vale (permission denied). Os dois desfechos sao aceitos, uma linha visivel nao.
  execute 'reset role';
  execute 'set local role anon';
  begin
    select count(*) into v_seen from cliente_links;
  exception when insufficient_privilege then
    v_seen := 0;
  end;
  assert v_seen = 0, 'cliente_links: anon consegue ler linhas';
  execute 'reset role';

  select count(*) into v_seen from cliente_links
   where conta_id = v_ws_b and titulo = 'B-CONFIDENTIAL';
  assert v_seen = 1, 'linha de outro workspace foi alterada ou removida';

  raise notice 'PASS 98_cliente_links_rls';
end $$;
rollback;
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run (com Supabase local de pé, ver memória `reference_local_supabase_colima`):
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/98_cliente_links_rls.sql
```
Expected: FAIL com `relation "cliente_links" does not exist`. Se não houver Docker/colima local, registre "não rodado localmente, coberto pelo CI (`entitlement-tests`)" e siga.

- [ ] **Step 4: Escrever a migration**

Create `supabase/migrations/20260925000016_cliente_links.sql`:

```sql
-- =============================================================
-- Links úteis do cliente (Drive, Notion, Figma...)
-- Spec: docs/superpowers/specs/2026-09-19-cliente-links-uteis-design.md
--
-- Mesmo modelo de cliente_enderecos: RLS pelo workspace ATIVO e, em
-- INSERT/UPDATE, cliente_id precisa pertencer ao mesmo conta_id da linha
-- (ver 20260728000004). O EXISTS qualifica cliente_links.conta_id de
-- proposito: um conta_id sem qualificacao resolveria para o proprio
-- `clientes c` e viraria tautologia.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.cliente_links (
  id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  cliente_id  bigint NOT NULL REFERENCES public.clientes(id)   ON DELETE CASCADE,
  conta_id    uuid   NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  titulo      text   NOT NULL,
  url         text   NOT NULL,
  descricao   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cliente_links_titulo_check
    CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 120),
  CONSTRAINT cliente_links_url_check
    CHECK (char_length(url) <= 2048 AND url ~* '^https?://[^[:space:]]+$'),
  CONSTRAINT cliente_links_descricao_check
    CHECK (descricao IS NULL OR char_length(descricao) <= 300)
);

CREATE INDEX IF NOT EXISTS idx_cliente_links_cliente_id
  ON public.cliente_links USING btree (cliente_id);
CREATE INDEX IF NOT EXISTS idx_cliente_links_conta_id
  ON public.cliente_links USING btree (conta_id);

ALTER TABLE public.cliente_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cliente_links FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cliente_links TO authenticated;
GRANT ALL ON TABLE public.cliente_links TO service_role;

DO $$
DECLARE
  predicate constant text :=
    'conta_id IN (SELECT workspace_id FROM public.workspace_members '
    '             WHERE user_id = auth.uid()) '
    'AND conta_id IN (SELECT public.get_my_conta_id())';
  check_predicate constant text := predicate ||
    ' AND EXISTS (SELECT 1 FROM public.clientes c '
    '             WHERE c.id = cliente_links.cliente_id '
    '               AND c.conta_id = cliente_links.conta_id)';
BEGIN
  EXECUTE format('CREATE POLICY workspace_select_links ON public.cliente_links '
                 'FOR SELECT TO authenticated USING (%s)', predicate);
  EXECUTE format('CREATE POLICY workspace_insert_links ON public.cliente_links '
                 'FOR INSERT TO authenticated WITH CHECK (%s)', check_predicate);
  EXECUTE format('CREATE POLICY workspace_update_links ON public.cliente_links '
                 'FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                 predicate, check_predicate);
  EXECUTE format('CREATE POLICY workspace_delete_links ON public.cliente_links '
                 'FOR DELETE TO authenticated USING (%s)', predicate);
END $$;

-- Pos-condicao: as quatro politicas existem e as de escrita carregam o
-- conjunto anti-corrupcao (perde-lo e a regressao que isto previne).
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cliente_links';
  IF n <> 4 THEN
    RAISE EXCEPTION 'cliente_links: esperava 4 politicas, achei %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cliente_links'
     AND cmd IN ('INSERT', 'UPDATE')
     AND coalesce(with_check, '') LIKE '%clientes%';
  IF n <> 2 THEN
    RAISE EXCEPTION 'cliente_links: WITH CHECK de INSERT/UPDATE sem a checagem de clientes';
  END IF;
END $$;
```

- [ ] **Step 5: Aplicar a migration localmente e rodar o teste**

Run: `npx supabase db reset` (ou `npx supabase migration up --local` se já estiver de pé), depois o `psql -f` do Step 3.
Expected: `NOTICE:  PASS 98_cliente_links_rls`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260925000016_cliente_links.sql supabase/tests/entitlements/98_cliente_links_rls.sql
git commit -m "feat(db): cliente_links table with workspace-scoped RLS" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Helpers de URL e funções de store

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/linkUrl.ts`
- Create: `apps/crm/src/pages/cliente-detalhe/__tests__/linkUrl.test.ts`
- Modify: `apps/crm/src/store/clients.ts` (interface junto de `ClienteEndereco`; CRUD logo depois de `removeClienteEndereco`, antes do bloco de datas)

**Interfaces:**
- Produces:
  - `normalizeLinkUrl(raw: string): string | null` (null quando inválida)
  - `linkDomain(url: string): string`
  - `interface ClienteLink { id?: number; cliente_id: number; conta_id?: string; titulo: string; url: string; descricao?: string | null; created_at?: string; updated_at?: string }`
  - `getClienteLinks(clienteId: number): Promise<ClienteLink[]>`
  - `addClienteLink(l: Omit<ClienteLink, 'id' | 'conta_id' | 'created_at' | 'updated_at'>): Promise<ClienteLink>`
  - `updateClienteLink(id: number, l: Partial<Omit<ClienteLink, 'id' | 'conta_id' | 'created_at' | 'updated_at'>>): Promise<ClienteLink>`
  - `removeClienteLink(id: number): Promise<void>`

- [ ] **Step 1: Escrever o teste dos helpers**

Create `apps/crm/src/pages/cliente-detalhe/__tests__/linkUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeLinkUrl, linkDomain } from '../linkUrl';

describe('normalizeLinkUrl', () => {
  it('keeps a valid https url as typed', () => {
    expect(normalizeLinkUrl('https://drive.google.com/drive/folders/abc')).toBe(
      'https://drive.google.com/drive/folders/abc',
    );
  });

  it('keeps http', () => {
    expect(normalizeLinkUrl('http://exemplo.com.br')).toBe('http://exemplo.com.br');
  });

  it('prepends https:// when there is no scheme', () => {
    expect(normalizeLinkUrl('drive.google.com/x')).toBe('https://drive.google.com/x');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeLinkUrl('  notion.so/aurora  ')).toBe('https://notion.so/aurora');
  });

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'ftp://exemplo.com',
    '//exemplo.com',
    'https://user:pass@exemplo.com',
    'localhost',
    'não é url',
    'https://exemplo.com/a b',
  ])('rejects %j', (raw) => {
    expect(normalizeLinkUrl(raw)).toBeNull();
  });
});

describe('linkDomain', () => {
  it('returns the hostname without www', () => {
    expect(linkDomain('https://www.figma.com/file/1')).toBe('figma.com');
  });

  it('falls back to the raw value when it is not parseable', () => {
    expect(linkDomain('???')).toBe('???');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/linkUrl.test.ts`
Expected: FAIL (`Failed to resolve import "../linkUrl"`).

- [ ] **Step 3: Implementar os helpers**

Create `apps/crm/src/pages/cliente-detalhe/linkUrl.ts`:

```ts
/**
 * Normaliza a URL digitada num link útil. Devolve a string a salvar, ou null
 * quando não dá para aceitar. Só http/https, sem credenciais embutidas, sem
 * espaços, com host contendo ponto. URL sem protocolo ganha `https://`.
 * Mantém o texto como digitado (não reserializa) para o usuário reconhecer o
 * que salvou.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.startsWith('//')) return null;
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (!parsed.hostname.includes('.')) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** Host sem `www.`, para exibir sob o título do link. */
export function linkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/linkUrl.test.ts`
Expected: PASS. Se algum caso falhar, corrija o helper (não o teste).

- [ ] **Step 5: Adicionar tipo e CRUD ao store**

Em `apps/crm/src/store/clients.ts`, logo depois da interface `ClienteEndereco`, adicionar:

```ts
export interface ClienteLink {
  id?: number;
  cliente_id: number;
  conta_id?: string;
  titulo: string;
  url: string;
  descricao?: string | null;
  created_at?: string;
  updated_at?: string;
}
```

E, imediatamente depois de `removeClienteEndereco` (e antes do bloco `CLIENTE DATAS`), adicionar:

```ts
// =============================================
// CLIENTE LINKS CRUD
// =============================================

export async function getClienteLinks(clienteId: number): Promise<ClienteLink[]> {
  const { data, error } = await supabase
    .from('cliente_links')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addClienteLink(
  l: Omit<ClienteLink, 'id' | 'conta_id' | 'created_at' | 'updated_at'>,
): Promise<ClienteLink> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('cliente_links')
    .insert({ ...l, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateClienteLink(
  id: number,
  l: Partial<Omit<ClienteLink, 'id' | 'conta_id' | 'created_at' | 'updated_at'>>,
): Promise<ClienteLink> {
  const { data, error } = await supabase
    .from('cliente_links')
    .update({ ...l, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeClienteLink(id: number): Promise<void> {
  const { error } = await supabase.from('cliente_links').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 6: Typecheck do CRM**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/linkUrl.ts apps/crm/src/pages/cliente-detalhe/__tests__/linkUrl.test.ts apps/crm/src/store/clients.ts
git commit -m "feat(crm): cliente links store functions and URL helpers" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Textos (i18n) e seção `ClienteLinksSection`

**Files:**
- Modify: `packages/i18n/locales/pt/clients.json` (dentro de `detail`, logo depois de `"removeDateConfirm"`)
- Modify: `packages/i18n/locales/en/clients.json` (mesmo ponto)
- Create: `apps/crm/src/pages/cliente-detalhe/components/ClienteLinksSection.tsx`
- Create: `apps/crm/src/pages/cliente-detalhe/components/__tests__/ClienteLinksSection.test.tsx`

**Interfaces:**
- Consumes: `ClienteLink`, `getClienteLinks`, `addClienteLink`, `updateClienteLink`, `removeClienteLink` de `@/store`; `normalizeLinkUrl`, `linkDomain` de `../linkUrl`.
- Produces: `export function ClienteLinksSection({ clienteId }: { clienteId: number })` (também `export default`).

- [ ] **Step 1: Adicionar as chaves de texto**

Em `packages/i18n/locales/pt/clients.json`, dentro de `detail`, depois da linha `"removeDateConfirm": ...,` inserir:

```json
    "usefulLinks": "Links úteis",
    "addLink": "Adicionar link",
    "noUsefulLinks": "Nenhum link cadastrado",
    "addLinkHint": "Clique em \"Adicionar link\" para salvar o Google Drive, o Notion ou outros links do cliente.",
    "newLink": "Novo link",
    "editLink": "Editar link",
    "removeLink": "Remover link",
    "removeLinkConfirm": "Tem certeza que deseja remover este link? Esta ação não pode ser desfeita.",
    "linkTitle": "Título *",
    "linkTitlePlaceholder": "Ex: Google Drive",
    "linkUrl": "URL *",
    "linkUrlPlaceholder": "https://drive.google.com/...",
    "linkDescription": "Descrição",
    "linkDescriptionPlaceholder": "Ex: Pasta de criativos aprovados",
    "linkTitleRequired": "Informe um título.",
    "linkUrlInvalid": "Informe uma URL válida (http ou https).",
    "linkAdded": "Link adicionado!",
    "linkUpdated": "Link atualizado!",
    "linkRemoved": "Link removido!",
```

Em `packages/i18n/locales/en/clients.json`, no mesmo ponto:

```json
    "usefulLinks": "Useful links",
    "addLink": "Add link",
    "noUsefulLinks": "No links registered",
    "addLinkHint": "Click \"Add link\" to save the client's Google Drive, Notion or other links.",
    "newLink": "New link",
    "editLink": "Edit link",
    "removeLink": "Remove link",
    "removeLinkConfirm": "Are you sure you want to remove this link? This action cannot be undone.",
    "linkTitle": "Title *",
    "linkTitlePlaceholder": "E.g. Google Drive",
    "linkUrl": "URL *",
    "linkUrlPlaceholder": "https://drive.google.com/...",
    "linkDescription": "Description",
    "linkDescriptionPlaceholder": "E.g. Approved creatives folder",
    "linkTitleRequired": "Enter a title.",
    "linkUrlInvalid": "Enter a valid URL (http or https).",
    "linkAdded": "Link added!",
    "linkUpdated": "Link updated!",
    "linkRemoved": "Link removed!",
```

Run: `node -e "for (const l of ['pt','en']) JSON.parse(require('fs').readFileSync('packages/i18n/locales/'+l+'/clients.json','utf8'))"`
Expected: sem saída (JSON válido).

- [ ] **Step 2: Escrever os testes da seção (vão falhar)**

Create `apps/crm/src/pages/cliente-detalhe/components/__tests__/ClienteLinksSection.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getClienteLinks: vi.fn(),
  addClienteLink: vi.fn(),
  updateClienteLink: vi.fn(),
  removeClienteLink: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getClienteLinks,
  addClienteLink,
  updateClienteLink,
  removeClienteLink,
  type ClienteLink,
} from '@/store';
import { toast } from 'sonner';
import { ClienteLinksSection } from '../ClienteLinksSection';

const mockedGet = vi.mocked(getClienteLinks);
const mockedAdd = vi.mocked(addClienteLink);
const mockedUpdate = vi.mocked(updateClienteLink);
const mockedRemove = vi.mocked(removeClienteLink);
const mockedToast = vi.mocked(toast);

const CLIENTE_ID = 42;

function link(overrides: Partial<ClienteLink> = {}): ClienteLink {
  return {
    id: 1,
    cliente_id: CLIENTE_ID,
    titulo: 'Google Drive',
    url: 'https://www.drive.google.com/drive/folders/abc',
    descricao: 'Pasta de criativos',
    ...overrides,
  };
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ClienteLinksSection clienteId={CLIENTE_ID} />
    </QueryClientProvider>,
  );
  return { ...utils, invalidateSpy };
}

async function openAddDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar link' }));
  return screen.findByRole('dialog', { name: 'Novo link' });
}

function fill(dialog: HTMLElement, titulo: string, url: string, descricao = '') {
  fireEvent.change(within(dialog).getByPlaceholderText('Ex: Google Drive'), {
    target: { value: titulo },
  });
  fireEvent.change(within(dialog).getByPlaceholderText('https://drive.google.com/...'), {
    target: { value: url },
  });
  if (descricao) {
    fireEvent.change(within(dialog).getByPlaceholderText('Ex: Pasta de criativos aprovados'), {
      target: { value: descricao },
    });
  }
}

describe('ClienteLinksSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue([]);
  });

  it('shows the empty state when there are no links', async () => {
    renderSection();
    expect(await screen.findByText('Nenhum link cadastrado')).toBeInTheDocument();
  });

  it('renders each link as a safe external anchor with title, description and domain', async () => {
    mockedGet.mockResolvedValue([link()]);
    renderSection();

    const anchor = await screen.findByRole('link', { name: /Google Drive/ });
    expect(anchor).toHaveAttribute('href', 'https://www.drive.google.com/drive/folders/abc');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(anchor).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    expect(within(anchor).getByText('Pasta de criativos')).toBeInTheDocument();
    expect(within(anchor).getByText('drive.google.com')).toBeInTheDocument();
  });

  it('rejects an empty title without calling the store', async () => {
    renderSection();
    const dialog = await openAddDialog();
    fill(dialog, '', 'https://drive.google.com/x');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    expect(await within(dialog).findByText('Informe um título.')).toBeInTheDocument();
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it('rejects an invalid URL without calling the store', async () => {
    renderSection();
    const dialog = await openAddDialog();
    fill(dialog, 'Drive', 'javascript:alert(1)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    expect(
      await within(dialog).findByText('Informe uma URL válida (http ou https).'),
    ).toBeInTheDocument();
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it('adds a link, prepending https://, invalidates the query, toasts and closes', async () => {
    mockedAdd.mockResolvedValue(link({ id: 2 }));
    const { invalidateSpy } = renderSection();

    const dialog = await openAddDialog();
    fill(dialog, 'Drive', 'drive.google.com/drive/folders/abc', 'Pasta de criativos');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedAdd).toHaveBeenCalledTimes(1));
    expect(mockedAdd).toHaveBeenCalledWith({
      cliente_id: CLIENTE_ID,
      titulo: 'Drive',
      url: 'https://drive.google.com/drive/folders/abc',
      descricao: 'Pasta de criativos',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteLinks', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Link adicionado!');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('saves an empty description as null', async () => {
    mockedAdd.mockResolvedValue(link({ id: 2 }));
    renderSection();

    const dialog = await openAddDialog();
    fill(dialog, 'Notion', 'https://notion.so/aurora');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedAdd).toHaveBeenCalledTimes(1));
    expect(mockedAdd).toHaveBeenCalledWith(expect.objectContaining({ descricao: null }));
  });

  it('shows an error toast when the store rejects', async () => {
    mockedAdd.mockRejectedValue(new Error('boom'));
    renderSection();

    const dialog = await openAddDialog();
    fill(dialog, 'Drive', 'https://drive.google.com/x');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedToast.error).toHaveBeenCalledWith('Erro: boom'));
    expect(screen.getByRole('dialog', { name: 'Novo link' })).toBeInTheDocument();
  });

  it('edits an existing link with the fields prefilled', async () => {
    const existing = link();
    mockedGet.mockResolvedValue([existing]);
    mockedUpdate.mockResolvedValue({ ...existing, titulo: 'Drive do cliente' });
    const { invalidateSpy } = renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Editar link: Google Drive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar link' });
    expect(within(dialog).getByPlaceholderText('Ex: Google Drive')).toHaveValue('Google Drive');

    fireEvent.change(within(dialog).getByPlaceholderText('Ex: Google Drive'), {
      target: { value: 'Drive do cliente' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate).toHaveBeenCalledWith(1, {
      titulo: 'Drive do cliente',
      url: 'https://www.drive.google.com/drive/folders/abc',
      descricao: 'Pasta de criativos',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteLinks', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Link atualizado!');
  });

  it('removes a link only after confirmation', async () => {
    mockedGet.mockResolvedValue([link()]);
    mockedRemove.mockResolvedValue(undefined);
    const { invalidateSpy } = renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Remover link: Google Drive' }));
    expect(mockedRemove).not.toHaveBeenCalled();

    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(mockedRemove).toHaveBeenCalledWith(1));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteLinks', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Link removido!');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/components/__tests__/ClienteLinksSection.test.tsx`
Expected: FAIL (`Failed to resolve import "../ClienteLinksSection"`).

- [ ] **Step 4: Implementar o componente**

Create `apps/crm/src/pages/cliente-detalhe/components/ClienteLinksSection.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  getClienteLinks,
  addClienteLink,
  updateClienteLink,
  removeClienteLink,
  type ClienteLink,
} from '@/store';
import { sanitizeUrl } from '@/utils/security';
import { normalizeLinkUrl, linkDomain } from '../linkUrl';

interface ClienteLinksSectionProps {
  clienteId: number;
}

const EMPTY_FORM = { titulo: '', url: '', descricao: '' };

function buildLinkSchema(t: TFunction) {
  return z.object({
    titulo: z
      .string()
      .trim()
      .min(1, t('detail.linkTitleRequired'))
      .max(120, t('detail.linkTitleRequired')),
    url: z
      .string()
      .trim()
      .max(2048, t('detail.linkUrlInvalid'))
      .refine((v) => normalizeLinkUrl(v) !== null, t('detail.linkUrlInvalid')),
    descricao: z.string().trim().max(300),
  });
}

type LinkFormValues = z.infer<ReturnType<typeof buildLinkSchema>>;

/**
 * "Links úteis" card for the client's "Visão geral" tab: Drive, Notion, Figma
 * and similar links, each with a title, URL and optional description. Owns its
 * own `['clienteLinks', clienteId]` query, like the Datas and Endereços
 * sections next to it. The Dialog uses `confirmClose`, so an edit in flight is
 * already covered by the unsaved-work guard.
 */
export function ClienteLinksSection({ clienteId }: ClienteLinksSectionProps) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const queryClient = useQueryClient();

  const { data: links, isLoading } = useQuery({
    queryKey: ['clienteLinks', clienteId],
    queryFn: () => getClienteLinks(clienteId),
    enabled: !isNaN(clienteId),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClienteLink | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const form = useForm<LinkFormValues>({
    resolver: zodResolver(buildLinkSchema(t)),
    defaultValues: EMPTY_FORM,
  });
  const { errors, isSubmitting } = form.formState;

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    form.reset(EMPTY_FORM);
  };

  const openDialog = (l?: ClienteLink) => {
    setEditing(l ?? null);
    form.reset(l ? { titulo: l.titulo, url: l.url, descricao: l.descricao ?? '' } : EMPTY_FORM);
    setDialogOpen(true);
  };

  const onSubmit = async (values: LinkFormValues) => {
    const payload = {
      titulo: values.titulo,
      url: normalizeLinkUrl(values.url) as string,
      descricao: values.descricao || null,
    };
    try {
      if (editing?.id) {
        await updateClienteLink(editing.id, payload);
        toast.success(t('detail.linkUpdated'));
      } else {
        await addClienteLink({ cliente_id: clienteId, ...payload });
        toast.success(t('detail.linkAdded'));
      }
      queryClient.invalidateQueries({ queryKey: ['clienteLinks', clienteId] });
      closeDialog();
    } catch (err: unknown) {
      toast.error(t('detail.genericError', { error: (err as Error).message }));
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await removeClienteLink(deleteId);
      queryClient.invalidateQueries({ queryKey: ['clienteLinks', clienteId] });
      toast.success(t('detail.linkRemoved'));
    } catch (err: unknown) {
      toast.error(t('detail.genericError', { error: (err as Error).message }));
    }
    setDeleteId(null);
  };

  return (
    <>
      <div id="sec-links" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-0">
            <Link2 className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
            {t('detail.usefulLinks')}
          </h3>
          <Button size="sm" onClick={() => openDialog()}>
            <Plus className="h-4 w-4" style={{ marginRight: 4 }} /> {t('detail.addLink')}
          </Button>
        </div>

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
            <Spinner size="sm" />
          </div>
        )}

        {!isLoading && (!links || links.length === 0) && (
          <div
            style={{
              textAlign: 'center',
              padding: '2rem 1rem',
              color: 'var(--text-muted)',
              border: '1px dashed var(--border-color)',
              borderRadius: '12px',
            }}
          >
            <Link2 className="h-8 w-8" style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.9rem' }}>{t('detail.noUsefulLinks')}</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>{t('detail.addLinkHint')}</p>
          </div>
        )}

        {!isLoading && links && links.length > 0 && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {links.map((l) => (
              <div key={l.id} className="cliente-date-card">
                <a
                  href={sanitizeUrl(l.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ flex: 1, minWidth: 0, color: 'inherit', textDecoration: 'none' }}
                >
                  <p
                    style={{
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      marginBottom: '0.1rem',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {l.titulo}
                  </p>
                  {l.descricao && (
                    <p
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {l.descricao}
                    </p>
                  )}
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                    {linkDomain(l.url)}
                  </p>
                </a>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    style={{ width: 28, height: 28 }}
                    onClick={() => openDialog(l)}
                    aria-label={`${t('detail.editLink')}: ${l.titulo}`}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    style={{ width: 28, height: 28, color: 'var(--danger)' }}
                    onClick={() => setDeleteId(l.id!)}
                    aria-label={`${t('detail.removeLink')}: ${l.titulo}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent style={{ maxWidth: 440 }} onConfirmClose={closeDialog}>
          <DialogHeader>
            <DialogTitle>{editing ? t('detail.editLink') : t('detail.newLink')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>{t('detail.linkTitle')}</Label>
                <Input
                  placeholder={t('detail.linkTitlePlaceholder')}
                  maxLength={120}
                  {...form.register('titulo')}
                />
                {errors.titulo && (
                  <p style={{ color: 'var(--danger-text)', fontSize: '0.8rem' }}>
                    {errors.titulo.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label>{t('detail.linkUrl')}</Label>
                <Input
                  placeholder={t('detail.linkUrlPlaceholder')}
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  {...form.register('url')}
                />
                {errors.url && (
                  <p style={{ color: 'var(--danger-text)', fontSize: '0.8rem' }}>
                    {errors.url.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label>{t('detail.linkDescription')}</Label>
                <Input
                  placeholder={t('detail.linkDescriptionPlaceholder')}
                  maxLength={300}
                  {...form.register('descricao')}
                />
              </div>
            </div>
            <DialogFooter style={{ marginTop: '1rem' }}>
              <Button type="button" variant="outline" onClick={closeDialog}>
                {tc('actions.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Spinner size="sm" />}{' '}
                {editing ? tc('actions.save') : tc('actions.add')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.removeLink')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.removeLinkConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{tc('actions.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ClienteLinksSection;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/components/__tests__/ClienteLinksSection.test.tsx`
Expected: PASS (9 testes). Se falhar por detalhe de infraestrutura (nome acessível do link, import de `TFunction`), ajuste o componente; não afrouxe as asserções de segurança do link (`target`, `rel`, `href`).

- [ ] **Step 6: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add packages/i18n/locales apps/crm/src/pages/cliente-detalhe/components
git commit -m "feat(crm): Links úteis section for the client page" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Encaixar na aba Visão geral e verificar

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/tabs/VisaoGeralTab.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/tabs/__tests__/VisaoGeralTab.test.tsx`

**Interfaces:**
- Consumes: `ClienteLinksSection` (Task 3), `getClienteLinks` (Task 2).

- [ ] **Step 1: Atualizar o teste da aba (vai falhar)**

Em `VisaoGeralTab.test.tsx`:

1. No `vi.mock('@/store', ...)`, adicionar `getClienteLinks: vi.fn(),`.
2. No import de `@/store`, adicionar `getClienteLinks`; abaixo dos outros `vi.mocked`, adicionar `const mockedGetLinks = vi.mocked(getClienteLinks);`.
3. No `beforeEach`, adicionar `mockedGetLinks.mockResolvedValue([]);`.
4. Substituir o teste `renders both the important-dates and addresses empty states` por:

```tsx
  it('renders the links, important-dates and addresses empty states', async () => {
    renderTab();
    expect(await screen.findByText('Nenhum link cadastrado')).toBeInTheDocument();
    expect(await screen.findByText('Nenhuma data importante cadastrada')).toBeInTheDocument();
    expect(screen.getByText('Nenhum endereço cadastrado')).toBeInTheDocument();
  });

  it('renders Links úteis after the info card and before Datas Importantes', async () => {
    const { container } = renderTab();
    await screen.findByText('Nenhum link cadastrado');
    await screen.findByText('Nenhuma data importante cadastrada');

    const [info, links, datas] = ['sec-info', 'sec-links', 'sec-datas'].map((id) => {
      const el = container.querySelector(`#${id}`);
      expect(el, `#${id} missing`).not.toBeNull();
      return el as Element;
    });
    expect(info.compareDocumentPosition(links) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(links.compareDocumentPosition(datas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
```

5. No último teste, renomear para `queries only clienteLinks, clienteDatas and clienteEnderecos — nothing from Entregas, Instagram, Hub or Financeiro` e trocar a expectativa por `new Set(['clienteLinks', 'clienteDatas', 'clienteEnderecos'])`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/tabs/__tests__/VisaoGeralTab.test.tsx`
Expected: FAIL (`Nenhum link cadastrado` não encontrado).

- [ ] **Step 3: Renderizar a seção**

Em `VisaoGeralTab.tsx`, adicionar o import junto dos outros:

```tsx
import { ClienteLinksSection } from '../components/ClienteLinksSection';
```

E trocar o final do JSX:

```tsx
      <ClienteDatasSection clienteId={clienteId} />
      <ClienteEnderecosSection clienteId={clienteId} />
```

por:

```tsx
      <ClienteLinksSection clienteId={clienteId} />
      <ClienteDatasSection clienteId={clienteId} />
      <ClienteEnderecosSection clienteId={clienteId} />
```

Atualizar também o comentário de cabeçalho do componente para dizer "plus the useful-links, important-dates and addresses sections".

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe`
Expected: PASS em toda a pasta (inclui os testes de Datas/Endereços, que não devem ser afetados).

- [ ] **Step 5: Gates locais**

Run, em sequência:
```bash
npx prettier --write apps/crm/src/pages/cliente-detalhe apps/crm/src/store/clients.ts packages/i18n/locales
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```
Expected: tudo verde. Se o prettier reformatar arquivos, inclua no commit do Step 7.

- [ ] **Step 6: Verificar no navegador (desktop e mobile)**

Worktree não tem `.env`: usar `npm run dev:env`. A tabela ainda não existe no Supabase remoto, então: aplicar a migration em staging antes (ver "Deploy", com confirmação do usuário) e usar staging, ou validar só UI/layout (lista vazia, Dialog aberto, validação). Verificar:
- Ordem: informações, Links úteis, Datas importantes, Endereços.
- Adicionar link abre o Dialog; URL sem protocolo é aceita; URL inválida mostra o erro.
- Editar, excluir com confirmação, clique no item abre em nova aba.
- Largura de ~400px: sem scroll horizontal, botões de editar/excluir com alvo de toque de 44px (a regra mobile de `.cliente-date-card button` já se aplica).
- Tema escuro legível.
Se o CRUD contra o banco não puder ser exercitado, dizer isso explicitamente no relato final em vez de afirmar que funciona.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe apps/crm/src/store/clients.ts packages/i18n/locales
git commit -m "feat(crm): render Links úteis before Datas Importantes" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Deploy (não faz parte da execução automática)

O merge publica o frontend na hora (Vercel), então **a migration precisa estar aplicada antes do merge**: `npx supabase db push --linked` em staging para testar, depois em prod antes de mergear. Sem edge function nova e sem rota nova (`vercel.json` não muda). Confirmar com o usuário antes de qualquer `db push`. Antes de abrir o PR, refazer o Step 1 da Task 1 (renumerar a migration se `main` andou).

## Self-review (spec × plano)

- Posição antes de Datas: Task 4 (código e teste de ordem).
- Tabela, limites, CHECKs, RLS com anti-corrupção, grants, índices: Task 1. Versão livre: Task 1 Step 1.
- Store (4 funções, `created_at desc`, exportado via `export *`): Task 2.
- UI (lista, domínio, link seguro, Dialog rhf+zod, editar, excluir com confirmação, vazio, `https://` automático, toasts, i18n pt/en, `confirmClose`): Task 3.
- Testes (componente, helper, RLS psql, browser): Tasks 1 a 4.
- Fora do escopo respeitado (sem ordenação, categorias, Hub).
- Nomes consistentes entre tarefas: `ClienteLink`, `getClienteLinks`, `addClienteLink`, `updateClienteLink`, `removeClienteLink`, `normalizeLinkUrl`, `linkDomain`, `ClienteLinksSection`, query key `['clienteLinks', clienteId]`, ids `sec-links`.

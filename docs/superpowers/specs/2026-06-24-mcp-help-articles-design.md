# MCP Help Articles (Ajuda) — Design

**Date:** 2026-06-24
**Status:** Approved (design)
**Author:** Eduardo + Claude

## Goal

Add three help articles to the CRM **Ajuda** (Central de Ajuda) page documenting
the Claude/MCP integration: how to connect it, what the agent can do, and what it
cannot do (limits & safety). Group them under a new **Claude & IA** category.

Audience: CRM owners/admins (the MCP UI at `/configuracao/mcp` is owner/admin-only,
behind the `feature_mcp` flag). Language: Portuguese (pt-BR), matching the existing
help-center tone.

## Background

The Ajuda page (`apps/crm/src/pages/ajuda/AjudaPage.tsx`) is data-driven:

- Articles live in the `kb_articles` table (TipTap/ProseMirror JSONB in `content`,
  flattened text in `content_plain` for search). RLS exposes only `status =
  'published'` to authenticated users.
- Categories are declared in `apps/crm/src/pages/ajuda/categoryConfig.ts`
  (`CATEGORY_LABELS`). The page renders a category section **only if it has ≥ 1
  published article** (`count > 0`).
- Contextual help (`kb_context_links`) maps CRM routes to articles, surfaced via
  `ContextHelpLinks`/`getContextLinksForRoute`.
- Articles are seeded/maintained via SQL migrations. The current best pattern is
  `supabase/migrations/20260520000001_expand_kb_help_center.sql`, which uses
  local `_kb_expand_*` builder functions plus idempotent
  `_kb_expand_upsert_article` (`ON CONFLICT (slug) DO UPDATE`) and
  `_kb_expand_link`, all dropped at the end.

## Architecture

Mirror the expand-migration pattern exactly. One new migration creates
locally-scoped `_kb_mcp_*` helper functions, upserts three articles + three
context links idempotently, then drops the helpers. The frontend change is a
single line in `categoryConfig.ts` registering the new category. Both must ship
together: the category will not render until it has published articles, and the
articles need the label to display a friendly section name.

### Files

- **Create** `supabase/migrations/20260624000002_seed_kb_mcp_articles.sql`
  (`…000001` is taken by `mcp_created_via.sql`)
  - Helper builders: `_kb_mcp_text`, `_kb_mcp_p`, `_kb_mcp_h`, `_kb_mcp_ul`,
    `_kb_mcp_ol`, `_kb_mcp_callout`, `_kb_mcp_doc`, `_kb_mcp_plain` (identical
    semantics to the expand-migration helpers).
  - `_kb_mcp_upsert_article(id, title, slug, excerpt, content, category, tags,
    display_order)` — inserts with `status='published'`, `content_plain =
    _kb_mcp_plain(content)`, `ON CONFLICT (slug) DO UPDATE` of all mutable fields.
  - `_kb_mcp_link(route_pattern, slug, label, display_order)` — resolves slug →
    id, raises if missing, upserts into `kb_context_links` with `ON CONFLICT
    (route_pattern, article_id) DO UPDATE`.
  - Three `SELECT _kb_mcp_upsert_article(...)` calls (articles below).
  - Three `SELECT _kb_mcp_link('/configuracao/mcp', <slug>, NULL, <order>)` calls.
  - `DROP FUNCTION IF EXISTS` for every helper at the end.
- **Modify** `apps/crm/src/pages/ajuda/categoryConfig.ts`
  - Insert `'claude-e-ia': 'Claude & IA'` into `CATEGORY_LABELS` immediately after
    `'primeiros-passos'`, so the section renders **second** on the page (the
    landing-page section order follows `Object.keys(CATEGORY_LABELS)`).

### Identifiers & ordering

- Category slug: `claude-e-ia`; label `Claude & IA`.
- Article UUIDs use a fresh `bbbbbbbb-…` prefix to avoid colliding with the
  existing `aaaaaaaa-…` series:
  - `bbbbbbbb-0001-4000-b000-000000000001` — Como conectar o Claude (MCP)
  - `bbbbbbbb-0002-4000-b000-000000000002` — O que o agente pode fazer
  - `bbbbbbbb-0003-4000-b000-000000000003` — Limites e segurança
- `display_order`: 5, 6, 7 (after Primeiros Passos = 1, 2; intra-section order
  how-to → can-do → limits, and globally near the top to match the second-section
  placement).
- Context links on `/configuracao/mcp`, `display_order` 0 (how-to), 1 (can-do),
  2 (limits).

## Article content

All three are written in Portuguese. Section structure below is the source of
truth; the implementation plan carries the verbatim copy. Facts are grounded in
the live UI (`IntegracoesClaudePage.tsx`), the tool registry
(`supabase/functions/mcp/tools.ts`), and the scope mirror (`mcp-scopes.ts`).

### Article 1 — "Como conectar o Claude (MCP)"

- slug `como-conectar-o-claude-mcp`, category `claude-e-ia`, order 5.
- excerpt: "Conecte um agente Claude ao seu workspace por conector (sem chave) ou
  por chave de API."
- Sections:
  - **O que é o MCP** — protocolo que dá a um agente Claude acesso de leitura e
    escrita controlada a partes deste workspace (clientes, posts, pautas, fluxos).
  - **Onde fica** — Configurações → Claude (MCP) (`/configuracao/mcp`); apenas
    proprietários e admins; recurso liberado pelo plano.
  - **Método recomendado — claude.ai e Claude Desktop (sem chave)** — ol:
    Configurações → Conectores → Adicionar conector personalizado; colar a URL do
    MCP e deixar os campos de OAuth em branco; fazer login no Mesaas, escolher o
    workspace e as permissões e clicar em Autorizar.
  - **Claude Code, API ou agentes headless (com chave)** — criar uma chave na
    página, copiar o comando (Claude Code) ou bloco de configuração; chave no
    formato `mesaas_sk_…`; usar "Conectar" ao lado de uma chave existente.
  - **Permissões (escopos)** — escolha apenas os escopos necessários; o preset de
    agente é somente leitura; escrita (`posts:write`, `templates:write`) é opt-in.
  - **Gerenciar e revogar** — lista "Conexões Claude"; desconectar revoga na hora;
    chaves podem ser revogadas individualmente.
  - **Primeiros comandos** — callout com exemplos: "liste meus clientes ativos",
    "mostre o post X com métricas".

### Article 2 — "O que o agente pode fazer"

- slug `o-que-o-agente-pode-fazer`, category `claude-e-ia`, order 6.
- excerpt: "As ferramentas de leitura e escrita disponíveis e o fluxo completo de
  criação de conteúdo."
- Sections:
  - **Leitura** — ul: clientes (campos não sensíveis); perfil de marca e
    briefing; páginas do hub; pipeline de posts com métricas; detalhe do post com
    mídia assinada; baseline de desempenho; feedback do cliente; fluxos; modelos
    de fluxo; backlog de ideias/pautas.
  - **Escrita** — ul: criar fluxo (opcionalmente a partir de um modelo); criar
    post em rascunho; editar post e avançar status apenas para estágios internos;
    definir propriedade personalizada do post; criar modelo de fluxo.
  - **O fluxo completo de conteúdo** — ol: ler marca/briefing/estratégia/baseline
    → criar modelo → criar fluxo → rascunhar posts → marcar propriedades → revisar
    com base no feedback.
  - **Escopos necessários** — callout: leitura exige os escopos `*:read`; criar/
    editar posts exige `posts:write`; criar modelos exige `templates:write`.

### Article 3 — "Limites e segurança"

- slug `limites-e-seguranca-do-agente`, category `claude-e-ia`, order 7.
- excerpt: "O que o agente nunca faz — publicação, envio ao cliente, exclusões e
  isolamento de dados."
- Sections:
  - **O agente nunca publica** — não posta nem agenda no Instagram.
  - **O agente nunca envia ao cliente** — não move posts para estágios visíveis ao
    cliente; editar um post visível ao cliente o devolve para revisão interna; o
    portão de aprovação humano é obrigatório.
  - **Escrita apenas em rascunho/interno** — ferramentas de escrita recusam operar
    fora dos estágios internos editáveis.
  - **Sem exclusões** — nenhuma ferramenta apaga clientes, posts, fluxos, modelos
    ou ideias.
  - **Sem dados sensíveis** — leitura de cliente restrita a campos não sensíveis
    (sem financeiro, contratos, contato/cobrança bruta).
  - **Isolamento por workspace** — uma conexão só enxerga o workspace autorizado.
  - **Ideias e feedback são somente leitura** — o agente não cria pautas nem
    feedback no lugar do cliente.
  - **Privilégio mínimo por padrão** — preset somente leitura; escrita é opt-in.
  - **Registro e privacidade** — erros retornam mensagens genéricas; logs de
    auditoria guardam IDs/filtros/contagens, nunca o conteúdo dos posts.
  - **Callout (LGPD/CFM)** — o agente é um colaborador de rascunho; nada cruza o
    portão humano até a publicação/aprovação.

## Delivery

1. Branch off `main` (`feat/kb-mcp-help-articles`).
2. Write the migration + `categoryConfig.ts` change.
3. `npm run build` (tsc + vite) must pass.
4. Apply the migration to **staging** via the Supabase SQL editor (per the known
   staging `db push` gotcha — the orphaned backfill migration aborts `db push`),
   then visually confirm the "Claude & IA" section and the three articles render
   in Ajuda, and that the contextual link appears on `/configuracao/mcp`.
5. Open a PR.
6. On merge, apply the same migration to **prod**. CRM frontend auto-deploys via
   Vercel.

## Testing

- `npm run build` (typecheck) — the only automated gate; `categoryConfig.ts` is a
  typed record, the page component is unchanged.
- Migration correctness verified manually on staging (no DB test harness for KB).
  The migration is idempotent (`ON CONFLICT DO UPDATE`), so re-running is safe.

## Out of scope

- No changes to the Ajuda page component, the article renderer, the TipTap editor,
  or any MCP edge function.
- No new MCP tools or scopes.
- No English translations (UI is pt-BR only).

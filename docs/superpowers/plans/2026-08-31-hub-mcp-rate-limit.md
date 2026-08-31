# Rate limit nos endpoints do Hub e MCP + limpeza agendada do rate_limit_log

## Contexto

Auditoria de 2026-08-31: os endpoints `hub-*` (auth por token na URL, sem login) e o
servidor `mcp` não têm nenhum rate limit. Com um token de Hub válido — que vaza fácil
(URL encaminhada, histórico, print) — dá para inserir mensagens/ideias/sugestões sem
freio, gerar notificações (que alimentam crons de e-mail) e transferir custo de DB.
Tentativas com token inválido também são ilimitadas. Além disso,
`cleanup_rate_limit_log()` (migration `20260417000004`) existe mas nunca foi agendada.

A infra já existe: `_shared/rate-limit.ts` (`checkRateLimit` → RPC `check_rate_limit`,
atômica desde `20260806000001`, fail-open em erro de RPC; `getClientIP`). O precedente
de DI é `instagram-connect-link` (`deps.rateLimit` com a assinatura exata de
`checkRateLimit`).

## Política de limites

| Situação | Chave | Limite | Resposta |
|---|---|---|---|
| Token de Hub inválido (por IP) | `hub-badtoken:{ip}` | 30 / 10 min | 429 em vez do 404 |
| Qualquer request de Hub com token válido | `hub-read:{contaId}:{clienteId}` | 300 / 5 min | 429 |
| Escrita de conteúdo no Hub (por função) | `hub-write:{fn}:{contaId}:{clienteId}` | 30 / hora | 429 |
| Chamada MCP (por chave/ctx) | `mcp:{key_id}` | 120 / min | 429 + `Retry-After: 60` |

- O budget `hub-read` se aplica a TODA request com token resolvido, escrita incluída
  (é um teto global de requests por cliente); o `hub-write` é checado ADICIONALMENTE
  nas rotas que criam conteúdo.
- Contam como escrita (`hub-write:{fn}`): `hub-mensagens` POST de conteúdo,
  `hub-ideias` POST, `hub-edit-suggestion` POST, `hub-briefing` POST (salvar
  respostas), `hub-approve` POST. NÃO contam: `hub-mensagens /seen`, o touch do
  `hub-bootstrap` e todos os GETs.
- Mensagem de 429 no Hub: `{ "error": "Muitas tentativas. Aguarde alguns minutos." }`
  (PT-BR, genérica, sem detalhe interno — regra do CLAUDE.md).
- A janela mais longa é 3600s; `cleanup_rate_limit_log()` apaga >1h, então a poda
  não interfere em nenhuma contagem.

## Tarefa 1 — dep `rateLimit` nos 13 handlers de Hub

Funções: `hub-approve`, `hub-bootstrap`, `hub-brand`, `hub-briefing`, `hub-dashboard`,
`hub-edit-suggestion`, `hub-ideias`, `hub-instagram-feed`, `hub-mensagens`,
`hub-pages`, `hub-posts`, `hub-report-docs`, `hub-reports`.

Em cada `handler.ts`:

1. Adicionar ao deps interface (obrigatório, não opcional — o typecheck força o
   wiring):
   ```ts
   rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
   ```
2. Importar `getClientIP` de `../_shared/rate-limit.ts` (função pura sobre Request,
   segura em teste).
3. No branch `if (!hubToken)` (hub-briefing tem DOIS pontos de resolução — cobrir
   ambos): antes do 404, `const ok = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);`
   se `!ok`, responder 429. Senão manter o 404 atual.
4. Com token válido, antes de qualquer trabalho:
   `hub-read:{contaId}:{clienteId}`, 300, 300 → 429 se estourar.
5. Nas rotas de escrita listadas acima, adicionalmente:
   `hub-write:{nome-da-funcao}:{contaId}:{clienteId}`, 30, 3600 → 429.

Em cada `index.ts`: importar `checkRateLimit` de `../_shared/rate-limit.ts` e passar
`rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win)` (mesmo
cast dos call sites existentes).

Atenção ao `hub-bootstrap`: ele resolve por slug + token com `expectedContaId`; o
limite de badtoken vale igual quando `resolveHubToken` devolve null.

## Tarefa 2 — limite por chave no MCP

Em `supabase/functions/mcp/index.ts`, logo após `resolveCtx` retornar um `ctx`
válido (após o bloco 401):

```ts
const allowed = await checkRateLimit(db as any, `mcp:${ctx.key_id}`, 120, 60);
if (!allowed) {
  return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
    status: 429,
    headers: { ...cors, "Content-Type": "application/json", "Retry-After": "60" },
  });
}
```

Se o `ctx` de OAuth não tiver `key_id` estável, usar `ctx.key_id ?? ctx.conta_id`
como discriminador — verificar o shape retornado por `resolveCtx` antes.

## Tarefa 3 — agendar a limpeza

Nova migration `supabase/migrations/20260831000001_schedule_rate_limit_cleanup.sql`
(prefixo único — `migration-version-guard`). SQL direto no Postgres, sem
`net.http_post`/vault (a função é SQL puro, não edge function):

```sql
-- cleanup_rate_limit_log() existe desde 20260417000004 mas nunca foi agendada:
-- rate_limit_log crescia sem poda. Janela máxima de limite em uso é 1h, e a
-- função apaga só linhas com mais de 1h — a poda nunca interfere numa contagem.
-- Idempotente: safe to apply twice.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rate-limit-cleanup') THEN
    PERFORM cron.unschedule('rate-limit-cleanup');
  END IF;
END $$;

SELECT cron.schedule('rate-limit-cleanup', '15 * * * *', $$SELECT cleanup_rate_limit_log()$$);
```

## Tarefa 4 — testes

- Atualizar TODOS os testes de Hub existentes em `supabase/functions/__tests__/`
  (`hub-bootstrap_test.ts`, `hub-briefing_test.ts`, `hub-dashboard_test.ts`,
  `hub-functions_test.ts`, `hub-ideias_test.ts`, `hub-mensagens_test.ts`, e qualquer
  outro que construa deps de hub) com o stub `rateLimit: async () => true`. O deps
  obrigatório fará o typecheck do `deno test` apontar cada lugar.
- Testes novos (padrão dos testes existentes, handlers puros com deps fake):
  - `hub-mensagens`: POST com `rateLimit` devolvendo false na chave `hub-write:*`
    → 429 e nenhum insert; chave `hub-read:*` false → 429.
  - badtoken: token inválido com `rateLimit` false → 429; com true → 404 (comportamento
    atual preservado).
  - Asserção das chaves/limites passados (capturar args do stub) em pelo menos um
    handler de leitura e um de escrita.

## Validação (tudo antes de encerrar)

```
npm run test:functions
npm run lint
npm run format:check   # npm run format para corrigir
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Não commitar — deixar o working tree pronto para revisão.

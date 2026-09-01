# Paridade dos KPIs com o app do Instagram — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer todo KPI com equivalente no app do Instagram vir da métrica de conta da Graph API na janela do mês, e transformar o snapshot diário em histórico próprio (além dos 90 dias de retenção da Meta).

**Architecture:** Um módulo compartilhado de métricas de conta (`_shared/instagram-account-metrics.ts`) alimenta três consumidores: report-docs (KPIs do relatório de blocos), instagram-analytics (endpoint novo do CRM) e instagram-sync-cron (ingestão diária D-1..D-3, agregado mensal fechado e backfill de 90d com cursor). Métricas de únicos (reach, accounts_engaged) nunca são somadas entre chunks ou dias; seu histórico é o agregado mensal persistido.

**Tech Stack:** Deno edge functions (Supabase), Postgres (migrations + RPC SQL), React 19 + TanStack Query (CRM), Vitest + deno test.

**Spec:** `docs/superpowers/specs/2026-08-31-report-app-parity-design.md` — leia inteira antes de qualquer task.

## Global Constraints

- Migrations: prefixo de versão ÚNICO e acima do tail de `origin/main` — verificar com `git ls-tree origin/main:supabase/migrations | tail -5` IMEDIATAMENTE antes de criar o arquivo E de novo antes do `gh pr create`. Tail conhecido em 2026-08-31: `20260901000012`.
- Deploy de functions: `npx supabase functions deploy <name> --use-api` (+ `--no-verify-jwt` para crons e functions com auth própria). Projeto linkado: conferir `cat supabase/.temp/project-ref` (PROD=`skjzpekeqefvlojenfsw`).
- Nunca secrets como argumento literal de CLI: usar `--env-file` com arquivo temporário no scratchpad.
- Nunca wildcard CORS; `buildCorsHeaders(req)`. Nunca detalhe de erro pro cliente.
- Sem em-dash em copy user-facing (pt-BR): usar ponto, dois-pontos ou "·".
- Depois de qualquer `deno test`/deploy: `git checkout -- deno.lock` e conferir `ls node_modules/.deno` (rodar `npm ci` se poluído) antes de confiar em prettier/tsc locais.
- Gates antes de push: `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run test:functions`.
- Conta de teste real: Healing Hands (`instagram_accounts.id = b7a4333d-df8e-48f7-b3d8-94440691ea71`, client_id 411). NUNCA testar rotas live-Graph no workspace DK TESTE (tokens falsos).

---

## Matriz de capacidades por métrica (PREENCHER NA FASE 0 — bloqueia Fases 1+)

Resultado do spike (§3 da spec). Uma linha por métrica. **As Fases 1-6 só começam
depois desta tabela preenchida e do checkpoint com o Eduardo.**

| Métrica | total_value ok? | Série diária (`values[]`)? | Breakdown | Range máx/request | Retenção | Vazio observado? | Dedup na janela? (únicos) | Plano B |
|---|---|---|---|---|---|---|---|---|
| reach | ok — 200, `value` presente (21176/31d, 21019/chunk30, 579/chunk1) | sim — 4 valores, 1/dia (probe sem `metric_type`, Aug28-31) | — (não testado) | 31d aceito num único request (200) — chunking de produção pode ser desnecessário | testado só p/ reach: janela ~170-200d atrás (Jan-Fev/2026) devolveu 200 com `value=7832`, NÃO vazia — retenção real é maior que os 90d supostos, limite exato não confirmado | não (nem diário nem fora-da-retenção vieram vazios) | **NÃO** — 31d único (21176) ≈ chunk30+chunk1 (21598, só +2%); ambos ~2,06x o valor do app (10.281). Sugere que mesmo o request único não dedupe entre dias, e sim soma valores diários | bloqueado — sem caminho comprovado pra reach mensal deduplicado por este endpoint; decisão para o checkpoint com Eduardo |
| views | ok (produção) — 200, 47625/31d, 46129/chunk30 (bate exato com os 46.129 do app), 1496/chunk1 | não — probe cru devolveu `data: []`; só `metric_type=total_value` funciona, série diária exigiria 1 request por dia | — | 31d aceito num único request; chunk30+chunk1 = 47625 = single 31d exato → aditiva, chunking hoje é opcional | 90d (suposição original da spec; não retestada neste spike) | sim (na série diária crua) | n/a (aditiva) — soma bate exata, e chunk30 sozinho já bate com o número do app | — |
| saves | ok — 200, 55/31d, 51/chunk30, 4/chunk1, soma bate exato | não — `data: []` no probe cru | — | 31d aceito num único request; aditiva (soma exata) | não testada neste spike | sim (série diária crua) | n/a (aditiva, soma exata) | — |
| accounts_engaged | ok — 200, 240/31d, 231/chunk30, 15/chunk1 | não — `data: []` no probe cru | — | 31d aceito num único request | não testada neste spike | sim (série diária crua) | **NÃO/parcial** — chunk30+chunk1 (246) > single 31d (240), +2,5% — mesmo padrão de "soma sem dedup real" do reach, em escala menor | mesma pendência do reach — não tratar como mensal deduplicado; decisão no checkpoint |
| profile_views | ok, nome confirmado = `profile_views` — 200, 1463/31d, 1427/chunk30, 36/chunk1, soma bate exato | não — `data: []` no probe cru | — | 31d aceito num único request; aditiva (soma exata) | não testada neste spike | sim (série diária crua) | n/a (aditiva, soma exata) | — |
| website_clicks | ok — 200, 175/31d, 171/chunk30, 4/chunk1, soma bate exato | não — `data: []` no probe cru | — | 31d aceito num único request; aditiva (soma exata) | não testada neste spike | sim (série diária crua) | n/a (aditiva, soma exata) | — |
| follows_and_unfollows | **NÃO sem breakdown** — 200, mas `total_value` ausente do body (nem zero: o campo não existe) em 31d/chunk30/chunk1; só vem com `breakdown` | não — `data: []` mesmo sem breakdown | `follow_type` funciona (200, `FOLLOWER=122`/`NON_FOLLOWER=68`); `follower_type` falha (400: "breakdown[0] must be one of the following values: country, city, age, gender, follow_type, media_product_type, contact_button_type") | 31d aceito com breakdown | não testada neste spike | sim (`total_value` sem breakdown e série diária) | n/a | usar sempre `breakdown=follow_type`; mapear `FOLLOWER`/`NON_FOLLOWER` pra follows/unfollows precisa confirmação — os números (122/68) batem aproximadamente com o app (115/66 follows/unfollows), mas as janelas são diferentes (calendário vs 30d rolante), não é prova definitiva |
| follower_count | n/a (não testado neste spike — só probe diário) | sim — 30 valores, 1/dia (Aug2-Aug31), **mas os valores parecem DELTA diário** (0 a 8) e não estoque acumulado, apesar do título "Número de seguidores" — achado inesperado | — | 30d testado (não testamos janela maior) | ~30d (mantido, não retestada) | não | n/a | history atual (mantido) — mas o módulo precisa tratar os valores diários como delta, não como snapshot |

Latência de finalização de D-1 (para calibrar a janela D-1..D-3): **pendente: repetir probe g em D+1** (valor capturado em 2026-08-31 para D-1=31/08: `views total_value = 1496`; repetir a chamada no dia seguinte e comparar se o valor mudou)
Reach 01–31/08 Healing Hands, caminho de produção (chunk30+chunk1): **21598** · request único 31d: **21176** · app: 10.281 — paridade NÃO bate (ambos os caminhos ~2,06-2,10x o valor do app)

---

# FASE 0 — Spike de validação

### Task 1: Function temporária de spike

**Files:**
- Create: `supabase/functions/metrics-spike/index.ts`

**Interfaces:**
- Produces: endpoint HTTP temporário `POST /metrics-spike` (header `x-spike-secret`) que devolve JSON com todos os probes da matriz para a conta Healing Hands. NÃO entra em nenhum outro código; será DELETADO na Task 3.

- [ ] **Step 1: Escrever a function**

```ts
// supabase/functions/metrics-spike/index.ts
// TEMPORÁRIA — spike da spec 2026-08-31-report-app-parity. Deletar após a matriz.
// Auth: header x-spike-secret contra env SPIKE_SECRET (mesmo padrão dos crons).
import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptText } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SPIKE_SECRET = Deno.env.get("SPIKE_SECRET") ??
  (() => { throw new Error("SPIKE_SECRET is required"); })();
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ??
  (() => { throw new Error("TOKEN_ENCRYPTION_KEY is required"); })();

const ACCOUNT_ID = "b7a4333d-df8e-48f7-b3d8-94440691ea71"; // Healing Hands

const DAY = 86400;

async function decryptIgToken(encrypted: string): Promise<string> {
  // Mesma dupla de chaves de report-docs/snapshot-source.ts (HKDF + legado).
  try {
    return await decryptText(encrypted, TOKEN_ENCRYPTION_KEY, "instagram-access-token");
  } catch {
    const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(TOKEN_ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32)),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(buf);
  }
}

async function graph(token: string, qs: Record<string, string>) {
  const params = new URLSearchParams({ ...qs, access_token: token });
  const url = `https://graph.instagram.com/me/insights?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-spike-secret") !== SPIKE_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: account } = await db.from("instagram_accounts")
    .select("encrypted_access_token").eq("id", ACCOUNT_ID).single();
  const token = await decryptIgToken(account!.encrypted_access_token);

  // Janela do mês de agosto/2026, half-open em unix seconds.
  const aug1 = Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000);
  const sep1 = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000);
  const aug31 = sep1 - DAY;

  const METRICS = [
    "reach", "views", "saves", "accounts_engaged", "profile_views",
    "website_clicks", "follows_and_unfollows",
  ];

  const out: Record<string, unknown> = {};
  for (const m of METRICS) {
    // a) total_value, request único de 31 dias (range máximo? aceita?)
    out[`${m}_total_31d`] = await graph(token, {
      metric: m, metric_type: "total_value", period: "day",
      since: String(aug1), until: String(sep1),
    });
    // b) caminho de produção atual: chunks 30+1 (não-aditividade dos únicos)
    out[`${m}_total_chunk30`] = await graph(token, {
      metric: m, metric_type: "total_value", period: "day",
      since: String(aug1), until: String(aug1 + 30 * DAY),
    });
    out[`${m}_total_chunk1`] = await graph(token, {
      metric: m, metric_type: "total_value", period: "day",
      since: String(aug1 + 30 * DAY), until: String(sep1),
    });
    // c) série diária (existe values[] por dia para esta métrica?)
    out[`${m}_daily`] = await graph(token, {
      metric: m, period: "day", since: String(aug31 - 3 * DAY), until: String(sep1),
    });
  }
  // d) breakdown de follows (nome: follow_type? follower_type?)
  out["follows_breakdown_follow_type"] = await graph(token, {
    metric: "follows_and_unfollows", metric_type: "total_value", period: "day",
    breakdown: "follow_type", since: String(aug1), until: String(sep1),
  });
  out["follows_breakdown_follower_type"] = await graph(token, {
    metric: "follows_and_unfollows", metric_type: "total_value", period: "day",
    breakdown: "follower_type", since: String(aug1), until: String(sep1),
  });
  // e) follower_count diário (retenção ~30d)
  out["follower_count_daily"] = await graph(token, {
    metric: "follower_count", period: "day",
    since: String(sep1 - 30 * DAY), until: String(sep1),
  });
  // f) fora da retenção (vazio vs erro — semântica de "indisponível")
  out["reach_out_of_retention"] = await graph(token, {
    metric: "reach", metric_type: "total_value", period: "day",
    since: String(aug1 - 200 * DAY), until: String(aug1 - 170 * DAY),
  });
  // g) D-1 para medir latência de finalização (chamar de novo amanhã e comparar)
  out["finalization_probe_d1"] = await graph(token, {
    metric: "views", metric_type: "total_value", period: "day",
    since: String(sep1 - DAY), until: String(sep1),
  });

  return new Response(JSON.stringify(out, null, 2), {
    headers: { "content-type": "application/json" },
  });
});
```

- [ ] **Step 2: Setar SPIKE_SECRET sem passar literal na CLI**

```bash
SCRATCH=/private/tmp/claude-501/*/*/scratchpad; SCRATCH=$(echo $SCRATCH | awk '{print $1}')
openssl rand -hex 24 > "$SCRATCH/spike-secret.txt"
printf 'SPIKE_SECRET=%s\n' "$(cat "$SCRATCH/spike-secret.txt")" > "$SCRATCH/spike.env"
npx supabase secrets set --env-file "$SCRATCH/spike.env"
```

- [ ] **Step 3: Deploy**

```bash
cat supabase/.temp/project-ref   # DEVE ser skjzpekeqefvlojenfsw
npx supabase functions deploy metrics-spike --use-api --no-verify-jwt
git checkout -- deno.lock 2>/dev/null; ls node_modules/.deno 2>/dev/null && npm ci
```

- [ ] **Step 4: Commit (a function é temporária mas versionada enquanto vive)**

```bash
git add supabase/functions/metrics-spike/index.ts
git commit -m "spike: function temporária para matriz de capacidades da Graph"
```

### Task 2: Executar os probes e preencher a matriz

**Files:**
- Modify: `docs/superpowers/plans/2026-08-31-report-app-parity.md` (a tabela da matriz, acima)

- [ ] **Step 1: Invocar e salvar o resultado**

```bash
SCRATCH=$(dirname "$(ls /private/tmp/claude-501/*/*/scratchpad/spike-secret.txt)")
curl -sS -X POST \
  -H "x-spike-secret: $(cat "$SCRATCH/spike-secret.txt")" \
  "https://skjzpekeqefvlojenfsw.supabase.co/functions/v1/metrics-spike" \
  > "$SCRATCH/spike-result.json"
python3 -m json.tool "$SCRATCH/spike-result.json" | head -100
```

- [ ] **Step 2: Preencher a matriz no topo deste plano**

Para cada métrica, ler as respostas e registrar: status HTTP, se `total_value.value`
veio, se a série diária traz `values[]` com um valor por dia, o breakdown que
funcionou (`follow_type` vs `follower_type`), o que "fora da retenção" devolveu
(conjunto vazio? erro? — vazio DEVE virar null no módulo), e:

- **Teste central do reach:** `reach_total_31d` == 10.281 do app? E
  `reach_total_chunk30 + reach_total_chunk1` — quanto maior que o request único?
  Registrar os três números na linha da matriz.
- Repetir `finalization_probe_d1` no dia seguinte (ou algumas horas depois) e
  registrar se o valor de D-1 mudou.

- [ ] **Step 3: Commit da matriz preenchida**

```bash
git add docs/superpowers/plans/2026-08-31-report-app-parity.md
git commit -m "spike: matriz de capacidades da Graph preenchida"
```

### Task 3: Teardown do spike + CHECKPOINT com o Eduardo

- [ ] **Step 1: Deletar function e secret**

```bash
npx supabase functions delete metrics-spike
printf 'SPIKE_SECRET=\n' > /dev/null  # secret:
npx supabase secrets unset SPIKE_SECRET
git rm -r supabase/functions/metrics-spike
git commit -m "spike: remove function temporária (matriz registrada no plano)"
rm -f "$SCRATCH/spike-secret.txt" "$SCRATCH/spike.env"
```

- [ ] **Step 2: GATE — parar e apresentar ao Eduardo**

Apresentar a matriz e as decisões que ela sela, no mínimo:
1. Reach bate com o app (request único)? Se não: card vira "Alcance acumulado"
   com tooltip, e a spec §3.1 é emendada ANTES de seguir.
2. Nome real de profile_views; breakdown real de follows.
3. Quais métricas NÃO têm série diária → ficam fora de `fetchAccountDaily` e
   das colunas `*_day` (plano B da matriz).
4. Latência de finalização → largura da janela de reconsulta (default D-1..D-3).

**NÃO iniciar a Fase 1 sem o ok explícito.** Se a matriz contradisser a spec,
emendar spec + tasks abaixo primeiro (os nomes de métrica/colunas nas Fases 1-3
assumem a matriz "esperada"; ajustar é buscar-e-substituir dirigido pela matriz).

---

# FASE 1 — Módulo compartilhado de métricas de conta

### Task 4: `_shared/instagram-account-metrics.ts` + testes

**Files:**
- Create: `supabase/functions/_shared/instagram-account-metrics.ts`
- Test: `supabase/functions/__tests__/instagram-account-metrics.test.ts`
- Modify: `supabase/functions/instagram-analytics/views.ts` (reexporta a matemática, não duplica)

**Interfaces:**
- Consumes: `parseViewsRange`/`chunkRange` de `instagram-analytics/views.ts` (matemática de janela existente; move-se para o módulo novo e views.ts reexporta).
- Produces (Fases 2-5 dependem EXATAMENTE destes nomes):

```ts
export type AccountMetric =
  | "reach" | "views" | "saves" | "accounts_engaged"
  | "profile_views" | "website_clicks" | "follows_and_unfollows";

export const UNIQUE_METRICS: ReadonlySet<AccountMetric>; // {"reach","accounts_engaged"}

export interface FollowsBreakdown { follows: number; unfollows: number; net: number }

export interface AccountTotals {
  reach: number | null;
  views: number | null;
  saves: number | null;
  accounts_engaged: number | null;
  profile_views: number | null;
  website_clicks: number | null;
  follows_and_unfollows: FollowsBreakdown | null;
}

export async function fetchAccountTotals(
  fetchFn: typeof fetch, accessToken: string, metrics: AccountMetric[],
  sinceSec: number, untilSec: number,
): Promise<Partial<AccountTotals>>;

// date key = "YYYY-MM-DD" UTC. Só métricas COM série diária na matriz.
export interface DailyValues {
  reach: number | null; views: number | null; saves: number | null;
  accounts_engaged: number | null; profile_views: number | null;
  website_clicks: number | null; follows: number | null; unfollows: number | null;
}
export async function fetchAccountDaily(
  fetchFn: typeof fetch, accessToken: string, metrics: AccountMetric[],
  sinceSec: number, untilSec: number,
): Promise<Map<string, Partial<DailyValues>>>;

export async function fetchFollowerCountDaily(
  fetchFn: typeof fetch, accessToken: string, sinceSec: number, untilSec: number,
): Promise<Map<string, number>>; // retenção ~30d; datas "YYYY-MM-DD"
```

Regras de implementação (da spec §4.1, não-negociáveis):
- Resposta com conjunto de dados VAZIO → null (nunca 0).
- Erro `code: 190` → `throw { code: "TOKEN_EXPIRED", ... }` (padrão views.ts).
- `fetchAccountTotals` para métricas em `UNIQUE_METRICS`: UM request cobrindo a
  janela inteira; janela maior que o range máximo da matriz → aquele campo = null.
  Métricas aditivas: chunking de 30d somado (comportamento atual de
  `sumViewsRange`).
- `follows_and_unfollows` com o breakdown validado na matriz; normalizar para
  `FollowsBreakdown` com `net = follows - unfollows`.
- Uma chamada Graph por métrica, `Promise.all`, timeout 10s por request; falha
  de UMA métrica → aquele campo null, nunca exceção pro chamador (exceto
  TOKEN_EXPIRED, que sobe).

- [ ] **Step 1: Escrever os testes que travam as regras** (fetch mockado; casos: vazio→null; 190→TOKEN_EXPIRED sobe; única em janela >max→null e NUNCA dois requests; aditiva 31d→2 chunks somados; breakdown follows normalizado; falha de uma métrica não derruba as outras)

```ts
// supabase/functions/__tests__/instagram-account-metrics.test.ts
import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  fetchAccountTotals, fetchAccountDaily, UNIQUE_METRICS,
} from "../_shared/instagram-account-metrics.ts";

const DAY = 86400;
const T0 = Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000);

function fakeFetch(handler: (url: URL) => unknown): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const body = handler(url);
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
}

Deno.test("conjunto vazio normaliza para null, nunca 0", async () => {
  const f = fakeFetch(() => ({ data: [] }));
  const r = await fetchAccountTotals(f, "tok", ["saves"], T0, T0 + 31 * DAY);
  assertEquals(r.saves, null);
});

Deno.test("métrica de únicos: um único request para a janela inteira", async () => {
  const calls: string[] = [];
  const f = fakeFetch((url) => {
    calls.push(`${url.searchParams.get("since")}-${url.searchParams.get("until")}`);
    return { data: [{ name: "reach", total_value: { value: 10281 } }] };
  });
  const r = await fetchAccountTotals(f, "tok", ["reach"], T0, T0 + 31 * DAY);
  assertEquals(r.reach, 10281);
  assertEquals(calls.length, 1); // NUNCA chunkado
});

Deno.test("métrica aditiva 31d: chunks somados", async () => {
  const f = fakeFetch(() => ({ data: [{ name: "views", total_value: { value: 100 } }] }));
  const r = await fetchAccountTotals(f, "tok", ["views"], T0, T0 + 31 * DAY);
  assertEquals(r.views, 200); // 2 chunks (30+1) de 100
});

Deno.test("falha de uma métrica não derruba as outras", async () => {
  const f = fakeFetch((url) =>
    url.searchParams.get("metric") === "saves"
      ? { error: { message: "boom" } }
      : { data: [{ name: "views", total_value: { value: 7 } }] });
  const r = await fetchAccountTotals(f, "tok", ["views", "saves"], T0, T0 + DAY);
  assertEquals(r.views, 7);
  assertEquals(r.saves, null);
});

Deno.test("erro 190 sobe como TOKEN_EXPIRED", async () => {
  const f = fakeFetch(() => ({ error: { code: 190, message: "expired" } }));
  await assertRejects(() => fetchAccountTotals(f, "tok", ["views"], T0, T0 + DAY));
});

Deno.test("fetchAccountDaily indexa por dia UTC", async () => {
  const f = fakeFetch(() => ({
    data: [{
      name: "views",
      values: [
        { end_time: "2026-08-02T07:00:00+0000", value: 5 },
        { end_time: "2026-08-03T07:00:00+0000", value: 9 },
      ],
    }],
  }));
  const m = await fetchAccountDaily(f, "tok", ["views"], T0, T0 + 3 * DAY);
  assertEquals(m.get("2026-08-01")?.views, 5); // end_time = fim do dia anterior
});
```

Nota do último teste: a convenção `end_time`→dia é a que a MATRIZ do spike
documentar (a Graph reporta o fim do período; confirmar o offset real no JSON do
spike e ajustar o teste ao fato, não o contrário).

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:functions -- --filter "instagram-account-metrics"` (filter casa com NOME de teste; se não filtrar, rodar a suíte inteira). Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o módulo** — mover `VIEWS_WINDOW_DAYS`, `VIEWS_CHUNK_DAYS`, `parseViewsRange`, `chunkRange` de views.ts para cá (views.ts importa e reexporta para não quebrar consumidores); implementar as três funções conforme Interfaces acima. `sumViewsRange`/`fetchViewsTotal` viram o caso aditivo interno.

- [ ] **Step 4: Rodar testes do módulo + suíte inteira de functions** — `npm run test:functions`. Expected: PASS (incluindo os testes existentes de views).

- [ ] **Step 5: Commit** — `git add -A supabase/functions && git checkout -- deno.lock && git commit -m "feat(metrics): módulo compartilhado de métricas de conta da Graph"`

---

# FASE 2 — Migrations + RPC

### Task 5: Migrations (colunas, tabela mensal, backfill, RPC)

**Files:**
- Create: `supabase/migrations/<VERSAO>_account_metrics_parity.sql` (UMA migration; versão acima do tail de origin/main — conferir na hora)

**Interfaces:**
- Produces: colunas `instagram_account_metrics_daily.{reach_day,views_day,saves_day,accounts_engaged_day,profile_views_day,website_clicks_day,follows_day,unfollows_day,accounts_engaged_28d}`; tabela `instagram_account_metrics_monthly`; colunas `instagram_accounts.{metrics_backfilled_at,metrics_backfill_cursor}`; RPC `upsert_metrics_daily(p_rows jsonb)`.

- [ ] **Step 1: Verificar o tail e criar a migration**

```bash
git fetch origin main && git ls-tree origin/main:supabase/migrations | tail -5
```

```sql
-- <VERSAO>_account_metrics_parity.sql
-- Spec: docs/superpowers/specs/2026-08-31-report-app-parity-design.md §4.2

-- 1) Valores POR-DIA (dias completos; null = indisponível naquele dia)
ALTER TABLE instagram_account_metrics_daily
  ADD COLUMN IF NOT EXISTS reach_day integer,
  ADD COLUMN IF NOT EXISTS views_day integer,
  ADD COLUMN IF NOT EXISTS saves_day integer,
  ADD COLUMN IF NOT EXISTS accounts_engaged_day integer,
  ADD COLUMN IF NOT EXISTS profile_views_day integer,
  ADD COLUMN IF NOT EXISTS website_clicks_day integer,
  ADD COLUMN IF NOT EXISTS follows_day integer,
  ADD COLUMN IF NOT EXISTS unfollows_day integer,
  -- correção do mapeamento: accounts_engaged ganha coluna própria (28d móvel)
  ADD COLUMN IF NOT EXISTS accounts_engaged_28d integer;

-- 2) Agregado FECHADO do mês (única forma paritária de histórico p/ métricas
--    de únicos além dos 90d da Meta)
CREATE TABLE IF NOT EXISTS instagram_account_metrics_monthly (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instagram_account_id uuid NOT NULL
    REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  month date NOT NULL,                    -- sempre dia 1 do mês
  reach_month integer,
  views_month integer,
  saves_month integer,
  accounts_engaged_month integer,
  profile_views_month integer,
  website_clicks_month integer,
  follows_month integer,
  unfollows_month integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id, month)
);
ALTER TABLE instagram_account_metrics_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON instagram_account_metrics_monthly
  FOR ALL USING (auth.role() = 'service_role');

-- 3) Estado do backfill (seletor + checkpoint; spec §4.2.3) + a coluna 28d
--    que a Task 6 também grava em instagram_accounts (o update da conta
--    escreve as *_28d nos DOIS lugares, como as quatro existentes — sem esta
--    coluna aqui, todo sync falharia com missing column; achado Codex P1)
ALTER TABLE instagram_accounts
  ADD COLUMN IF NOT EXISTS metrics_backfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS metrics_backfill_cursor date,
  ADD COLUMN IF NOT EXISTS accounts_engaged_28d integer;

-- 4) Upsert atômico que preserva valor: não-null novo vence (reconsulta da
--    janela móvel), null NUNCA apaga valor válido. supabase-js .upsert() não
--    expressa COALESCE; read-before-write teria corrida entre execuções.
CREATE OR REPLACE FUNCTION upsert_metrics_daily(p_rows jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO instagram_account_metrics_daily AS t (
    instagram_account_id, snapshot_date,
    reach_day, views_day, saves_day, accounts_engaged_day,
    profile_views_day, website_clicks_day, follows_day, unfollows_day
  )
  SELECT
    (r->>'instagram_account_id')::uuid,
    (r->>'snapshot_date')::date,
    (r->>'reach_day')::integer, (r->>'views_day')::integer,
    (r->>'saves_day')::integer, (r->>'accounts_engaged_day')::integer,
    (r->>'profile_views_day')::integer, (r->>'website_clicks_day')::integer,
    (r->>'follows_day')::integer, (r->>'unfollows_day')::integer
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (instagram_account_id, snapshot_date) DO UPDATE SET
    reach_day            = COALESCE(EXCLUDED.reach_day, t.reach_day),
    views_day            = COALESCE(EXCLUDED.views_day, t.views_day),
    saves_day            = COALESCE(EXCLUDED.saves_day, t.saves_day),
    accounts_engaged_day = COALESCE(EXCLUDED.accounts_engaged_day, t.accounts_engaged_day),
    profile_views_day    = COALESCE(EXCLUDED.profile_views_day, t.profile_views_day),
    website_clicks_day   = COALESCE(EXCLUDED.website_clicks_day, t.website_clicks_day),
    follows_day          = COALESCE(EXCLUDED.follows_day, t.follows_day),
    unfollows_day        = COALESCE(EXCLUDED.unfollows_day, t.unfollows_day);
$$;
-- REVOKE/GRANT: função é SECURITY DEFINER chamada só pelo service role.
REVOKE ALL ON FUNCTION upsert_metrics_daily(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_metrics_daily(jsonb) TO service_role;
```

(Gotcha do REVOKE: `REVOKE FROM PUBLIC` também derruba service_role — por isso
o GRANT explícito logo abaixo, na MESMA migration.)

Se a matriz do spike disser que alguma métrica NÃO tem série diária: remover a
coluna `*_day` correspondente daqui e do RPC (dirigido pela matriz).

- [ ] **Step 2: Aplicar em staging e verificar**

```bash
cat supabase/.temp/project-ref   # trocar o link para STAGING antes: wlyzhyfondykzpsiqsce
npx supabase link --project-ref wlyzhyfondykzpsiqsce
npx supabase db push --linked
npx supabase db query --linked "select column_name from information_schema.columns where table_name='instagram_account_metrics_daily' and column_name like '%_day'"
npx supabase db query --linked "select proname from pg_proc where proname='upsert_metrics_daily'"
```

- [ ] **Step 3: Testar a semântica COALESCE direto no banco de staging**

```bash
npx supabase db query --linked "
  select upsert_metrics_daily('[{\"instagram_account_id\":\"00000000-0000-0000-0000-000000000001\",\"snapshot_date\":\"2026-08-01\",\"views_day\":10}]'::jsonb);
"
```
(usar um id real de staging; depois upsert com `views_day: null` + `reach_day: 5`
e conferir que views_day CONTINUA 10 e reach_day virou 5; por fim `delete` da
linha de teste.)

- [ ] **Step 4: Relinkar em PROD (sem push ainda — prod entra no rollout, Fase 7)**

```bash
npx supabase link --project-ref skjzpekeqefvlojenfsw
```

- [ ] **Step 5: Commit** — `git add supabase/migrations && git commit -m "feat(metrics): migrations de paridade (colunas por-dia, mensal, backfill, RPC)"`

---

# FASE 3 — Sync cron

### Task 6: Correção do mapeamento 28d + ingestão diária D-1..D-3

**Files:**
- Modify: `supabase/functions/instagram-sync-cron/index.ts:125-238` (bloco de insights + upserts)
- Test: `supabase/functions/__tests__/instagram-sync-cron-daily.test.ts` (novo; a lógica extraída para função pura)
- Create: `supabase/functions/instagram-sync-cron/daily-ingest.ts`

**Interfaces:**
- Consumes: `fetchAccountDaily` (Task 4), RPC `upsert_metrics_daily` (Task 5).
- Produces: `buildDailyRows(accountId: string, daily: Map<string, Partial<DailyValues>>): DailyRow[]` (pura, testável) e `ingestClosedDays(db, fetchFn, accountId, accessToken, nowSec): Promise<void>` em `daily-ingest.ts`.

- [ ] **Step 1: Teste da função pura**

```ts
// supabase/functions/__tests__/instagram-sync-cron-daily.test.ts
import { assertEquals } from "jsr:@std/assert";
import { buildDailyRows } from "../instagram-sync-cron/daily-ingest.ts";

Deno.test("buildDailyRows mapeia métricas para colunas *_day", () => {
  const daily = new Map([
    ["2026-08-29", { views: 100, reach: 40, follows: 3, unfollows: 1 }],
    ["2026-08-30", { views: null, saves: 2 }],
  ]);
  const rows = buildDailyRows("acc-1", daily);
  assertEquals(rows[0], {
    instagram_account_id: "acc-1", snapshot_date: "2026-08-29",
    reach_day: 40, views_day: 100, saves_day: null, accounts_engaged_day: null,
    profile_views_day: null, website_clicks_day: null, follows_day: 3, unfollows_day: 1,
  });
  assertEquals(rows[1].views_day, null); // null preservado (COALESCE no banco decide)
});
```

- [ ] **Step 2: Rodar (FAIL), implementar `daily-ingest.ts`**

```ts
// supabase/functions/instagram-sync-cron/daily-ingest.ts
// Ingestão de DIAS FECHADOS (D-1..D-3 UTC) nas colunas *_day, via RPC
// upsert_metrics_daily (COALESCE: null nunca apaga; não-null novo vence —
// é a reconsulta corrigindo insights revisados pela Meta). Spec §4.2.1.
import {
  type AccountMetric, type DailyValues, fetchAccountDaily,
} from "../_shared/instagram-account-metrics.ts";

const DAY = 86400;
export const CLOSED_DAYS_WINDOW = 3; // calibrado pelo spike §3.3

// Métricas com série diária confirmada na matriz do spike (ajustar lá).
const DAILY_METRICS: AccountMetric[] = [
  "reach", "views", "saves", "accounts_engaged",
  "profile_views", "website_clicks", "follows_and_unfollows",
];

export interface DailyRow {
  instagram_account_id: string;
  snapshot_date: string;
  reach_day: number | null; views_day: number | null; saves_day: number | null;
  accounts_engaged_day: number | null; profile_views_day: number | null;
  website_clicks_day: number | null; follows_day: number | null;
  unfollows_day: number | null;
}

export function buildDailyRows(
  accountId: string, daily: Map<string, Partial<DailyValues>>,
): DailyRow[] {
  return [...daily.entries()].map(([date, v]) => ({
    instagram_account_id: accountId, snapshot_date: date,
    reach_day: v.reach ?? null, views_day: v.views ?? null,
    saves_day: v.saves ?? null, accounts_engaged_day: v.accounts_engaged ?? null,
    profile_views_day: v.profile_views ?? null,
    website_clicks_day: v.website_clicks ?? null,
    follows_day: v.follows ?? null, unfollows_day: v.unfollows ?? null,
  }));
}

// deno-lint-ignore no-explicit-any
export async function ingestClosedDays(
  db: any, fetchFn: typeof fetch, accountId: string, accessToken: string,
  nowSec: number,
): Promise<void> {
  const todayStart = Math.floor(nowSec / DAY) * DAY;
  const since = todayStart - CLOSED_DAYS_WINDOW * DAY; // D-3 00:00Z
  const until = todayStart;                            // hoje 00:00Z (exclusivo)
  const daily = await fetchAccountDaily(fetchFn, accessToken, DAILY_METRICS, since, until);
  const rows = buildDailyRows(accountId, daily);
  if (rows.length === 0) return;
  const { error } = await db.rpc("upsert_metrics_daily", { p_rows: rows });
  if (error) console.warn(`[IG-SYNC-CRON] upsert_metrics_daily failed: ${error.message}`);
}
```

- [ ] **Step 3: Corrigir o mapeamento 28d em `index.ts`** — no bloco 148-169: renomear as variáveis para o que elas SÃO (`totalViews` = métrica `views`; `totalEngaged` = `accounts_engaged`) e nos dois upserts (linhas ~209-237) gravar `impressions_28d: totalViews` (mantém, é views mesmo), `accounts_engaged_28d: totalEngaged`, e `profile_views_28d`: buscar a métrica de profile views REAL (nome da matriz; request adicional igual aos outros quatro). Chamar `await ingestClosedDays(supabase, fetch, account.id, accessToken, Math.floor(Date.now()/1000))` logo após os upserts existentes (falha só loga, nunca derruba o sync da conta).

- [ ] **Step 4: Rodar suítes** — `npm run test:functions`. Expected: PASS. Os testes existentes do cron que asserem o shape antigo dos upserts quebram: atualizá-los JUNTO (grep `profile_views_28d` em `supabase/functions/__tests__/`).

- [ ] **Step 5: Commit** — `git commit -m "feat(sync-cron): corrige mapeamento 28d e ingere dias fechados D-1..D-3"`

### Task 7: Fechamento mensal

**Files:**
- Create: `supabase/functions/instagram-sync-cron/monthly-close.ts`
- Test: `supabase/functions/__tests__/instagram-sync-cron-monthly.test.ts`

(A LIGAÇÃO no index.ts acontece na Task 8, no passo de MANUTENÇÃO — nunca no
caminho por-conta do sync: o seletor do sync exclui workspaces sem
`feature_auto_sync_cron`, e uma conta com relatórios mas sem auto-sync ficaria
para sempre sem agregados mensais, perdendo o histórico de reach/engaged após
os 90d de retenção. Achado Codex P1.)

**Interfaces:**
- Consumes: `fetchAccountTotals` (Task 4), tabela `instagram_account_metrics_monthly` (Task 5), `CLOSED_DAYS_WINDOW` (Task 6).
- Produces: `closePreviousMonthIfMissing(db, fetchFn, accountId, accessToken, nowSec): Promise<void>` — idempotente: se a linha do mês anterior já existe, retorna sem chamada Graph. **Janela de finalização:** NÃO fecha o mês antes de `nowSec >= início do mês corrente + CLOSED_DAYS_WINDOW dias` — fechar no tick 1 do dia 1 congelaria dados que a Meta ainda revisa (mesma razão da janela D-1..D-3 da ingestão diária; achado Codex P1). Antes disso, retorna sem fazer nada; a linha só nasce depois que os dados do fim do mês estabilizaram.

- [ ] **Step 1: Teste** (db mock: 1º caso linha existente → zero chamadas Graph; 2º caso dia 1-3 do mês → zero chamadas Graph e NENHUMA linha (janela de finalização); 3º caso dia 4+, linha ausente → insere com os valores do fetch; 4º caso mês anterior fora da retenção → NÃO insere linha de nulls)

```ts
import { assertEquals } from "jsr:@std/assert";
import { closePreviousMonthIfMissing } from "../instagram-sync-cron/monthly-close.ts";

Deno.test("não refaz mês já fechado", async () => {
  let graphCalls = 0;
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () =>
      Promise.resolve({ data: { id: 1 } }) }) }) }) }),
  };
  const f = (() => { graphCalls++; }) as unknown as typeof fetch;
  // Dia 5: já FORA da janela de finalização — o zero de chamadas aqui prova
  // a idempotência (linha existe), não a janela.
  await closePreviousMonthIfMissing(db, f, "acc", "tok",
    Math.floor(Date.parse("2026-09-05T12:00:00Z") / 1000));
  assertEquals(graphCalls, 0);
});
```

- [ ] **Step 2: Implementar** — ordem das guardas: (1) janela de finalização (`nowSec < início do mês corrente + CLOSED_DAYS_WINDOW dias` → return, nada de Graph); (2) mês anterior fora da retenção de 90d (aritmética local, sem Graph → return); (3) linha já existe → return sem Graph; (4) `fetchAccountTotals` em `monthWindow(prevMonthOf(mesCorrente))` (helpers de `_shared/report-docs/month-window.ts`) e inserir a linha só se AO MENOS uma métrica veio não-null (tudo null = não inventar número, sem linha; a guarda (2) evita retentar para sempre um mês irrecuperável).

- [ ] **Step 3: Rodar testes (PASS) e commit** — `git commit -m "feat(sync-cron): fecha agregado mensal por conta"`

### Task 8: Backfill durável com seletor, orçamento e cursor

**Files:**
- Create: `supabase/functions/instagram-sync-cron/backfill.ts`
- Modify: `supabase/functions/instagram-sync-cron/index.ts` (passo separado ANTES do batch de sync)
- Test: `supabase/functions/__tests__/instagram-sync-cron-backfill.test.ts`

**Interfaces:**
- Consumes: `fetchAccountDaily`, `fetchFollowerCountDaily` (Task 4), RPC (Task 5), colunas `metrics_backfilled_at`/`metrics_backfill_cursor` (Task 5).
- Produces: `runBackfillStep(db, fetchFn, decryptToken, opts: { batchLimit: number; chunksPerAccount: number; nowSec: number }): Promise<{ accounts: number; chunks: number }>`.

Regras (spec §4.2.3):
- Seletor PRÓPRIO: `authorization_status='active'` + `encrypted_access_token` não-null + `metrics_backfilled_at is null`, ordenado por `id`. Independente de `auto_sync_enabled` e de `feature_auto_sync_cron`.
- Orçamento próprio: `BACKFILL_BATCH_LIMIT` (default 3 contas/tick) × `chunksPerAccount` (default 1 chunk de 30d por conta por tick) — nunca competir com o wall-clock do sync.
- Anda do presente para trás: 1º chunk = `[hoje-30d, hoje)`; cursor = dia mais antigo já ingerido; próximo chunk termina no cursor. `metrics_backfilled_at = now()` quando o cursor cruzar `hoje - 90d`.
- `fetchFollowerCountDaily` roda no primeiro chunk (retenção ~30d) e alimenta `instagram_follower_history` com upsert que respeita `source='manual'` (mesma checagem do sync atual).
- Execução morta retoma do cursor (upserts idempotentes).

- [ ] **Step 1: Teste da progressão do cursor**

```ts
import { assertEquals } from "jsr:@std/assert";
import { nextChunk } from "../instagram-sync-cron/backfill.ts";

const DAY = 86400;
const NOW = Math.floor(Date.parse("2026-09-01T12:00:00Z") / 1000);

Deno.test("primeiro chunk parte de hoje-30d", () => {
  const c = nextChunk(null, NOW);
  assertEquals(c, {
    sinceSec: Math.floor(NOW / DAY) * DAY - 30 * DAY,
    untilSec: Math.floor(NOW / DAY) * DAY,
    done: false,
  });
});

Deno.test("cursor além do horizonte de 90d encerra", () => {
  const c = nextChunk("2026-06-02", NOW); // ~91 dias atrás
  assertEquals(c.done, true);
});
```

- [ ] **Step 2: Implementar `backfill.ts`** (função pura `nextChunk(cursor: string | null, nowSec)` + `runBackfillStep` que: seleciona contas, descriptografa token — reusar o decrypt já existente no index do cron —, chama `fetchAccountDaily` no chunk, RPC, atualiza cursor; em `done`, grava `metrics_backfilled_at`). TOKEN_EXPIRED → marca `authorization_status='expired'` e pula (não retém a fila).

- [ ] **Step 3: Ligar no `index.ts`** — passo separado no começo do handler do cron, com try/catch próprio (falha do backfill nunca impede o sync batch), logando `{ accounts, chunks }`.

- [ ] **Step 4: Rodar suítes (PASS) e commit** — `git commit -m "feat(sync-cron): backfill 90d durável com cursor e orçamento próprio"`

---

# FASE 4 — Relatório de blocos

### Task 9: `kpis.ts` novo contrato

**Files:**
- Modify: `supabase/functions/_shared/report-docs/kpis.ts` (reescrita das fontes)
- Test: `supabase/functions/_shared/report-docs/kpis.test.ts` (reescrita dirigida)

**Interfaces:**
- Consumes: nada novo em runtime (função pura; quem busca é snapshot-source, Task 10).
- Produces (Task 10/11 dependem):

```ts
export interface KpiSources {
  // Métricas de conta na janela do mês (ao vivo OU linha mensal — o chamador
  // resolve a cadeia; kpis.ts só monta cards). null = indisponível.
  accountMonth: Partial<AccountTotals> | null;
  accountPrevMonth: Partial<AccountTotals> | null;
  // Closes de seguidores (linha do ÚLTIMO dia do mês; spec §4.2.4) — null sem close.
  followersClose: number | null;
  followersPrevClose: number | null;
  // Fallback de followers_total para mês corrente (live count) e history do mês.
  followerHistory: { follower_count: number }[];
  // Só para posts_count e análises por post:
  allPosts: { reach: number | null; likes: number | null; comments: number | null;
              saved: number | null; shares: number | null }[];
  prevMonthPostsCount: number | null;
}
```

Regras de montagem (invariante mantida: valor e prev SEMPRE da mesma base):
- `reach/views/saves/profile_views/website_clicks`: `accountMonth[m]`; prev =
  `accountPrevMonth[m]` só quando o valor existe.
- `followers_gained`: `accountMonth.follows_and_unfollows.net`; prev idem do
  mês anterior. Fallback: `followersClose - followersPrevClose` SÓ com os dois
  closes (sem prev nesse caso). O fallback de history parcial NÃO EXISTE MAIS.
- `followers_total`: `followersClose`; fallback último ponto do history do mês
  (sem prev quando bases divergem — regra atual mantida).
- `engagement_rate`: `accounts_engaged / reach * 100` quando ambos não-null na
  MESMA fonte (accountMonth); prev idem.
- `posts_count`: `allPosts.length`; prev = `prevMonthPostsCount`.

- [ ] **Step 1: Reescrever `kpis.test.ts`** cobrindo: card omite-se com fonte null; prev null quando só o mês atual tem dado; followers_gained via net; fallback close-to-close exige os DOIS closes (um só → null — o caso Healing Hands vira teste com nome `"conta conectada no meio do mês não inventa ganho"`); engagement exige as duas métricas da mesma fonte.

```ts
Deno.test("conta conectada no meio do mês não inventa ganho", () => {
  const k = computeKpis({
    accountMonth: null, accountPrevMonth: null,
    followersClose: 4419, followersPrevClose: null,
    followerHistory: [{ follower_count: 4412 }, { follower_count: 4419 }],
    allPosts: [], prevMonthPostsCount: null,
  });
  assertEquals(k.followers_gained.value, null); // era 7 no bug original
  assertEquals(k.followers_total.value, 4419);
});
```

- [ ] **Step 2: Rodar (FAIL), reescrever `kpis.ts`, rodar (PASS)** — os testes antigos que asserem o contrato velho são REESCRITOS aqui, não mantidos.

- [ ] **Step 3: Commit** — `git commit -m "feat(report): kpis por métrica de conta, mata fallback parcial"`

### Task 10: snapshot-source com a cadeia de fontes + effectiveEnd + comparison

**Files:**
- Modify: `supabase/functions/report-docs/snapshot-source.ts` (queries novas + accountMonth chain)
- Modify: `supabase/functions/_shared/report-docs/snapshot.ts` (period.effectiveEnd, campo comparison, assinatura de assembleSnapshot)
- Modify: `supabase/functions/_shared/report-docs/ai-input.ts` (comparison no contrato da IA)
- Delete: `supabase/functions/report-docs/account-views.ts` (absorvido; views vira métrica do batch)
- Test: `supabase/functions/_shared/report-docs/snapshot.test.ts`, `ai-input.test.ts` (atualizar), `supabase/functions/__tests__/` (grep pelo shape antigo)

**Interfaces:**
- Consumes: `fetchAccountTotals` (Task 4), `KpiSources` novo (Task 9), tabela mensal (Task 5).
- Produces: `ReportDocSnapshot.period` ganha `effectiveEnd: string`; `ReportDocSnapshot.comparison?: { prev_outlier: boolean; prev_top_share: number } | null`.

Cadeia por janela (mês e mês-anterior, cada uma):
1. Graph ao vivo (`fetchAccountTotals`, janela clampada em `min(fim, agora)`),
2. campo a campo null → completar da linha `instagram_account_metrics_monthly`,
3. campo a campo ainda null → (SÓ aditivas) soma de `*_day` com cobertura
   completa do mês,
4. null → card omite-se.

- [ ] **Step 1: Atualizar testes de snapshot** — period com `effectiveEnd` (mês fechado = endExclusive-1dia; mês corrente = dia da geração); `comparison.prev_outlier=true` quando um post do mês anterior tem >50% da soma de views OU reach; snapshots antigos sem o campo continuam válidos (guard).

- [ ] **Step 2: Implementar** — em snapshot-source: adicionar `impressions` ao select de prevMonthPosts (linha ~162: `select("reach, saved, likes, comments, shares, impressions")`); calcular comparison; substituir `accountViewsPromise` por `accountTotalsPromise` (mês) + `accountPrevTotalsPromise` (mês anterior), ambos degradando para null com warn; buscar linha mensal das duas janelas; montar o `KpiSources` novo. Em ai-input: incluir `comparison` no payload da IA com instrução textual ("mês anterior teve post outlier com N% do total: contextualize quedas").

- [ ] **Step 3: Rodar `npm run test:functions` + grep de shape antigo nas DUAS suítes**

```bash
grep -rn "accountViews\|profile_views_28d\|website_clicks_28d" apps/ supabase/functions --include="*.test.*" --include="*.tsx" | grep -v node_modules
```
Atualizar todo consumidor/teste que aparecer.

- [ ] **Step 4: Commit** — `git commit -m "feat(report): fontes de conta com fallback mensal, effectiveEnd e outlier"`

### Task 11: UI dos cards (período real + tooltip de engajamento)

**Files:**
- Modify: `packages/report-blocks/blocks/KpiCardBlock.tsx` (período + tooltip)
- Modify: `packages/report-blocks/types.ts` (period.effectiveEnd, comparison — espelho do snapshot)
- Test: teste existente do pacote (localizar com `ls packages/report-blocks/*.test.*`; se não houver, criar `packages/report-blocks/blocks/KpiCardBlock.test.tsx` no padrão Vitest do repo)

- [ ] **Step 1: Teste** — card renderiza "01–15 de agosto · parcial" quando `effectiveEnd` < fim do mês e "01–31 de agosto" quando completo; card de `engagement_rate` tem `title`/tooltip "Contas engajadas ÷ alcance · análise Mesaas"; snapshot ANTIGO (sem effectiveEnd) não quebra (guard: sem o campo, não estampa período).

- [ ] **Step 2: Implementar, rodar `npm run test` (PASS)**

- [ ] **Step 3: Commit** — `git commit -m "feat(report): cards estampam período real coberto"`

---

# FASE 5 — CRM Analytics

### Task 12: Endpoint `GET /account-metrics/:clientId`

**Files:**
- Modify: `supabase/functions/instagram-analytics/index.ts` (rota nova)
- Modify: `supabase/functions/_shared/feature-guard.ts` (registro explícito)
- Create: `supabase/functions/instagram-analytics/account-metrics.ts` (handler puro)
- Test: `supabase/functions/__tests__/account-metrics-endpoint.test.ts` + teste existente do feature-guard

**Interfaces:**
- Consumes: `fetchAccountTotals`, tabelas daily/monthly, `verifyClientOwnership`, `getAccountWithToken`, `getCachedOrFetch` (todos já existem em instagram-analytics/index.ts).
- Produces (o frontend Task 13 consome EXATAMENTE):

```ts
interface AccountMetricsResponse {
  period: { start: string; end: string; effectiveEnd: string }; // end INCLUSIVO
  current: AccountTotals & {
    followers: { start: number; end: number; delta: number } | null;
  };
  previous: AccountMetricsResponse["current"] | null;
  source: Record<string, "live" | "snapshot" | null>;
}
```

- [ ] **Step 1: Registrar a rota no feature-guard (com teste)**

```ts
// _shared/feature-guard.ts — ANTES do return final:
if (/^\/account-metrics\//.test(path)) return "feature_instagram";
```
(mesmo flag base da página de Analytics hoje: rota desconhecida já caía em
`feature_instagram`, mas a spec exige registro EXPLÍCITO — o teste do guard
ganha o caso novo para o fallback nunca mudar por baixo.)

- [ ] **Step 2: Teste do handler puro** (mocks: janela válida devolve current/previous; previous null quando a janela anterior não cabe na retenção E não há linha mensal; source marca "snapshot" quando o valor veio do banco; end inclusivo: `end=2026-08-31` cobre o dia 31)

- [ ] **Step 3: Implementar** — `account-metrics.ts` exporta `handleAccountMetrics(deps, clientId, start, end)`; usa `parseViewsRange` (validação/clamp/prev — a MESMA convenção end-inclusivo do endpoint de views), `fetchAccountTotals` ao vivo, completa nulls da linha mensal/`*_day` (aditivas), followers de `instagram_follower_history` (primeiro/último ponto DENTRO da janela pedida — aqui é range explícito do usuário, não mês rotulado). No `index.ts`: rota `GET /account-metrics/:clientId` com `verifyClientOwnership` + `getCachedOrFetch(serviceClient, account.id, \`account_metrics_${start}_${end}\`, ..., 6)`.

- [ ] **Step 4: Rodar suítes, commit** — `git commit -m "feat(analytics): endpoint account-metrics com paridade de conta"`

### Task 13: Frontend do CRM migra para o endpoint

**Files:**
- Modify: `apps/crm/src/services/analytics.ts` (função nova `getAccountMetrics` + tipos; remover leituras de `reach_28d`/`impressions_28d`/`profile_views_28d`)
- Modify: página de Analytics (localizar consumidores: `grep -rn "reach_28d\|impressions_28d\|profile_views_28d\|getAnalyticsOverview" apps/crm/src --include="*.tsx"`)
- Test: `apps/crm/src/services/__tests__/` (padrão dos testes vizinhos de analytics)

- [ ] **Step 1: Teste do service** (mock de fetch do edge: monta URL certa, propaga o shape `AccountMetricsResponse`, erro → throw)

- [ ] **Step 2: Implementar** — `getAccountMetrics(clientId: number, start: string, end: string): Promise<AccountMetricsResponse>` chamando a edge function com o JWT da sessão (padrão das chamadas existentes no arquivo, helper de fetch já existente); página troca os KPIs de conta para `useQuery(["account-metrics", clientId, start, end], ...)` mantendo os pares current/previous que a UI já renderiza. Somas por post permanecem SÓ nas seções de análise de conteúdo.

- [ ] **Step 3: Gates frontend** — `npm run test`, `npx tsc -p apps/crm/tsconfig.json --noEmit`. Verificar no browser (dev server via preview) que a página de Analytics carrega com os números novos.

- [ ] **Step 4: Commit** — `git commit -m "feat(crm): Analytics consome métricas de conta paritárias"`

---

# FASE 6 — Gates + PR

### Task 14: Gates completos e PR

- [ ] **Step 1: Rodar TODOS os gates** (ver Global Constraints; os 4 tsc, lint, format:check, test, test:functions). `ls node_modules/.deno` antes de confiar — `npm ci` se poluído.

- [ ] **Step 2: Re-verificar versão de migration contra origin/main** (`git ls-tree origin/main:supabase/migrations | tail -5` — renumerar se main andou).

- [ ] **Step 3: Abrir PR** — base `main`, título `feat(analytics): paridade dos KPIs com o app do Instagram + histórico diário próprio`, corpo com link da spec, a matriz do spike, e o plano de rollout (Fase 7). O review externo do Codex auto-dispara: verificar os achados antes de mergear, não rubricar.

### Task 15: Rollout (após merge — ordem obrigatória)

- [ ] **Step 1: Migrations em PROD** — `cat supabase/.temp/project-ref` (=prod) → `npx supabase db push --linked` → verificar colunas/RPC/tabela via `db query` (mesmas queries da Task 5 Step 2).
- [ ] **Step 2: Deploy das functions** — `npx supabase functions deploy instagram-sync-cron instagram-analytics report-docs --use-api --no-verify-jwt` (uma a uma se a CLI não aceitar lista).
- [ ] **Step 3: Observar o backfill** — a cada ~1h: `npx supabase db query --linked "select count(*) filter (where metrics_backfilled_at is null) as pendentes, count(*) as total from instagram_accounts where authorization_status='active'"` até pendentes=0.
- [ ] **Step 4: Frontend** — merge já dispara Vercel; conferir a página de Analytics em produção num cliente real.
- [ ] **Step 5: Validação de paridade (o gate final da iniciativa)** — regenerar o relatório de agosto da Healing Hands ("Atualizar dados") e conferir contra os prints do app: novos seguidores ≈ +49, alcance ≈ 10.281 (ou rótulo do plano B), views ≈ 46-47k, saves de conta, visitas ao perfil coerentes. Registrar os números na memória do projeto e responder à cliente.

---

## Self-review (executado na escrita do plano)

- Cobertura da spec: §3→Tasks 1-3; §4.1→Task 4; §4.2.1→Tasks 5-6; §4.2.2→Task 6; §4.2.3→Task 8; §4.2.4→Tasks 5, 7; §4.3→Tasks 9-11; §4.4→Tasks 12-13; §4.5→sem task (descopado por decisão); §5→embutido nas tasks; §6→passos de teste de cada task + Task 15.5; §7→Tasks 14-15; §8→matriz + checkpoint Task 3.
- Tipos: `AccountTotals`/`DailyValues`/`FollowsBreakdown` definidos na Task 4 e consumidos por 6-12 com os mesmos nomes; `KpiSources` novo definido na Task 9 e consumido na 10; `AccountMetricsResponse` definido na 12 e consumido na 13.
- Condicionais do spike são dirigidos pela matriz (linhas "ajustar pela matriz"), não placeholders de implementação.

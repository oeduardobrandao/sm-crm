# Gatilhos de popup por situação de cobrança: design

**Data:** 2026-09-06 · **Status:** aprovado (brainstorm em texto, seis partes aprovadas uma a uma)

## Objetivo

Os popups globais (spec `2026-09-04-global-popups-design.md`) só têm segmentação
estática: público (todos / por plano / por workspace), agenda e status, tudo avaliado
na RLS de `global_popups` na leitura. Esta spec adiciona **gatilhos**: uma condição a
mais, calculada no banco na hora da leitura, para que um popup apareça somente
enquanto o workspace do usuário estiver numa situação de cobrança específica. Caso
motivador: "um popup que aparece toda vez que um workspace estiver com pagamento
pendente".

Junto entra uma terceira frequência, **"Uma vez por dia"**, porque nenhuma das duas
atuais serve para "toda vez": "Uma vez" some para sempre após fechar e "Até o CTA"
some para sempre após o clique, e nenhuma volta num segundo episódio de inadimplência
meses depois.

O gatilho é uma **condição lida na hora** (como o `DunningBanner` faz com
`workspace_subscriptions`), não um ciclo "criar ao falhar / arquivar ao recuperar".
O comentário do próprio `DunningBanner` explica por que o ciclo por evento foi
rejeitado: ele dessincroniza do Stripe. Aqui, quando a condição deixa de valer, o
popup some sozinho.

## Decisões fechadas no brainstorm

| Pergunta | Decisão |
|---|---|
| Quais gatilhos | `payment_pending`, `trial_ending` (com N dias), `plan_downgraded` |
| Quem vê popup com gatilho | Só o **dono** do workspace (`workspace_members.role = 'owner'`), fixo, não configurável |
| Insistência | Nova frequência `daily`: no máximo uma abertura por dia-calendário local por usuário, enquanto elegível |
| Onde avaliar | Na RLS, via função `security definer` (abordagem A); o CRM não avalia condição |
| Prioridade | Popup com gatilho vence popup comum na mesma sessão; empate por mais recente |
| `DunningBanner` | Não muda; o popup é reforço editável, não substituto |

## Escopo

**Dentro:**
- Migration: colunas `trigger` e `trigger_days` em `global_popups`, `frequency`
  aceita `daily`, função `popup_trigger_matches`, policy de SELECT recriada.
- `_shared/admin-popups.ts`: allowlist, validação, normalização dos dias.
- `mcp-admin/tools.ts`: campos novos no schema de `create_popup`/`update_popup`.
- Admin: tipo, formulário, bloco "Gatilho" no editor, opção "Uma vez por dia",
  rótulos na lista.
- CRM: colunas novas na leitura, regra "escondido hoje", prioridade, `seen` diário,
  `trigger` no evento de analytics.
- Testes: suíte psql nova, Deno, Vitest admin e CRM, E2E manual na stack local.

**Fora (não mexe):**
- Banners com gatilho.
- `target_roles` genérico: o "só dono" é consequência do gatilho, não um campo.
- Heurística `canceled` + `past_due_since` para cobrir o Pagar.me em `plan_downgraded`.
- Outros gatilhos (limite de uso, Instagram desconectado, workspace sem cliente).
- Automação entre gatilho e frequência no editor: o admin escolhe as duas.
- Qualquer mudança no `DunningBanner`, no `TargetPicker` ou no `sign-r2-urls`
  (este assina imagens consultando `global_popups` com a RLS do próprio usuário,
  então o gatilho vale lá sem mudança).

## Parte 1: dados e RLS

### Migration (versão acima da cauda de `origin/main` na hora de abrir o PR)

```sql
alter table global_popups
  add column trigger text,
  add column trigger_days int;

alter table global_popups
  add constraint global_popups_trigger_check
    check (trigger is null or trigger in ('payment_pending', 'trial_ending', 'plan_downgraded')),
  -- coalesce obrigatório: com trigger NULL, `trigger = 'trial_ending'` é NULL, e
  -- `NULL = true` é NULL, que passa no CHECK. Sem o coalesce, trigger NULL com
  -- trigger_days preenchido seria aceito.
  add constraint global_popups_trigger_days_check
    check (coalesce(trigger = 'trial_ending', false) = (trigger_days is not null)),
  add constraint global_popups_trigger_days_range_check
    check (trigger_days is null or trigger_days between 1 and 60);

alter table global_popups drop constraint global_popups_frequency_check;
alter table global_popups
  add constraint global_popups_frequency_check
    check (frequency in ('once', 'until_cta', 'daily'));
-- global_popups_ack_frequency_check (not (require_ack and frequency = 'until_cta'))
-- fica como está: daily combina com confirmação obrigatória.
```

`trigger` é palavra-chave **não reservada** no PostgreSQL (`unreserved_keyword` em
`gram.y`): serve como nome de coluna sem aspas. `trigger_days` só existe para
`trial_ending`; nos outros gatilhos é nulo.

### Função `popup_trigger_matches`

```sql
create or replace function popup_trigger_matches(p_trigger text, p_days int)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when p_trigger is null then true
    else coalesce((
      select case p_trigger
        when 'payment_pending' then s.status = 'past_due'
        when 'trial_ending' then
          s.status = 'trialing'
          and s.current_period_end is not null
          and s.current_period_end > now()
          and s.current_period_end <= now() + make_interval(days => p_days)
        when 'plan_downgraded' then s.status = 'unpaid'
        else false
      end
      from profiles pr
      join workspace_members wm
        on wm.workspace_id = pr.conta_id
       and wm.user_id = pr.id
       and wm.role = 'owner'
      join workspace_subscriptions s on s.workspace_id = pr.conta_id
      where pr.id = auth.uid()
    ), false)
  end
$$;

revoke all on function popup_trigger_matches(text, int) from public;
grant execute on function popup_trigger_matches(text, int) to authenticated;
```

Pontos de desenho:

- **Sem parâmetro de usuário.** Lê `auth.uid()` por dentro. Exposta via `/rpc`, um
  usuário só consegue perguntar sobre si mesmo. (`resolve_workspace_plan(ws_id)`
  permite sondar o plano de qualquer workspace; não repetir isso.)
- **Dono resolvido por `workspace_members`**, não por `profiles.role`: é a mesma
  regra da policy `workspace_subscriptions_owner_read` (migration
  `20260804000001`, que explica por que o papel global está errado para isso).
- **Workspace ativo** = `profiles.conta_id`, igual ao targeting por plano e por
  workspace. `workspace_subscriptions.workspace_id` é chave primária: no máximo uma
  linha por workspace.
- `coalesce(..., false)` cobre: sem assinatura, sem membership de dono, `conta_id`
  nulo, `p_days` nulo com `trial_ending` (o CHECK já impede, mas a função não pode
  devolver NULL, que a policy trataria como "não visível" de qualquer forma).
- `stable` + `security definer` + `set search_path = public`, como manda a regra
  para funções usadas em policy.

### Semântica de cada gatilho

| Gatilho | Condição na assinatura | Some quando | Observações |
|---|---|---|---|
| `payment_pending` | `status = 'past_due'` | volta a `active`/`trialing` | Stripe e Pagar.me gravam `past_due` na falha de cobrança; a recuperação zera o episódio (`buildRecoveryEpisode`). Volta a cada episódio novo. |
| `trial_ending` | `status = 'trialing'` e `now() < current_period_end <= now() + N dias` | teste vira `active`, expira, ou faltam mais de N dias | `current_period_end` é o fim do teste nos dois provedores (`handleGetTrials` usa o mesmo campo). |
| `plan_downgraded` | `status = 'unpaid'` | o workspace assina de novo | Estado terminal do dunning do Stripe; `statusToPlanId` devolve o plano padrão nele. Vale indefinidamente, então o popup desse gatilho pede frequência "Uma vez" ou data de término. Pagar.me termina em `canceled`, indistinguível de cancelamento voluntário: fica fora. |

### Policy de SELECT

Recriada com o mesmo nome e o mesmo corpo de hoje, mais uma linha:

```sql
drop policy "Authenticated users can read active popups matching their workspace" on global_popups;
create policy "Authenticated users can read active popups matching their workspace"
  on global_popups for select to authenticated
  using (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
    and popup_trigger_matches(trigger, trigger_days)
    and ( target_mode = 'all' or ... -- inalterado
    )
  );
```

Como é um AND, o gatilho se combina com público e agenda ("só plano Pro, só com
pagamento pendente, até dia 30"). Popups sem gatilho continuam exatamente como hoje.
A policy de INSERT de `popup_interactions` usa `exists (select 1 from global_popups
...)` sob a mesma policy, então um usuário sem a condição também não consegue gravar
interação num popup com gatilho.

`popup_interactions` e `popup_interaction_counts` não mudam.

## Parte 2: edge functions

### `_shared/admin-popups.ts` (fonte única para `platform-admin` e `mcp-admin`)

- `POPUP_COLUMNS` ganha `"trigger"` e `"trigger_days"`.
- `validatePopupFields(row)` (sobre a linha mesclada):
  - `frequency` aceita `"daily"`. A regra `require_ack` + `until_cta` continua; `daily`
    + `require_ack` é válido.
  - `trigger`: `undefined`/`null` ou um dos três valores; senão `"invalid trigger"`.
  - `trigger_days`: com `trial_ending`, inteiro de 1 a 60 obrigatório
    (`"trial_ending needs trigger_days between 1 and 60"`); com outro gatilho ou sem
    gatilho, precisa ser nulo depois da normalização abaixo.
- `normalizePopupTrigger(update, current?)`: novo. Recebe o patch (já passado por
  `pickPopupColumns`) e, no update, a linha atual; decide sobre a linha **mesclada**
  (`{ ...current, ...update }`) e devolve o patch com no máximo duas mudanças:
  `trigger: ""` vira `null`, e `trigger_days: null` é emitido **somente** quando o patch
  não mandou `trigger_days` e a linha mesclada ficou com gatilho diferente de
  `trial_ending` mas dias persistidos (a troca de gatilho num popup `trial_ending`).
  Um patch que não toca no gatilho (editar o título de um popup `trial_ending`) sai
  intacto: emitir `trigger_days: null` nele deixaria `trigger = 'trial_ending'` com
  dias nulos e cairia no CHECK como 500 em toda edição trivial. Dias **enviados** no
  patch sem `trial_ending` (create com `trigger_days: 5` e sem `trigger`, ou com
  `payment_pending`) não são apagados: é erro do chamador, e `validatePopupFields`
  devolve 400 ("trigger_days only applies to trial_ending") em vez de criar em
  silêncio um popup sem a restrição pretendida. Chamado antes de
  `validatePopupFields`, nos mesmos dois pontos (no create, sem `current`).

### `platform-admin/popups.ts`

Nenhuma lógica nova: `pickPopupColumns` passa as colunas, a validação compartilhada
decide, `list-popups` já faz `select *`. Só as duas chamadas novas, antes de
`validatePopupFields`: `normalizePopupTrigger(insert)` no create e
`normalizePopupTrigger(update, current)` no update.

### `mcp-admin/tools.ts`

`POPUP_FIELDS` ganha:

```ts
frequency: z.enum(["once", "until_cta", "daily"]).optional(),
trigger: z.enum(["payment_pending", "trial_ending", "plan_downgraded"]).nullable().optional()
  .describe("Só o dono do workspace vê, e só enquanto a condição valer: payment_pending = assinatura em past_due; trial_ending = teste terminando em trigger_days dias; plan_downgraded = assinatura unpaid (plano voltou ao padrão). null remove"),
trigger_days: z.number().int().min(1).max(60).nullable().optional()
  .describe("Obrigatório com trial_ending, nulo nos demais"),
```

`mcp-admin/queries.ts` já passa por `pickPopupColumns` + `validatePopupFields`; ganha
as mesmas duas chamadas a `normalizePopupTrigger` (create sem `current`, update com).

## Parte 3: Admin (`apps/admin`)

### Tipo (`lib/api.ts`)

```ts
export type PopupTrigger = 'payment_pending' | 'trial_ending' | 'plan_downgraded';
// em GlobalPopup:
frequency: 'once' | 'until_cta' | 'daily';
trigger: PopupTrigger | null;
trigger_days: number | null;
```

### Formulário (`pages/popup-form.ts`)

- `PopupFormState` ganha `trigger: '' | PopupTrigger` (vazio = nenhum) e
  `trigger_days: string` (valor do input; `emptyForm` usa `'3'`).
- `popupToForm`: `trigger: p.trigger ?? ''`, `trigger_days: p.trigger_days ? String(p.trigger_days) : '3'`.
- `formToPayload`: `trigger: f.trigger || null`,
  `trigger_days: f.trigger === 'trial_ending' ? parseInt(f.trigger_days, 10) : null`.
- `validateForm`: com `trial_ending`, `trigger_days` precisa ser inteiro de 1 a 60,
  senão `errors.trigger = 'Informe de 1 a 60 dias'`. `PopupFormErrors` ganha `trigger?`.
- `withRequireAck(f, on)`: força `'once'` **apenas** quando `on` e `f.frequency ===
  'until_cta'`. Hoje força sempre; passaria a apagar um `daily` escolhido de
  propósito.

### Editor (`pages/PopupsPage.tsx`)

- Bloco **"Frequência"**: terceiro radio "Uma vez por dia", legenda "abre no máximo
  uma vez por dia enquanto o popup estiver elegível". Habilitado mesmo com confirmação
  obrigatória (só "Até o CTA" fica desabilitado, como hoje).
- Bloco novo **"Gatilho"**, logo abaixo de "Público": `<select>` com "Nenhum",
  "Pagamento pendente", "Teste terminando", "Plano rebaixado por inadimplência". Com
  "Teste terminando", aparece o input numérico "Dias antes do fim do teste" (1 a 60).
  Texto de apoio fixo sob o select: "Com gatilho, só o dono do workspace vê o popup, e
  só enquanto a condição valer." Erro de `errors.trigger` abaixo do input.
- Nenhuma automação entre gatilho e frequência.

### Lista

- Coluna Frequência: `daily` → "Uma vez por dia".
- Coluna Público: gatilho como chip ao lado do público, separado por "·":
  "Todos · Pagamento pendente", "Plano Pro · Teste em 3 dias" ("Teste em 1 dia" no
  singular), "Todos · Plano rebaixado".

Copy sem travessão (regra da casa): separadores com "·", ponto ou dois-pontos.

## Parte 4: CRM (`apps/crm`)

### Store (`store/popups.ts`)

- `GlobalPopup.frequency` aceita `'daily'`; ganha `trigger: PopupTrigger | null`.
- `COLUMNS` de `getActivePopups` inclui `trigger`.
- `PopupInteraction` ganha `created_at: string`; `getMyPopupInteractions` seleciona
  `popup_id, action, created_at`.
- Se a migration ainda não estiver aplicada, a query de popups falha na coluna nova e
  a sessão fica sem popup (comportamento tolerante já existente). Isso é aceitável
  porque a ordem de rollout aplica a migration antes do merge.

### `hooks/pickPopup.ts`

```ts
export function isHiddenForever(popup, interactions): boolean {
  if (popup.frequency === 'daily') return false;
  // once: closed | cta | ack; until_cta: cta | ack (inalterado)
}

/** daily: já abriu hoje (dia-calendário LOCAL do browser) */
export function isHiddenToday(popup, interactions, now: Date): boolean {
  if (popup.frequency !== 'daily') return false;
  return interactions.some(
    (i) => i.popup_id === popup.id && i.action === 'seen' && sameLocalDay(new Date(i.created_at), now),
  );
}

export function pickPopup(popups, interactions, session, now = new Date()) {
  if (session.skipped) return null;
  const eligible = popups
    .filter((p) => !isHiddenForever(p, interactions))
    .filter((p) => !isHiddenToday(p, interactions, now))
    .filter((p) => !session.closedIds.has(p.id));
  if (session.shownId) return eligible.find((p) => p.id === session.shownId) ?? null;
  if (eligible.length === 0) return null;
  return [...eligible].sort(
    (a, b) =>
      Number(b.trigger !== null) - Number(a.trigger !== null) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}
```

- **Dia-calendário local**, não janela de 24 h: é como se lê "uma vez por dia". Quem
  viu às 18h vê de novo às 9h do dia seguinte.
- A chave é o `seen` (gravado na abertura), então um popup aberto e abandonado sem
  interação também conta como "visto hoje".
- Sessão de aba continua valendo por cima: `daily` = no máximo uma vez por dia **e**
  uma vez por sessão de aba.
- Prioridade: gatilho antes de comum; empate por `created_at` desc, como hoje.

### `components/layout/GlobalPopupHost.tsx`

Fluxo inalterado (uma decisão por montagem, respeito ao guia, delay de abertura).
Três mudanças pontuais:

- Gravação do `seen`: para `daily`, grava quando não existe `seen` de hoje (mesmo
  `sameLocalDay`); para `once`/`until_cta`, continua gravando só quando nunca houve
  `seen` (evita linhas repetidas onde não servem para nada).
- `captureEvent('popup_shown', { popup_id, pages, trigger })`.
- `usePopups.onMutate`: a interação otimista passa a incluir
  `created_at: new Date().toISOString()`, porque o tipo agora exige o campo e a
  regra diária lê dele.

`sameLocalDay(a, b)` vive em `pickPopup.ts` e é exportada para o host e os testes
(compara ano, mês e dia via getters locais).

### Efeito no seu exemplo

Popup com gatilho "Pagamento pendente", frequência "Uma vez por dia", público
"Todos": abre para o dono uma vez por dia, em todo episódio de inadimplência, e some
sozinho quando o pagamento entra. No mesmo dia o dono também vê a barra vermelha do
`DunningBanner`; os dois convivem.

## Parte 5: testes

### psql (`supabase/tests/entitlements/80_popup_triggers.sql`, gated no CI)

Semeia workspace A (dono `ua`, agente `ag`) e workspace B (dono `ub`), com
`workspace_members` e `profiles.conta_id`, e uma linha em `workspace_subscriptions`
por workspace (`workspace_id, stripe_customer_id, status, current_period_end`).
Popups: sem gatilho; `payment_pending`; `trial_ending` 3 dias; `trial_ending` 1 dia;
`plan_downgraded`. Asserções:

- A com `past_due`: vê sem-gatilho e `payment_pending`; não vê `trial_ending` nem
  `plan_downgraded`. Agente de A: vê só o sem-gatilho. B com `active`: vê só o
  sem-gatilho.
- A trocado para `trialing` com `current_period_end = now() + 2 dias`: vê `trial_ending`
  3 e não vê `trial_ending` 1. Com `current_period_end = now() - 1 hora`: não vê nenhum.
- A trocado para `unpaid`: vê `plan_downgraded`, não vê `payment_pending`.
- Agente de A não consegue inserir interação em popup com gatilho (policy de INSERT
  herda a de SELECT).
- CHECKs: gatilho inválido rejeitado; `trigger_days` com gatilho nulo rejeitado
  (prova o `coalesce`); `trial_ending` sem dias rejeitado; `trigger_days = 0` e `61`
  rejeitados; `frequency = 'daily'` aceita; `daily` + `require_ack` aceita.
- `popup_trigger_matches('payment_pending', null)` chamada direto como A devolve
  `true` e como agente devolve `false`.

A suíte 77 não muda.

### Deno

- `admin-popups_test.ts`: `validatePopupFields` com os casos acima do gatilho e dos
  dias; `normalizePopupTrigger` zera só dias persistidos ao trocar o gatilho, mantém
  dias enviados no patch (que a validação rejeita) e converte `""` em `null`; `daily`
  aceito; `daily` + `require_ack` aceito.
- `platform-admin-popups_test.ts`: create persiste `trigger` e `trigger_days`; create
  com dias sem `trial_ending` (com ou sem outro gatilho) é 400; update que troca
  `trial_ending` por `payment_pending` sem mandar dias persiste `trigger_days = null`;
  update que manda dias num popup `payment_pending` é 400.
- `mcp-admin-popups_test.ts`: `create_popup` aceita os campos novos e rejeita
  `trigger_days` fora de 1..60 no schema.
- `npm run check:functions` cobre os tipos.

### Vitest (admin)

- `popup-form.test.ts`: payload com e sem gatilho; `trigger_days` nulo fora de
  `trial_ending`; validação dos dias; `popupToForm` de uma linha com gatilho;
  `withRequireAck(true)` preserva `daily` e converte `until_cta`.
- `PopupsPage.test.tsx`: select de gatilho presente; campo de dias aparece só com
  "Teste terminando"; radio "Uma vez por dia"; rótulos da lista (frequência e chip).

### Vitest (CRM)

- `pickPopup.test.ts`: `daily` escondido no mesmo dia local e visível no dia seguinte
  (com `now` injetado, inclusive virada de dia às 23:59 → 00:01); `daily` nunca
  "para sempre" mesmo com `cta`/`ack`; gatilho vence comum mais recente; dois com
  gatilho desempatam por data; `sameLocalDay`.
- `store/__tests__/popups.test.ts`: colunas selecionadas incluem `trigger` e
  `created_at`.
- `GlobalPopupHost.test.tsx`: para `daily`, `seen` gravado de novo num dia novo e não
  gravado se já houve `seen` hoje; `popup_shown` carrega `trigger`.

### E2E manual (stack local, colima)

Criar popup com gatilho "Pagamento pendente" e frequência "Uma vez por dia" no Admin;
`update workspace_subscriptions set status = 'past_due'` para o workspace de teste;
abrir o CRM como dono e ver o popup; abrir como agente e não ver; voltar o status para
`active` e ver sumir. Staging segue com drift de outras branches, então a verificação
fica na stack local, como no popup original.

## Parte 6: rollout (ordem obrigatória)

O merge deploya o frontend na hora, então:

1. Reconferir a versão da migration contra a cauda de `origin/main`
   (`git ls-tree origin/main:supabase/migrations | tail`) ao abrir o PR.
2. `db push` da migration em prod (`--project-ref`, sem link).
3. Deploy de `platform-admin` e `mcp-admin` (`--use-api`, flags de JWT atuais) a
   partir de um HEAD com `origin/main` mergeada.
4. Merge.

**Por que as functions vão antes do merge:** com a migration aplicada e as functions
antigas no ar, o Admin novo manda `trigger`, o `pickPopupColumns` antigo descarta a
coluna em silêncio e o popup nasce **sem gatilho, visível para todo mundo**. O
inverso (functions novas, migration ausente) só dá 500 no create, que é ruidoso e
seguro.

## Riscos e limitações aceitas

- `getMyPopupInteractions` continua sem limite (residual já registrado). Com `daily`,
  cresce em torno de duas linhas por usuário por dia enquanto o popup estiver
  elegível. Aceito nesta versão; se pesar, o próximo passo é filtrar por `popup_id`
  dos popups visíveis.
- `plan_downgraded` vale até o workspace assinar de novo. É responsabilidade do admin
  usar "Uma vez" ou data de término nesse popup.
- Pagar.me não tem estado `unpaid`; `plan_downgraded` cobre só Stripe.
- Dia-calendário é o do browser do usuário, não o do servidor.
- Rodar Deno e Vitest em paralelo polui `node_modules` (`npm ci` e sequencial resolve).

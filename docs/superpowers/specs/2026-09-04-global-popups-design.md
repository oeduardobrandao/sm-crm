# Editor de popups no admin (anúncios em modal no CRM): design

**Data:** 2026-09-04 · **Status:** aprovado (brainstorm com visual companion; UI validada em mockup, design fechado em três partes: dados/edge, admin, CRM/testes)

## Objetivo

O admin da plataforma já publica **banners** (barras horizontais abaixo da topbar do
CRM) com targeting por plano ou workspace, agenda e dismiss por usuário. Esta spec
adiciona o segundo formato: **popups**, um modal centralizado que aparece uma vez por
sessão dentro do shell logado do CRM, com título, imagem opcional, corpo em markdown,
botão de ação (CTA) opcional e dois modos de frequência.

Um modelo único cobre os três usos levantados: anúncio de novidade (imagem + CTA para
ajuda ou `/novidades`), aviso que exige confirmação (sem X, botão "Entendi") e promoção
ou upsell (CTA amarelo para planos, insistente até o clique).

A abordagem escolhida **espelha a pilha dos banners** (tabela nova, RLS copiada, quatro
actions novas no `platform-admin`, página nova no admin, host novo no CRM) em vez de
generalizar `global_banners` com uma coluna `format`. Motivo: zero risco para os
banners em produção, semântica de "visto" diferente, e colunas que ficariam nulas para
um dos formatos.

## Escopo

**Dentro:**
- Migration: `global_popups`, `popup_interactions`, view `popup_interaction_counts`, RLS.
- `platform-admin`: `list-popups`, `create-popup`, `update-popup`, `delete-popup`.
- `sign-r2-urls`: allowlist para `image_key` de popups ativos.
- Admin: rota `/admin/popups`, `PopupsPage` (lista + editor com preview lateral),
  API em `lib/api.ts`, alias `@mesaas/ui`, extração do `TargetPicker`.
- `packages/ui/PopupCard.tsx`: card compartilhado entre admin (preview) e CRM (real).
- CRM: `store/popups.ts`, `hooks/usePopups.ts` com `pickPopup`, `GlobalPopupHost`
  montado no `AppLayout`.
- Testes: SQL (RLS), Deno (handlers e allowlist), Vitest (admin, CRM, pacote).

**Fora (não mexe):**
- Banners: tabela, RLS, página e container ficam como estão. A única mudança na
  `BannersPage` é passar a usar o `TargetPicker` extraído.
- Hub do cliente, landing e login: popups só aparecem dentro do shell logado do CRM.
- Targeting por rota (`target_paths`) e por papel (`target_roles`): não entram. Ambos
  são uma coluna a mais e um filtro a mais, sem migração dolorosa, se surgirem depois.
- Crop ou redimensionamento de imagem: a imagem é exibida em 16:9 com
  `object-fit: cover`; o formulário só avisa a proporção recomendada.
- Auto-arquivamento por cron: como nos banners, `ends_at` é filtrado na leitura e o
  admin mostra o badge `EXPIRED` derivado no cliente.

## Parte 1: dados, RLS e edge

### Tabela `global_popups`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid PK` default `gen_random_uuid()` | |
| `title` | `text NOT NULL` | |
| `eyebrow` | `text` | opcional; texto pequeno em caixa alta acima do título |
| `body` | `text NOT NULL` | markdown; renderizado com `react-markdown` + `remark-gfm`, sem HTML cru |
| `image_key` | `text` | chave R2 opcional (`contas/<conta do admin>/files/<id>.<ext>`), mesmo caminho das capas da base de conhecimento |
| `cta_label` | `text` | |
| `cta_url` | `text` | relativa (`/ajuda/...`) ou absoluta (`https://...`) |
| `cta_style` | `text NOT NULL` default `'ink'` | `'ink'` (tinta escura, padrão dos CTAs do CRM) ou `'brand'` (amarelo `#ffbf30`) |
| `secondary_label` | `text` | opcional; ver defaults abaixo |
| `frequency` | `text NOT NULL` default `'once'` | `'once'` ou `'until_cta'` |
| `require_ack` | `boolean NOT NULL` default `false` | sem X, sem fechar clicando fora, sem Esc |
| `target_mode` | `text NOT NULL` | `'all'`, `'plan'`, `'workspace'` |
| `target_plan_ids` | `text[]` | usado quando `target_mode = 'plan'` |
| `target_workspace_ids` | `uuid[]` | usado quando `target_mode = 'workspace'` |
| `starts_at` | `timestamptz` | null = imediato quando ativo |
| `ends_at` | `timestamptz` | null = sem fim |
| `status` | `text NOT NULL` default `'draft'` | `'draft'`, `'active'`, `'archived'` |
| `created_by` | `uuid` FK `platform_admins(id)` on delete set null | |
| `created_at`, `updated_at` | `timestamptz` default `now()` | trigger de `updated_at` igual ao dos banners |

Constraints:

```sql
CHECK (cta_style IN ('ink', 'brand'))
CHECK (frequency IN ('once', 'until_cta'))
CHECK ((cta_label IS NULL) = (cta_url IS NULL))                 -- par completo ou nenhum
CHECK (frequency <> 'until_cta' OR cta_url IS NOT NULL)         -- senão nunca termina
CHECK (NOT (require_ack AND frequency = 'until_cta'))          -- ver "Semântica de já viu"
CHECK (status IN ('draft', 'active', 'archived'))
CHECK (target_mode IN ('all', 'plan', 'workspace'))
CHECK (target_mode <> 'plan' OR (target_plan_ids IS NOT NULL AND array_length(target_plan_ids, 1) > 0))
CHECK (target_mode <> 'workspace' OR (target_workspace_ids IS NOT NULL AND array_length(target_workspace_ids, 1) > 0))
CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
```

`target_plan_ids` é `text[]` porque `plans.id` é text (a migration dos banners também
usa `text[]`, apesar da spec antiga dizer `uuid[]`).

### Tabela `popup_interactions`

Append-only. Uma linha por ação de um usuário sobre um popup.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid PK` | |
| `popup_id` | `uuid NOT NULL` FK `global_popups(id)` on delete cascade | |
| `user_id` | `uuid NOT NULL` FK `auth.users(id)` on delete cascade | |
| `action` | `text NOT NULL` | `'seen'`, `'closed'`, `'cta'`, `'ack'` |
| `created_at` | `timestamptz` default `now()` | |

Índice em `(popup_id, user_id)`. Sem UNIQUE: um usuário em `until_cta` pode ter vários
`closed` ao longo das sessões antes do `cta`.

### Semântica de "já viu"

Avaliada no CRM a partir das interações do próprio usuário:

| `frequency` | Esconde para sempre | Esconde só nesta sessão |
|---|---|---|
| `once` | qualquer `closed`, `cta` ou `ack` | (não se aplica) |
| `until_cta` | `cta` ou `ack` | `closed` (gravado só para métrica; a sessão usa `sessionStorage`) |

`seen` nunca esconde. É gravado **uma vez por usuário por popup**, na primeira exibição;
o cliente verifica no cache das próprias interações antes de inserir.

`require_ack` implica `once`. Sem X, sem clique fora e sem Esc, `closed` nunca acontece,
então `until_cta` seria idêntico a `once`. O CHECK proíbe a combinação, o
`platform-admin` responde 400, e o formulário força `Once` e desabilita o radio de
frequência enquanto "Require acknowledgement" está marcado.

### View `popup_interaction_counts`

```sql
CREATE VIEW popup_interaction_counts AS
  SELECT popup_id, action, count(DISTINCT user_id)::int AS users
  FROM popup_interactions
  GROUP BY popup_id, action;
REVOKE ALL ON popup_interaction_counts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON popup_interaction_counts TO service_role;  -- REVOKE FROM PUBLIC derruba o service_role junto
```

Alimenta as métricas da lista no admin em uma query, em vez de quatro por popup.

### RLS

`global_popups`: cópia literal da política de SELECT dos banners, trocando a tabela.

```sql
status = 'active'
AND (starts_at IS NULL OR starts_at <= now())
AND (ends_at IS NULL OR ends_at > now())
AND (
  target_mode = 'all'
  OR (target_mode = 'plan' AND resolve_workspace_plan(
        (SELECT conta_id FROM profiles WHERE id = auth.uid())) = ANY(target_plan_ids))
  OR (target_mode = 'workspace' AND
        (SELECT conta_id FROM profiles WHERE id = auth.uid()) = ANY(target_workspace_ids))
)
```

`popup_interactions`: SELECT `user_id = auth.uid()`; INSERT WITH CHECK
`user_id = auth.uid()`. Sem UPDATE nem DELETE para `authenticated`.

O admin lê e escreve tudo pelo service role dentro do `platform-admin`, como nos banners.

### Migration

Um arquivo, `supabase/migrations/20260906000010_global_popups.sql`. O prefixo precisa
ficar acima da cauda de `origin/main` no momento de abrir o PR (em 2026-09-04 a cauda
é `20260906000001_harden_cliente_foto_fn_search_path.sql`); reconferir com
`git ls-tree --name-only origin/main:supabase/migrations | tail` e renumerar se a
cauda tiver avançado.

### `platform-admin`

Quatro actions no molde exato dos handlers de banner, com allowlist `POPUP_COLUMNS`:

| Action | Comportamento |
|---|---|
| `list-popups` | Lista todos, filtro opcional de `status`, ordem `created_at desc`. Junta as contagens da view em `counts: { seen, closed, cta, ack }` por popup. |
| `create-popup` | Exige `title`, `body`, `target_mode`. Insere só colunas da allowlist e `created_by = admin.id`. |
| `update-popup` | Exige `popup_id`; atualiza só colunas da allowlist; 400 se nada a atualizar. |
| `delete-popup` | Exige `popup_id`; 400 se `status <> 'draft'`; hard delete, cascade nas interações. |

Validação adicional no servidor, com 400 e mensagem genérica: par de CTA incompleto,
`until_cta` sem CTA e `require_ack` com `until_cta` (o banco também trava, mas o erro
de CHECK não deve vazar).

### `sign-r2-urls`

Hoje, chaves fora do prefixo `contas/<conta do usuário>/` só são assinadas se forem
`cover_image_url` de artigo publicado. Passa a assinar também `image_key` de
`global_popups` com `status = 'active'`. Uma query a mais, só quando há `otherKeys`.

Popups em draft não resolvem para usuários do CRM. No admin, a chave está sob o prefixo
da própria conta do admin, então o preview do editor resolve por `ownKeys` como a capa
de artigo já faz.

## Parte 2: admin

### Rota, navegação e API

- `apps/admin/src/router.tsx`: rota `popups`, lazy, `PopupsPage`.
- `AdminLayout` `NAV_ITEMS`: `{ to: '/admin/popups', icon: AppWindow, label: 'Popups' }`
  logo abaixo de Banners.
- `apps/admin/src/lib/api.ts`: interface `GlobalPopup` (colunas da tabela +
  `counts`) e `listPopups`, `createPopup`, `updatePopup`, `deletePopup`, no molde das
  funções de banner.
- Alias `@mesaas/ui` em `apps/admin/vite.config.ts` e `apps/admin/tsconfig.json`
  (`"@mesaas/ui/*": ["../../packages/ui/*"]`), igual ao CRM e ao Hub.

### `PopupsPage`

Mesma estrutura da `BannersPage`: cabeçalho com "New Popup", busca por título, filtro de
status, lista clicável, draft com opacidade reduzida, badge `EXPIRED` derivado quando
`status = 'active'` e `ends_at < now()`.

Colunas (desktop): título com miniatura da imagem (ou placeholder neutro) e linha de
métricas `seen · closed · cta · ack`; frequência (`Once` / `Until CTA`, com sufixo
`· ack` quando `require_ack`); target; agenda; status. Mobile: card compacto como o
dos banners.

### Editor

Modal `max-w-5xl`. A partir de `md`, duas colunas: formulário à esquerda, preview
sticky à direita. Abaixo de `md`, uma coluna com o preview no fim.

Campos, na ordem:

| Campo | Input | Regra |
|---|---|---|
| Title | text | obrigatório |
| Eyebrow | text | opcional |
| Image | dropzone com miniatura, replace, remove | opcional; aviso "recomendado 16:9, até 10 MB" |
| Body | textarea markdown | obrigatório |
| CTA label / CTA URL | dois text lado a lado | os dois ou nenhum |
| Secondary label | text | opcional; placeholder mostra o default que o CRM usará |
| CTA style | segmented `Ink` / `Brand yellow` | default Ink |
| Frequency | radio `Once per user` / `Every session until CTA` | default Once; desabilitado e forçado em Once enquanto Require acknowledgement está marcado |
| Require acknowledgement | checkbox | default off; marcar força Frequency = Once |
| Target | `TargetPicker` | igual aos banners |
| Starts at / Ends at | datetime-local | opcionais |
| Status | select | default Draft |

Botões: Create/Update, Cancel, Delete (só quando editando um draft).

Preview: `PopupCard` real com os valores do formulário, e um toggle `Light` / `Dark`.
O modo dark envolve o card em um wrapper que define as variáveis legadas do CRM com os
valores do tema escuro (`--card-bg: #12151a`, `--text-main: #e8eaf0`,
`--text-muted: #9ca3af`, `--border-color: #1e2430`).

### Validação no formulário

Antes de enviar, erro inline abaixo do campo:
- CTA com label sem URL ou URL sem label.
- `until_cta` sem CTA.
- Target por plano ou workspace sem nenhum selecionado.
- URL do CTA que não começa com `/` nem com `http://` ou `https://`.

### Imagem

Reaproveita `uploadInlineImage` de `apps/admin/src/lib/inline-image.ts` (o fluxo da
capa de artigo: `file-upload-url` → PUT no R2 → `file-upload-finalize`). Guarda
`r2Key` em `image_key`. O preview resolve a URL assinada com `resolveInlineImageUrls`.
Trocar a imagem sobe uma nova e substitui a chave; a antiga fica órfã no R2 como as capas
de artigo substituídas ficam hoje (mesma dívida, fora de escopo).

### `TargetPicker`

`apps/admin/src/components/TargetPicker.tsx`: os radios All / By Plan / By Workspace e
os chips de plano e de workspace, hoje inline na `BannersPage`. Props:
`mode`, `planIds`, `workspaceIds`, `plans`, `workspaces`, `onChange`. Usado nas duas
páginas. Nenhum outro trecho da `BannersPage` muda.

### `packages/ui/PopupCard.tsx`

Componente puramente visual, importado por caminho (`@mesaas/ui/PopupCard`), sem
importar nada de `apps/*`. Props:

```ts
interface PopupCardProps {
  title: string;
  eyebrow?: string | null;
  body: string;                       // markdown
  imageUrl?: string | null;           // já resolvida (assinada)
  ctaLabel?: string | null;
  ctaStyle: 'ink' | 'brand';
  secondaryLabel: string;             // já com default aplicado
  requireAck: boolean;                // esconde o X
  sanitizeHref: (href: string) => string;
  onCta?: () => void;
  onSecondary: () => void;
  onClose: () => void;                // X
}
```

Renderiza: imagem 16:9 opcional com X sobreposto; sem imagem, o X fica no canto do
corpo. Eyebrow, título, corpo (`react-markdown` + `remark-gfm`, links via
`sanitizeHref`, `target="_blank"`, `rel="noopener noreferrer"`), linha de botões.
Botões: CTA (se houver) + secundário; com `requireAck` e sem CTA, só o secundário.
Largura máxima 420px; abaixo de 480px de viewport, margem de 16px e botões empilhados.

Estilo com os tokens legados do CRM e fallback claro: `var(--card-bg, #ffffff)`,
`var(--text-main, #12151a)`, `var(--text-muted, #374151)`,
`var(--border-color, rgba(30,36,48,.1))`, raio 12px, fonte `var(--font-main, -apple-system, ...)`.
CTA `ink`: fundo `#12151a`, texto branco. CTA `brand`: fundo `#ffbf30`, texto `#12151a`.
Secundário: outline com `--border-color`.

Defaults de `secondary_label`, aplicados por quem monta o card (CRM e preview do admin
usam a mesma função `defaultSecondaryLabel(requireAck, hasCta)` exportada do pacote):
`requireAck` → "Entendi"; senão com CTA → "Agora não"; senão → "Fechar".

## Parte 3: CRM

### Store (`apps/crm/src/store/popups.ts`)

- `getActivePopups()`: `select` com lista explícita de colunas em `global_popups`,
  `order('created_at', desc)`. A RLS filtra. Erro é lançado; o hook trata.
- `getMyPopupInteractions()`: `popup_id, action` de `popup_interactions` do usuário atual.
- `recordPopupInteraction(popupId, action)`: `insert`.

Tipos `GlobalPopup` e `PopupInteraction` exportados daqui; sem hooks no store.

### Hook `usePopups` (`apps/crm/src/hooks/usePopups.ts`)

Duas queries (`['popups']`, `['popup-interactions']`), `staleTime` 5 min, sem
`refetchInterval`. Erro em qualquer uma resulta em "nenhum popup" e um `console.warn`;
o shell nunca quebra por causa disso (cobre o deploy do frontend antes da migration).

Seleção em uma função pura, testável isoladamente:

```ts
pickPopup(popups, interactions, session: { shownId: string | null; closedIds: Set<string>; skipped: boolean }): GlobalPopup | null
```

1. Se `session.skipped`, retorna null.
2. Descarta os escondidos para sempre pela tabela da Parte 1.
3. Descarta os em `session.closedIds`.
4. Se `session.shownId` existe (um popup por sessão): retorna esse popup se ele ainda
   está na lista após os descartes (o usuário recarregou sem interagir), senão null.
5. Retorna o mais recente por `created_at`.

Sessão = `sessionStorage` (por aba). Chaves: `mesaas_popup_shown` (id),
`mesaas_popup_closed:<id>`, `mesaas_popup_skipped`. Uma aba nova é uma sessão nova; é
aceitável.

Expõe `popup`, `markSeen`, `close`, `cta`, `ack`. As mutações inserem em
`popup_interactions` com atualização otimista do cache de interações; em erro, sem
toast (o popup já sumiu da sessão; no pior caso volta na próxima) e `console.warn`.

### `GlobalPopupHost` (`apps/crm/src/components/layout/GlobalPopupHost.tsx`)

Lazy, dentro de `Suspense`, montado no `AppLayout` depois do `GuideDialog`. Decide
**uma vez** por montagem, quando `useAuth().loading` é false e as duas queries
terminaram:

1. Se o guia de primeiros passos está aberto (`useGuide()?.isOpen`; o hook devolve
   null fora do provider), grava `mesaas_popup_skipped` e não mostra nada nesta sessão.
2. `pickPopup(...)`. Se null, encerra.
3. Se há `image_key`, resolve com `resolveInlineImageUrls([image_key])`. Falhou:
   abre sem imagem.
4. Espera 800 ms após o load e abre.
5. Ao abrir: grava `mesaas_popup_shown`, `markSeen` (se ainda não há `seen` no cache)
   e `captureEvent('popup_shown', { popup_id })`.

**Não usa o `DialogContent` do CRM.** Ele envolve os filhos em um wrapper fixo com
`p-6` e renderiza um `DialogPrimitive.Close` (o X do canto) sem nenhuma prop que
desligue os dois, então o card ficaria com padding indesejado, dois X sobrepostos e,
em `require_ack`, um X funcional. O host compõe os primitivos diretamente:
`Dialog`, `DialogPortal` e `DialogOverlay` exportados de `components/ui/dialog`
(mesmo overlay, mesmo `z-[9010]`), e um `DialogPrimitive.Content` próprio de
`@radix-ui/react-dialog` centralizado, `z-[9011]`, sem padding e sem X, com o
`PopupCard` como único filho. `dialog.tsx` não muda.

Com `require_ack`: `onEscapeKeyDown` e `onInteractOutside` com `preventDefault` no
`Content`, e `requireAck` no card esconde o X do próprio card. O título do card recebe
um `id` e o `Content` aponta `aria-labelledby` para ele; `aria-describedby` vai para o
corpo.

Ações:

| Origem | Interação gravada | Sessão | Evento PostHog | Depois |
|---|---|---|---|---|
| X ou botão secundário (sem `require_ack`) | `closed` | `closed:<id>` | `popup_closed` | fecha |
| Botão secundário (com `require_ack`) | `ack` | | `popup_ack` | fecha |
| CTA | `cta` | | `popup_cta` | fecha e navega |

Navegação do CTA: `safe = sanitizeUrl(cta_url)`. Se `safe` começa com `/`,
`navigate(safe)` do router. Senão, `openExternalUrl(cta_url)` de `utils/security.ts`,
que devolve `null` sem abrir nada quando a URL é rejeitada (`sanitizeUrl` devolve `'#'`
nesses casos; nunca chamar `window.open` com esse valor). A interação `cta` é gravada
antes de navegar, e o popup fecha mesmo quando a navegação vira no-op.

Os quatro nomes de evento (`popup_shown`, `popup_closed`, `popup_cta`, `popup_ack`)
entram na união `AnalyticsEvent` em `apps/crm/src/lib/analytics.ts`, que é tipada.

### Ordem de exibição em relação ao resto do shell

`z-index` do `Dialog` do CRM já fica acima de topbar, sidebar e banners. O popup convive
com banners ativos (eles ficam atrás do overlay). O `DunningBanner` e a tela de
restrição financeira não são afetados.

## Testes

Hoje os banners não têm teste no admin nem no CRM. Aqui o alvo é a lógica, não o visual.

- **SQL** (`supabase/tests/entitlements/77_global_popups.sql`, roda no job
  `entitlement-tests`): usuário de workspace A vê popup `all`, vê popup `workspace` que
  o inclui, não vê o que não o inclui, não vê draft nem fora da janela; targeting por
  plano via `resolve_workspace_plan`; usuário B não lê interações de A e não insere com
  `user_id` de A.
- **Deno** (`supabase/functions/__tests__/`): `platform-admin-popups_test.ts` (campos
  obrigatórios, par de CTA, `until_cta` sem CTA, delete só em draft, `counts` montado
  da view); extensão de `sign-r2-urls_test.ts` (chave de popup ativo assinada, de draft
  não, e continua negando chave de outra conta).
- **Vitest admin** (`apps/admin/src/pages/__tests__/PopupsPage.test.tsx`,
  `apps/admin/src/components/__tests__/TargetPicker.test.tsx`): `formToPayload`
  (nulos, datas em ISO, arrays só no modo certo), as quatro validações inline,
  `TargetPicker` troca de modo e limpa seleções.
- **Vitest CRM**: `pickPopup` com os quatro descartes e a ordenação;
  `GlobalPopupHost` (some o X com `require_ack`, Esc bloqueado, CTA relativo chama
  `navigate`, CTA absoluto chama `window.open`, interações e eventos gravados, pula
  quando o guia está aberto, erro de query não renderiza nada).
- **Vitest pacote** (`packages/ui/__tests__/PopupCard.test.tsx`): defaults de
  `secondaryLabel`, links sanitizados, botões conforme props.
- **Browser** (staging, login seed): criar popup no admin com imagem, ver no CRM em
  light e dark, confirmar `until_cta` reaparecendo em nova aba e sumindo após o CTA.

## Rollout

O merge deploya o frontend na hora (Vercel). Ordem obrigatória:

1. `npx supabase db push` da migration em produção (nada lê as tabelas ainda).
2. Deploy de `platform-admin` e `sign-r2-urls` com `--use-api`, mantendo as flags de
   JWT que cada uma usa hoje.
3. Merge do PR. O CRM já tolera tabela ausente (queries com erro = sem popup), mas a
   ordem acima evita até o warn.

Staging primeiro, mesma ordem, para a verificação em browser.

## Riscos e decisões registradas

- **Um popup por sessão, o mais recente vence.** Dois popups ativos ao mesmo tempo
  significam que o segundo só aparece na sessão seguinte. Aceito; o admin controla a
  agenda.
- **Sessão por aba.** `sessionStorage` não é compartilhado entre abas; um usuário com
  duas abas pode ver o mesmo popup `until_cta` duas vezes no dia. Aceito.
- **Popup em cima do guia.** Se o wizard de primeiros passos abre sozinho, o popup pula
  a sessão inteira em vez de aparecer logo depois. Menos intrusivo para quem acabou de
  entrar.
- **Imagens órfãs no R2** ao trocar ou remover a imagem: mesma dívida das capas de
  artigo; fora de escopo.
- **`seen` sem UNIQUE**: a deduplicação é no cliente. Uma corrida entre duas abas pode
  gravar dois `seen`; a view conta `distinct user_id`, então a métrica não infla.

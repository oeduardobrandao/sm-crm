# Editor de popups no admin (anúncios em modal no CRM): design

**Data:** 2026-09-04 · **Status:** aprovado (brainstorm com visual companion; UI validada em mockup, design fechado em três partes: dados/edge, admin, CRM/testes; páginas múltiplas adicionadas em segunda rodada)

## Objetivo

O admin da plataforma já publica **banners** (barras horizontais abaixo da topbar do
CRM) com targeting por plano ou workspace, agenda e dismiss por usuário. Esta spec
adiciona o segundo formato: **popups**, um modal centralizado que aparece uma vez por
sessão dentro do shell logado do CRM, com uma ou mais páginas (cada uma com título,
imagem opcional e corpo em markdown), botão de ação (CTA) opcional na última página e
dois modos de frequência.

Um modelo único cobre os três usos levantados: anúncio de novidade (imagem + CTA para
ajuda ou `/novidades`, em uma ou várias páginas), aviso que exige confirmação (sem X,
botão "Entendi") e promoção ou upsell (CTA amarelo para planos, insistente até o clique).

A abordagem escolhida **espelha a pilha dos banners** (tabela nova, RLS copiada, quatro
actions novas no `platform-admin`, página nova no admin, host novo no CRM) em vez de
generalizar `global_banners` com uma coluna `format`. Motivo: zero risco para os
banners em produção, semântica de "visto" diferente, e colunas que ficariam nulas para
um dos formatos.

## Escopo

**Dentro:**
- Migration: `global_popups`, `popup_interactions`, view `popup_interaction_counts`, RLS.
- `platform-admin`: `list-popups`, `create-popup`, `update-popup`, `delete-popup`.
- `sign-r2-urls`: allowlist para as imagens das páginas de popups visíveis ao usuário.
- Admin: rota `/admin/popups`, `PopupsPage` (lista + editor com abas de página e
  preview lateral), API em `lib/api.ts`, alias `@mesaas/ui`, extração do `TargetPicker`.
- `packages/ui/PopupCard.tsx`: card compartilhado entre admin (preview) e CRM (real),
  com navegação entre páginas.
- CRM: `store/popups.ts`, `hooks/usePopups.ts` com `pickPopup`, `GlobalPopupHost`
  montado no `AppLayout`, e o campo `autoOpen` novo em `GuideContext` /
  `guideGating.ts` para o host esperar a decisão do guia.
- Testes: SQL (RLS), Deno (handlers e allowlist), Vitest (admin, CRM, pacote).

**Fora (não mexe):**
- Banners: tabela, RLS, página e container ficam como estão. A única mudança na
  `BannersPage` é passar a usar o `TargetPicker` extraído.
- Hub do cliente, landing e login: popups só aparecem dentro do shell logado do CRM.
- Targeting por rota (`target_paths`) e por papel (`target_roles`): não entram. Ambos
  são uma coluna a mais e um filtro a mais, sem migração dolorosa, se surgirem depois.
- CTA por página: não entra. O CTA é do popup e aparece só na última página.
- Crop ou redimensionamento de imagem: a imagem é exibida em 16:9 com
  `object-fit: cover`; o formulário só avisa a proporção recomendada.
- Auto-arquivamento por cron: como nos banners, `ends_at` é filtrado na leitura e o
  admin mostra o badge `EXPIRED` derivado no cliente.

## Parte 1: dados, RLS e edge

### Tabela `global_popups`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid PK` default `gen_random_uuid()` | |
| `pages` | `jsonb NOT NULL` | array de 1 a 6 páginas; formato abaixo |
| `cta_label` | `text` | |
| `cta_url` | `text` | relativa (`/ajuda/...`) ou absoluta (`https://...`) |
| `cta_style` | `text NOT NULL` default `'ink'` | `'ink'` (tinta escura, padrão dos CTAs do CRM) ou `'brand'` (amarelo `#ffbf30`) |
| `secondary_label` | `text` | opcional; ver defaults na Parte 2 |
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

Formato de cada item de `pages` (validado no `platform-admin`, ver abaixo):

```ts
interface PopupPage {
  title: string;              // 1 a 120 caracteres
  eyebrow?: string | null;    // até 60 caracteres; texto pequeno em caixa alta acima do título
  body: string;               // markdown, 1 a 2000 caracteres; react-markdown + remark-gfm, sem HTML cru
  image_key?: string | null;  // chave R2 `contas/<conta do admin>/files/<id>.<ext>`, mesmo caminho das capas da base de conhecimento
}
```

Popup de uma página é o array com um item. `pages` é jsonb em vez de tabela filha
porque o conteúdo é sempre lido e escrito inteiro, a ordem é o índice do array, e a RLS
fica em uma tabela só.

Constraints:

```sql
CHECK (jsonb_typeof(pages) = 'array' AND jsonb_array_length(pages) BETWEEN 1 AND 6)
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

O formato interno de cada página (campos obrigatórios, tamanhos) é responsabilidade do
`platform-admin`, único caminho de escrita. O banco garante só que é um array de 1 a 6.

`target_plan_ids` é `text[]` porque `plans.id` é text (a migration dos banners também
usa `text[]`, apesar da spec antiga dizer `uuid[]`).

### Tabela `popup_interactions`

Append-only. Uma linha por ação de um usuário sobre um popup.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid PK` | |
| `popup_id` | `uuid NOT NULL` FK `global_popups(id)` on delete cascade | |
| `user_id` | `uuid NOT NULL` FK `auth.users(id)` on delete cascade | |
| `action` | `text NOT NULL` | `CHECK (action IN ('seen', 'closed', 'cta', 'ack'))` |
| `created_at` | `timestamptz` default `now()` | |

Índice em `(popup_id, user_id)`. Sem UNIQUE: um usuário em `until_cta` pode ter vários
`closed` ao longo das sessões antes do `cta`. O CHECK em `action` é obrigatório porque
o INSERT é feito direto pelo cliente sob RLS, sem handler na frente; sem ele, qualquer
string viraria um bucket na view de contagens.

Não há métrica por página no banco. Fechar na página 2 de 3 grava `closed` como
qualquer outro fechamento; o funil por página fica no PostHog (Parte 3).

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

Em `until_cta`, quando o popup reaparece em outra sessão, abre na página 1.

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
| `create-popup` | Exige `pages` válido e `target_mode`. Insere só colunas da allowlist e `created_by = admin.id`. |
| `update-popup` | Exige `popup_id`; atualiza só colunas da allowlist; 400 se nada a atualizar. |
| `delete-popup` | Exige `popup_id`; 400 se `status <> 'draft'`; hard delete, cascade nas interações. |

Validação de `pages` no servidor (função pura `validatePages(input)` em um módulo
próprio, testável): array de 1 a 6; cada item com `title` (1 a 120), `body` (1 a
2000), `eyebrow` opcional (até 60), `image_key` opcional que precisa casar com
`^contas/[0-9a-f-]{36}/files/[^/]+$`. Chaves desconhecidas no item são rejeitadas.
Qualquer falha responde 400 com mensagem genérica.

Validação adicional no servidor, com 400 e mensagem genérica: par de CTA incompleto,
`until_cta` sem CTA, `require_ack` com `until_cta` (o banco também trava, mas o erro
de CHECK não deve vazar), `cta_label` e `secondary_label` com até 40 caracteres, e
`cta_url` com até 2048 caracteres começando com `/` ou com `http://` ou `https://`.
O `platform-admin` é o único caminho de escrita, então essas regras não podem viver só
no formulário: um label longo quebra a linha de botões lado a lado e uma URL malformada
vira no-op silencioso no CRM.

### `sign-r2-urls`

Hoje, chaves fora do prefixo `contas/<conta do usuário>/` só são assinadas se forem
`cover_image_url` de artigo publicado. Passa a assinar também as `image_key` das
páginas de `global_popups`, com uma query a mais só quando há `otherKeys`.

Essa query **não** roda no service role com um filtro solto de `status = 'active'`,
porque isso assinaria a imagem de um popup que o usuário nem pode ver (targeting por
plano ou workspace, janela de agenda). Ela roda em um client no contexto do usuário
(anon key + o header `Authorization` do request, o mesmo padrão de
`instagram-analytics` e `manage-workspace-roles`), então a RLS de `global_popups`
aplica exatamente o predicado da linha: ativo, dentro da janela e alvo do workspace.
O handler seleciona `pages` dos popups visíveis, extrai todas as `image_key` em código
e libera as que estão em `otherKeys`. O handler ganha uma dependência
`createUserDb(authHeader)` ao lado de `createDb`, injetável nos testes. A allowlist de
artigos continua no service role, porque artigo publicado é público para qualquer
usuário autenticado.

A consulta de popups fica **isolada em `try/catch` e com timeout próprio**
(`.abortSignal(AbortSignal.timeout(3000))` no builder do supabase-js) e degrada para
"nenhuma chave de popup", com log interno, nunca com 500. `try/catch` sozinho não
cobre um I/O que trava (AGENTS.md: kills do runtime passam por cima do `catch`); o
timeout é o que garante que o endpoint responde. Ele atende capas de artigo, editor
de post, drawers de fluxo e Estúdio pelo mesmo caminho; um defeito ou travamento na
parte nova não pode derrubar a assinatura das `ownKeys` de todo mundo.

Popups em draft, fora da janela ou não direcionados ao workspace não resolvem para
usuários do CRM. No admin, a chave está sob o prefixo da própria conta do admin, então
o preview do editor resolve por `ownKeys` como a capa de artigo já faz.

## Parte 2: admin

### Rota, navegação e API

- `apps/admin/src/router.tsx`: rota `popups`, lazy, `PopupsPage`.
- `AdminLayout` `NAV_ITEMS`: `{ to: '/admin/popups', icon: AppWindow, label: 'Popups' }`
  logo abaixo de Banners.
- `apps/admin/src/lib/api.ts`: interfaces `PopupPage` e `GlobalPopup` (colunas da
  tabela + `counts`) e `listPopups`, `createPopup`, `updatePopup`, `deletePopup`, no
  molde das funções de banner.
- Alias `@mesaas/ui` em `apps/admin/vite.config.ts` e `apps/admin/tsconfig.json`
  (`"@mesaas/ui/*": ["../../packages/ui/*"]`), igual ao CRM e ao Hub.

### `PopupsPage`

Mesma estrutura da `BannersPage`: cabeçalho com "New Popup", busca (casa com o título
de qualquer página), filtro de status, lista clicável, draft com opacidade reduzida,
badge `EXPIRED` derivado quando `status = 'active'` e `ends_at < now()`.

Colunas (desktop): título da primeira página com miniatura da imagem dela (ou
placeholder neutro), badge `N pages` quando há mais de uma, e linha de métricas
`seen · closed · cta · ack`; frequência (`Once` / `Until CTA`, com sufixo `· ack`
quando `require_ack`); target; agenda; status. Mobile: card compacto como o dos banners.

### Editor

Modal `max-w-5xl`. A partir de `md`, duas colunas: formulário à esquerda, preview
sticky à direita. Abaixo de `md`, uma coluna com o preview no fim.

O formulário tem dois blocos. No topo, as **abas de página**: uma aba por página com
número e título truncado, arrastável para reordenar com `@dnd-kit/sortable` (já é
dependência da raiz, usada em `SortableEtapaList` no CRM), botão `×` que remove a
página (com confirmação se ela tem conteúdo) e `+ Page` até o limite de 6. Cada
página do formulário carrega um `key` gerado no cliente (contador incremental) que é a
identidade estável para o `@dnd-kit` e para o React; índice como id é armadilha
conhecida quando se insere e remove itens. O `key` nunca vai para o payload:
`formToPayload` monta `pages` só com `title`, `eyebrow`, `body` e `image_key`.
Selecionar uma aba mostra os campos daquela página:

| Campo | Input | Regra |
|---|---|---|
| Title | text | obrigatório, até 120 |
| Eyebrow | text | opcional, até 60 |
| Image | dropzone com miniatura, replace, remove | opcional; aviso "recomendado 16:9, até 10 MB" |
| Body | textarea markdown | obrigatório, até 2000 |

Abaixo, sob o cabeçalho `Popup settings (apply to all pages)`, os campos do popup:

| Campo | Input | Regra |
|---|---|---|
| CTA label / CTA URL | dois text lado a lado | os dois ou nenhum; aparece só na última página |
| Secondary label | text | opcional; placeholder mostra o default que o CRM usará |
| CTA style | segmented `Ink` / `Brand yellow` | default Ink |
| Frequency | radio `Once per user` / `Every session until CTA` | default Once; desabilitado e forçado em Once enquanto Require acknowledgement está marcado |
| Require acknowledgement | checkbox | default off; marcar força Frequency = Once |
| Target | `TargetPicker` | igual aos banners |
| Starts at / Ends at | datetime-local | opcionais |
| Status | select | default Draft |

Botões: Create/Update, Cancel, Delete (só quando editando um draft).

Preview: `PopupCard` real com os valores do formulário, **controlado**: a página
exibida é a aba selecionada, e navegar no preview (pontinhos, Voltar, Próximo) troca
a aba. Toggle `Light` / `Dark`: o modo dark envolve o card em um wrapper que define
as variáveis legadas do CRM com os valores do tema escuro (`--card-bg: #12151a`,
`--text-main: #e8eaf0`, `--text-muted: #9ca3af`, `--border-color: #1e2430`).

### Validação no formulário

Antes de enviar, erro inline abaixo do campo (e a aba da página com erro ganha um
marcador):
- Página sem título ou sem corpo; limites de tamanho.
- CTA com label sem URL ou URL sem label.
- `until_cta` sem CTA.
- Target por plano ou workspace sem nenhum selecionado.
- URL do CTA que não começa com `/` nem com `http://` ou `https://`.

### Imagem

Reaproveita `uploadInlineImage` de `apps/admin/src/lib/inline-image.ts` (o fluxo da
capa de artigo: `file-upload-url` → PUT no R2 → `file-upload-finalize`). Guarda
`r2Key` em `pages[i].image_key`. O preview resolve as URLs assinadas de todas as
páginas com uma chamada a `resolveInlineImageUrls`. Trocar a imagem sobe uma nova e
substitui a chave; a antiga fica órfã no R2 como as capas de artigo substituídas
ficam hoje (mesma dívida, fora de escopo).

### `TargetPicker`

`apps/admin/src/components/TargetPicker.tsx`: os radios All / By Plan / By Workspace e
os chips de plano e de workspace, hoje inline na `BannersPage`. Props:
`mode`, `planIds`, `workspaceIds`, `plans`, `workspaces`, `onChange`. Usado nas duas
páginas. Nenhum outro trecho da `BannersPage` muda.

### `packages/ui/PopupCard.tsx`

Componente puramente visual, importado por caminho (`@mesaas/ui/PopupCard`), sem
importar nada de `apps/*`. Props:

```ts
interface PopupCardPage {
  title: string;
  eyebrow?: string | null;
  body: string;                       // markdown
  imageUrl?: string | null;           // já resolvida (assinada)
}

interface PopupCardProps {
  pages: PopupCardPage[];             // 1 a 6
  page: number;                       // índice da página exibida (controlado)
  onPageChange: (index: number) => void;
  ctaLabel?: string | null;
  ctaStyle: 'ink' | 'brand';
  secondaryLabel: string;             // já com default aplicado
  requireAck: boolean;                // esconde o X
  sanitizeHref: (href: string) => string;
  onCta?: () => void;
  onSecondary: () => void;
  onClose: () => void;                // X
  titleId?: string;                   // para aria-labelledby do Dialog
  bodyId?: string;                    // para aria-describedby do Dialog
}
```

Renderiza a página `page`: imagem 16:9 opcional com X sobreposto (sem imagem, o X
fica no canto do corpo); eyebrow; título; corpo (`react-markdown` + `remark-gfm`,
links via `sanitizeHref`, `target="_blank"`, `rel="noopener noreferrer"`); e a linha
de navegação. Com mais de uma página, o eyebrow recebe o sufixo `· n de N` (ou só
`n de N` quando a página não tem eyebrow).

Linha de navegação, por posição:

| Página | Esquerda | Centro | Direita |
|---|---|---|---|
| primeira (N > 1) | | pontinhos | `Próximo` (estilo do CTA) |
| do meio | `Voltar` (link discreto) | pontinhos | `Próximo` |
| última (N > 1) | `Voltar` acima da linha de botões | pontinhos | CTA (se houver) + secundário, lado a lado |
| única (N = 1) | | | CTA (se houver) + secundário |

Os pontinhos são botões (`aria-label="Página n de N"`) e trocam de página. `Voltar` e
`Próximo` chamam `onPageChange`. O X, quando não há `requireAck`, aparece em todas as
páginas. Com `requireAck` e sem CTA, a última página tem só o secundário. Trocar de
página anima com um fade curto; sem swipe no mobile nesta versão.

Largura máxima 420px; abaixo de 480px de viewport, margem de 16px e botões da última
página empilhados.

Estilo com os tokens legados do CRM e fallback claro: `var(--card-bg, #ffffff)`,
`var(--text-main, #12151a)`, `var(--text-muted, #374151)`,
`var(--border-color, rgba(30,36,48,.1))`, raio 12px, fonte `var(--font-main, -apple-system, ...)`.
CTA `ink`: fundo `#12151a`, texto branco. CTA `brand`: fundo `#ffbf30`, texto `#12151a`.
`Próximo` usa o mesmo estilo do CTA. Secundário: outline com `--border-color`.
`Voltar`: texto em `--text-muted`, sem borda.

Defaults de `secondary_label`, aplicados por quem monta o card (CRM e preview do admin
usam a mesma função `defaultSecondaryLabel(requireAck, hasCta)` exportada do pacote):
`requireAck` → "Entendi"; senão com CTA → "Agora não"; senão → "Fechar".

## Parte 3: CRM

### Store (`apps/crm/src/store/popups.ts`)

- `getActivePopups()`: `select` com lista explícita de colunas em `global_popups`,
  `order('created_at', desc)`. A RLS filtra. Erro é lançado; o hook trata.
- `getMyPopupInteractions()`: `popup_id, action` de `popup_interactions` do usuário atual.
- `recordPopupInteraction(popupId, action)`: `insert`.

Tipos `GlobalPopup`, `PopupPage` e `PopupInteraction` exportados daqui; sem hooks no
store. O CRM confia no formato de `pages` (só o `platform-admin` escreve), mas
`getActivePopups` descarta em código qualquer popup cujo `pages` não seja um array
não vazio, com `console.warn`, para um dado inesperado nunca derrubar o shell.

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

1. Espera o guia de primeiros passos decidir se vai abrir sozinho. Amostrar
   `isOpen` uma vez não basta: a auto-abertura do guia depende de cinco queries de
   sinais (`useGuideSignals`) que podem resolver depois das duas queries do popup,
   e aí o guia abriria por cima do popup já exibido. `GuideApi` ganha
   `autoOpen: 'unknown' | 'no' | 'yes'`, calculado em `GuideProvider` por uma função
   pura `guideAutoOpenState(...)` em `guideGating.ts`, ao lado de
   `shouldAutoOpenGuide` e com as mesmas condições **menos o pathname**: `'yes'`
   quando já abriu ou vai abrir assim que o dono chegar em `/dashboard` (dono, sem
   progresso registrado, zero clientes e zero fluxos); `'no'` quando não é dono, o
   guia já foi aberto, dispensado ou concluído, os sinais resolveram com algum
   cliente ou fluxo, **ou qualquer um dos dois sinais terminou em `error`** (o guia
   nunca abre sobre erro, como `shouldAutoOpenGuide`, então o popup não fica
   esperando); `'unknown'` só enquanto auth ou os sinais estão em `pending`. O host
   espera enquanto for `'unknown'` e, se for `'yes'` (ou `useGuide()?.isOpen`), grava
   `mesaas_popup_skipped` e não mostra nada nesta sessão. `useGuide()` devolve null
   fora do provider; null conta como `'no'`.
2. `pickPopup(...)`. Se null, encerra.
3. Coleta as `image_key` de todas as páginas e resolve em uma chamada a
   `resolveInlineImageUrls`. Falhou: abre com as páginas sem imagem.
4. Espera 800 ms após o load e abre na página 1.
5. Ao abrir: grava `mesaas_popup_shown`, `markSeen` (se ainda não há `seen` no cache)
   e `captureEvent('popup_shown', { popup_id, pages: N })`.

**Não usa o `DialogContent` do CRM.** Ele envolve os filhos em um wrapper fixo com
`p-6` e renderiza um `DialogPrimitive.Close` (o X do canto) sem nenhuma prop que
desligue os dois, então o card ficaria com padding indesejado, dois X sobrepostos e,
em `require_ack`, um X funcional. O host compõe os primitivos diretamente:
`Dialog`, `DialogPortal` e `DialogOverlay` exportados de `components/ui/dialog`
(mesmo overlay, mesmo `z-[9010]`), e um `DialogPrimitive.Content` próprio de
`@radix-ui/react-dialog` centralizado, `z-[9011]`, sem padding e sem X, com o
`PopupCard` como único filho. `dialog.tsx` não muda.

Com `require_ack`: `onEscapeKeyDown` e `onInteractOutside` com `preventDefault` no
`Content`, e `requireAck` no card esconde o X do próprio card. A pessoa precisa
chegar à última página e clicar no botão de confirmação. O título da página atual
recebe um `id` e o `Content` aponta `aria-labelledby` para ele; `aria-describedby`
vai para o corpo.

O host guarda o índice da página em estado local. Cada troca dispara
`captureEvent('popup_page', { popup_id, page })`, o que dá o funil por página sem
tocar no banco.

Ações:

| Origem | Interação gravada | Sessão | Evento PostHog | Depois |
|---|---|---|---|---|
| X em qualquer página, ou botão secundário (sem `require_ack`) | `closed` | `closed:<id>` | `popup_closed` com `page` | fecha |
| Botão secundário (com `require_ack`) | `ack` | | `popup_ack` | fecha |
| CTA (só na última página) | `cta` | | `popup_cta` | fecha e navega |

Navegação do CTA: `safe = sanitizeUrl(cta_url)`. Se `safe` começa com `/`,
`navigate(safe)` do router. Senão, `openExternalUrl(cta_url)` de `utils/security.ts`,
que devolve `null` sem abrir nada quando a URL é rejeitada (`sanitizeUrl` devolve `'#'`
nesses casos; nunca chamar `window.open` com esse valor). A interação `cta` é gravada
antes de navegar, e o popup fecha mesmo quando a navegação vira no-op.

Os cinco nomes de evento (`popup_shown`, `popup_page`, `popup_closed`, `popup_cta`,
`popup_ack`) entram na união `AnalyticsEvent` em `apps/crm/src/lib/analytics.ts`,
que é tipada.

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
  `user_id` de A; `pages` vazio e `action` inválida são rejeitados pelo CHECK.
- **Deno** (`supabase/functions/__tests__/`): `platform-admin-popups_test.ts` (campos
  obrigatórios, `validatePages` com cada limite e chave desconhecida, par de CTA,
  `until_cta` sem CTA, `require_ack` com `until_cta`, delete só em draft, `counts`
  montado da view); extensão de `sign-r2-urls_test.ts` (chave de página de popup
  visível pelo `createUserDb` assinada; chave que o client do usuário não devolve, por
  ser draft ou não direcionado, negada; e continua negando chave de outra conta).
- **Vitest admin** (`apps/admin/src/pages/__tests__/PopupsPage.test.tsx`,
  `apps/admin/src/components/__tests__/TargetPicker.test.tsx`): `formToPayload`
  (nulos, datas em ISO, arrays só no modo certo, `pages` montado das abas), as
  validações inline incluindo página sem título, adicionar/remover/reordenar página
  respeitando o limite de 6, `TargetPicker` troca de modo e limpa seleções.
- **Vitest CRM**: `pickPopup` com os quatro descartes e a ordenação;
  `guideAutoOpenState` (não dono, sinais pendentes, dono novo fora do dashboard,
  dono com clientes, progresso já registrado); `GlobalPopupHost` (some o X com
  `require_ack`, Esc bloqueado, CTA relativo chama `navigate`, CTA absoluto chama
  `window.open`, interações e eventos gravados incluindo `popup_page`, espera enquanto
  o guia está `'unknown'` e pula em `'yes'`, erro de query não renderiza nada, `pages`
  malformado é descartado).
- **Vitest pacote** (`packages/ui/__tests__/PopupCard.test.tsx`): defaults de
  `secondaryLabel`, links sanitizados, botões por posição da página (primeira, meio,
  última, única), pontinhos trocam de página, sufixo `n de N`.
- **Browser** (staging, login seed): criar popup de 3 páginas no admin com imagem,
  ver no CRM em light e dark navegando entre páginas, confirmar `until_cta`
  reaparecendo em nova aba na página 1 e sumindo após o CTA.

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
- **Popup em cima do guia.** Se o wizard de primeiros passos abre sozinho, ou vai
  abrir assim que o dono chegar ao dashboard, o popup pula a sessão inteira em vez de
  aparecer logo depois. Menos intrusivo para quem acabou de entrar. O custo é o campo
  `autoOpen` a mais na `GuideApi`; sem ele, a ordem de resolução das queries decidiria
  se os dois modais abrem juntos.
- **Editar um popup ativo não o reexibe para quem já interagiu.** "Já viu" é por
  `popup_id`, não por conteúdo, igual aos banners. Corrigir o texto de um aviso com
  confirmação obrigatória só alcança quem ainda não confirmou; para reexibir a todos,
  o admin arquiva e cria outro. Registrado como escolha consciente; uma action
  "resetar vistos" pode entrar depois se virar caso de suporte recorrente.
- **`pages` em jsonb, não em tabela filha.** Ganha simplicidade de RLS e de CRUD; perde
  a validação de formato no banco, que fica no `platform-admin`. Se um dia precisar de
  métrica por página no banco, uma tabela filha entra sem migrar o conteúdo.
- **CTA só na última página.** Quem fecha antes não vê o CTA. É o comportamento
  desejado: o CTA é a conclusão do anúncio, não um atalho.
- **Imagens órfãs no R2** ao trocar ou remover a imagem: mesma dívida das capas de
  artigo; fora de escopo.
- **`seen` sem UNIQUE**: a deduplicação é no cliente. Uma corrida entre duas abas pode
  gravar dois `seen`; a view conta `distinct user_id`, então a métrica não infla.

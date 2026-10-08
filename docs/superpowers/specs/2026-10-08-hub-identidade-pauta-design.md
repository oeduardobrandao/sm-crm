# Hub "Pauta": identidade visual própria do portal do cliente - design

Mockups: https://claude.ai/artifact/ArhzoNmFpw1wg1oWXvuhFm (linha "Direção A · Pauta" e quadro "Fundamentos"). Revisado por Fable e Codex (duas rodadas) em 2026-10-08.

## Contexto

O Hub hoje lembra o Claude. Nenhum elemento sozinho, mas a soma: saudação em serifa com o nome em itálico e emoji (`HomePage.tsx`), fundo creme com brilho radial (`.hub-noise`, superfície Quente `#FAF7F2`), Fraunces + Instrument Sans como par padrão, primário em tinta `#171717` em todo hub sem personalização, números de KPI em serifa e o vermelho de correção terracota `#b0472e` (`.hub-pill-danger`).

Cor, fonte, raio e estilo de cartão são do dono do workspace (`packages/hub-theme/theme.ts`, colunas `hub_*` em `workspaces`, gate `feature_brand_customization`). Uma identidade baseada nesses eixos some na primeira troca de configuração. Por isso a identidade "Pauta" mora no que **não** é configurável: composição da saudação, anatomia do item ativo do menu, faixa de KPIs, cabeçalho de seção (marcador + rótulo + título), selos de status e a regra de que o raio escolhido chega a todo controle.

### Decisões do usuário

1. Direção A, "Pauta", escolhida no canvas.
2. **Aprovações e Postagens mantêm a grade** (`PostGrid` / `PostTile` + `PostDetailDialog`). Nada de lista com painel lateral; só o restyle dos selos e controles.
3. **No celular fica o menu hambúrguer flutuante** de hoje (`HubMobileNav`: barra que vira pílula flutuante ao rolar + gaveta à direita). Nada de barra inferior; só o restyle.
4. A cor da marca vira o primário (botões, item ativo, marcadores) **em todos os planos**. A personalização continua controlando superfície, fontes, raio, estilo de cartão e logo.
5. Novo par padrão Bricolage Grotesque + Figtree ("Assinatura") **só para hubs sem personalização** e workspaces novos. Workspaces personalizados mantêm as fontes gravadas.
6. Superfície Quente ajustada para linho (`#F8F5F3`).
7. **Piloto primeiro**: tudo atrás de flag por workspace, ligado antes só no DK Marketing Médico (`cbaf0da8`).

## Fora de escopo

- Paleta do tema "hub" dos relatórios de blocos (`packages/report-blocks/theme.ts` lê `PALETTES`). Fica clássica até a limpeza pós-lançamento. Efeito colateral aceito: o relatório lê `HUB_DISPLAY_FONTS`/`HUB_BODY_FONTS` (`theme.ts:224`), então um workspace que gravar Bricolage/Figtree já os vê nos relatórios.
- Visual do CRM. No CRM mudam só a prévia do Hub e o seletor de par em Configuração (com a flag) e os tipos de feature.
- Novos eixos de personalização, a direção B (Mosaico) e navegação superior.
- Mudanças de comportamento: filtros, ordenação, deep links, diálogo do post, fluxo de aprovação e gaveta do menu funcionam como hoje. O significado das cores também não muda: os pontos do calendário continuam indicando o **formato** do post (`TIPO_COLOR`), não o status.

## Gate: `plans.feature_hub_pauta`

Mesmo padrão de `feature_agenda` / `feature_multiplatform`.

**Banco e funções**
- Migração `ALTER TABLE plans ADD COLUMN feature_hub_pauta boolean NOT NULL DEFAULT false`. Chave em `FEATURE_COLUMNS` (`supabase/functions/_shared/entitlements.ts`).
- `hub-bootstrap` resolve `feature("feature_hub_pauta")` junto dos outros e devolve `feature_hub_pauta: boolean`. Erro na resolução = `false`.

**Admin** (sem isto o override do piloto e o lançamento não existem): `apps/admin/src/lib/api.ts` ganha a chave no tipo `Plan`, em `FEATURE_FLAG_KEYS` e em `FEATURE_FLAG_LABELS` ("Hub: visual Pauta"). `WorkspaceDetailPage` e `PlansPage` já iteram a lista. Atualizar os fixtures `plan-form.test.ts` e `featureFlags.test.ts`.

**CRM**: `FeatureFlags` em `apps/crm/src/hooks/useWorkspaceLimits.ts` ganha `feature_hub_pauta?: boolean` (opcional, para não exigir mudança nos fixtures que listam todas as flags). `entitlement-errors.ts` não muda: nenhuma rota levanta `feature_disabled:feature_hub_pauta`.

**Hub**
- `apps/hub/src/types.ts`: `feature_hub_pauta?: boolean` no bootstrap.
- `useHubLook(): 'classic' | 'pauta'` = `useContext(HubContext)?.bootstrap.feature_hub_pauta ? 'pauta' : 'classic'`. Não usa `useHub()` (que lança sem provider) e **não** acrescenta campo ao tipo do contexto, para não mexer nos 19 testes que montam `HubContext.Provider` à mão. Componentes renderizados sem provider (testes de `StatusTag`, `StatusPill`, `PostTile`) caem no clássico.
- `HubShell` põe `data-hub-look="pauta"` no `.hub-root` e passa `look` ao resolvedor.
- `ConvitePage` (convite público da Agenda, fora do `HubShell`) fica clássica no piloto.

**Garantia do clássico.** Flag desligada = visual idêntico ao de hoje: as variáveis CSS existentes têm os mesmos valores e todo componente renderiza a mesma marcação e classes. A folha de estilos ganha variáveis novas (ver Tokens), então o texto serializado em `:root` não é byte a byte o mesmo; isso é esperado. Única exceção intencional: os spinners de carregamento (ver Componentes).

**Rollback** = remover o override no Admin. O `hub-bootstrap` é cacheado com `staleTime: Infinity` (`queries.ts:25`), então uma aba aberta segue no Pauta até recarregar. Aceito: não há dado em jogo, só aparência.

## Tokens (`packages/hub-theme/theme.ts`)

`resolveHubTheme(config, dark, look = 'classic')`. Com `'classic'` as variáveis existentes saem com os valores de hoje. Com `'pauta'`:

| Token | Pauta |
|---|---|
| `--hub-primary` / `--hub-primary-fg` | `acc` / `accFg` sempre, mesmo com `customized: false` |
| `--hub-ring` | `color-mix(in srgb, acc 22%, transparent)` sempre |
| Superfície Quente | `PAUTA_WARM` (abaixo); Neutra e Fria iguais às clássicas |
| `--hub-acc-soft` (novo) | `color-mix(in srgb, acc 16%, transparent)` |
| `--hub-display-weight` (novo) | 500 para Fraunces, 600 para as demais |
| `--hub-shadow-card` (novo) | `0 1px 2px rgba(16,16,16,.05)` em Preenchido claro; `none` nos demais |
| `--hub-r-card` / `--hub-r-ctl` | iguais aos clássicos (0/12/18 e 0/12/999) |
| `--hub-r-chip` (novo) | Reto 3px · Suave 8px · Pílula 999px |
| `--hub-r-tile` (novo) | Reto 0 · Suave 8px · Pílula 14px |
| `--hub-r-dot` (novo) | Reto 0 · Suave 2px · Pílula 999px |
| `--hub-st-{tom}-fg` / `-bg` (novo) | tabela de status abaixo |

No clássico as variáveis novas também são emitidas, com valores que não mudam nada visível (elas só são lidas por regras e ramos do Pauta).

`PAUTA_WARM`: claro `bg #F8F5F3, card #FFFFFF, txt #1F1A17, tx2 #5A514C, tx3 #6F655F, bd rgba(31,26,23,.08), bd2 rgba(31,26,23,.2), soft #F0EAE6`; escuro `bg #141110, card #1D1917, txt #F6F1EE, tx2 #BBB1AB, tx3 #958A84, bd rgba(246,241,238,.09), bd2 rgba(246,241,238,.22), soft #29231F`. (`tx3` claro `#6F655F`: 4.76:1 sobre `soft`, 5.23:1 sobre `bg`.) `PALETTES` não muda.

### Fontes

- `HUB_DISPLAY_FONTS['bricolage-grotesque']` (`opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700`) e `HUB_BODY_FONTS['figtree']` (400 a 700). Par `{ display: 'bricolage-grotesque', body: 'figtree', label: 'Assinatura' }` entra primeiro em `HUB_FONT_PAIRINGS`.
- Migração recria os CHECKs `hub_font_display_allowed` e `hub_font_body_allowed` com os ids novos. Os dois testes `font allowlist sync` de `theme.test.ts` (espelho dos CHECKs) mudam junto. Os defaults das colunas **não** mudam no piloto.
- Hub sem personalização com Pauta usa `assinatura`; o clássico continua com `fraunces` + `instrument-sans`. Personalizado usa o que está gravado nos dois visuais.
- Os ids efetivos saem de uma função só, `effectiveHubFonts(look, customized, stored)` em `packages/hub-theme`, usada pelo resolvedor **e** pelos dois carregadores de fonte: o efeito do `<link id="hub-custom-fonts">` no `HubShell` (que hoje decide só por `isCustomized`; `look` entra nas dependências) e o `HubPreview` do CRM. `buildGoogleFontsHref` não muda: ele já emite qualquer id diferente dos pré-carregados no `index.html`.
- No CRM o par "Assinatura" só aparece no seletor do `HubTab` com a flag ligada. Fora do piloto nenhum workspace consegue gravá-lo pela interface (o CHECK aceita os ids, mas só a interface do piloto os oferece). Aceito no piloto: troca de fonte visível no primeiro carregamento (FOUT), porque o `index.html` só pré-carrega Fraunces + Instrument Sans. A limpeza troca o pré-carregamento.

### Status

Um conjunto fixo, nunca derivado do acento. Contraste medido (Fable): pior `fg` sobre `bg` composto no cartão 5.54:1, pior `fg` sobre o cartão 6.33:1.

| Tom | Usos | Claro fg / bg | Escuro fg / bg |
|---|---|---|---|
| `wait` | `enviado_cliente`; RSVP pendente | `#8A5300` / `rgba(214,138,0,.14)` | `#F2B65A` / `rgba(242,182,90,.14)` |
| `fix` | `correcao_cliente`, `falha_publicacao`; RSVP recusado | `#B42318` / `rgba(180,35,24,.09)` | `#FF8F85` / `rgba(255,143,133,.13)` |
| `ok` | `aprovado_cliente`; RSVP confirmado | `#146C46` / `rgba(20,108,70,.10)` | `#5BD69B` / `rgba(91,214,155,.13)` |
| `sched` | `agendado`, `publicando` | `#1F4FB0` / `rgba(31,79,176,.10)` | `#93B4FF` / `rgba(147,180,255,.14)` |
| `prod` | `em_producao` | `#6D3FC4` / `rgba(109,63,196,.10)` | `#C3A6FF` / `rgba(195,166,255,.14)` |
| `done` | `postado` | `--hub-tx2` / `--hub-soft` | idem |

`statusTone(status)` em `lib/postView.ts` mapeia os 8 status de `STATUS_COLORS` (que continua servindo o clássico).

## Componentes

Regra geral: classes que só existem para o Pauta ou regras `.hub-root[data-hub-look='pauta'] …` no `<style>` de `apps/hub/index.html`. **Estilo inline não é alcançável por CSS**: todo componente que pinta cor ou raio via `style={}` ramifica em TSX com `useHubLook()`, mantendo o ramo clássico intacto.

**Utilitários (`index.html`, escopo Pauta).**
- `HubShell` não aplica `.hub-noise` no Pauta.
- `.hub-btn-primary`, `.hub-btn-secondary`: `border-radius: var(--hub-r-ctl)`.
- `.hub-pill`: raio `--hub-r-chip` e ponto `currentColor` de 6px. Cores por tom semântico (`.hub-pill-st-wait|ok|fix|neutral`, ver `StatusPill`).
- `.hub-eyebrow` (nova): 11.5px, 600, caixa-alta, `letter-spacing .09em`, `--hub-tx3`, `::before` de 7×7px em `--hub-acc` com raio `--hub-r-dot`. Variante `.hub-eyebrow-plain` sem marcador.
- `.hub-nav-pill` (nova): fundo `--hub-primary`, texto `--hub-primary-fg`, raio `--hub-r-ctl`.
- `.hub-display-title` (nova): `font-weight: var(--hub-display-weight)`. Aplicada só a títulos de `PageHeader` e da `HomePage`. Não há regra sobre `.font-display` (sobrescreveria `font-medium`/`font-semibold` explícitos em 37 lugares).
- `.hub-card`: sombra `--hub-shadow-card`.

**`HubSidebar`.** Fundo `--hub-bg` sem borda direita (o menu se funde à página; o conteúdo flutua em cartões). Item ativo `.hub-nav-pill`. Contador: inativo em `--hub-acc-soft` + `--hub-txt`; ativo invertido (`--hub-primary-fg` sobre `--hub-primary`), raio `--hub-r-chip`. `WorkspaceMark` sem logo com raio `--hub-r-tile`. Rodapé: avatar, nome do cliente, idioma e o botão de tema com borda e raio `--hub-r-ctl`.

**`HubMobileNav`.** Comportamento, foco, `Escape`, trava de rolagem e sentinela de rolagem iguais. Visual: pílula da barra com raio `--hub-r-card`; botão do menu com raio `--hub-r-ctl` e, quando a soma dos contadores (aprovações + mensagens não lidas) é maior que zero, um contador no canto do botão em `--hub-primary` / `--hub-primary-fg` (com `aria-label` "Abrir menu, N pendências"); itens ativos da gaveta com `.hub-nav-pill`; contadores da gaveta como no `HubSidebar`.

**`PageHeader`.** Ganha `eyebrow?: ReactNode`. No Pauta as páginas passam o nome do cliente (`bootstrap.cliente_nome`) como eyebrow e o título usa `.hub-display-title`.

**`HomePage`** (ramo Pauta; testes novos usam bootstrap com `feature_hub_pauta: true`, os atuais seguem no clássico).
1. **Saudação.** Eyebrow com a data: dia da semana longo sem "-feira" e com inicial maiúscula + dia + mês ("Quinta, 8 de outubro"; em inglês "Thursday, October 8"). Título `.hub-display-title`: "Bom dia" (5h a 11h59), "Boa tarde" (12h a 17h59), "Boa noite" (18h a 4h59), vírgula, primeiro nome e ponto. Sem itálico, sem emoji, sem o avatar de 128px. Frase-resumo com contagens em chips `--hub-acc-soft`, só as cláusulas não nulas:
   - pendentes = posts `enviado_cliente` (o `pendingCount` de hoje);
   - semana = posts `agendado` ou `aprovado_cliente` com `scheduled_at` no intervalo `[agora, início da próxima segunda-feira)`, na zona do navegador (a mesma que o calendário do Hub já usa para agrupar dias);
   - "Você tem **2 posts** para aprovar e **3 publicações** saindo esta semana." / só uma das cláusulas / nenhuma → "Tudo em dia por aqui."
   Botão primário "Revisar aprovações" à direita quando há pendentes; substitui o banner de pendências.
2. **Faixa de KPIs.** Um `.hub-card` com quatro células separadas por fios (`--hub-bd`), 2×2 abaixo de `sm`. Mesmas métricas de hoje. Rótulo `.hub-eyebrow-plain`, número em `.font-display` com `tabular-nums`; a célula "Para aprovar" usa `.hub-eyebrow` (com marcador) e o link "Revisar agora" quando o número é maior que zero.
3. **Seções numeradas.** `.hub-card` com cabeçalho (`.hub-eyebrow` "01 · Aprovações" + título `.hub-display-title` + link à direita). A `HomePage` calcula os números a partir só do que ela sabe de forma síncrona: "Esperando você" existe quando `pendingCount > 0` depois que `hubPostsQuery` carregou (durante o carregamento a home inteira mostra o estado de carregamento atual) e "Agenda" existe quando `feature_agenda` está ligado. Nenhum filho decide se aparece ou não depois de numerado, exceto Resultados, que é a última.
   - `Aprovações` "Esperando você": até 3 posts `enviado_cliente` do `hubPostsQuery` já carregado (sem fetch novo), em linhas: capa 48×60 (`getPostCover`), título, formato (`getTipoLabel`) · plataforma (`getPlatformLabel`, o mesmo rótulo de `PostCard` e `PostDetailDialog`) · data, selo `wait` e "Revisar" para `/aprovacoes/:postId`. Some sem pendentes. Link do cabeçalho "Ver todas".
   - `Calendário`: o `PostCalendar` atual (mês) dentro do cartão.
   - `Agenda` (só com `feature_agenda`) e `Recursos` lado a lado a partir de `lg` (2fr / 1fr); sem Agenda, Recursos ocupa a linha. No Pauta, `HomeAgenda` ganha `sectionNumber` e passa a ser **um único cartão** sempre presente com a flag de agenda: o aviso "N eventos aguardando sua resposta" vira uma linha no topo do cartão (não mais um irmão solto), e sem eventos próximos o cartão mostra o estado vazio "Nenhum evento nos próximos dias" com o link para a Agenda. O ramo clássico continua devolvendo `null` sem eventos e os dois irmãos com eventos. Recursos vira lista de linhas (ícone em `--hub-soft` com raio `--hub-r-tile`, rótulo, chevron).
   - `Resultados`: o `DashboardSection` ganha a prop `sectionNumber?: number`; com ela (Pauta) o próprio componente troca o seu `h2` pelo cabeçalho numerado com o título "Desempenho" e mantém o `PeriodSelector` à direita. Carregamento, erro (`null`) e "conecte o Instagram" ficam como hoje. Por ser a última seção, o `null` no erro não deixa buraco na numeração.

**`StatusPill`.** Ganha `semantic?: 'wait' | 'ok' | 'fix' | 'neutral'`. No clássico renderiza só por `tone` (como hoje). No Pauta usa `semantic` (fallback: `tone`). Motivo: `accent` significa "pendente" em `PostCard` e "confirmado" na Agenda, então não dá para remapear o tom por CSS. Chamadas: `PostCard` pendente → `wait`, aprovado → `ok`, correção → `fix`; `AgendaCardView`/`HomeAgenda`/`PostCalendar` (`selo()`) RSVP confirmado → `ok`, recusado → `fix`, pendente → `wait`.

**`StatusTag`** (selo do tile, inline hoje). Ramo Pauta em TSX: fundo `--hub-card` (legível sobre qualquer capa), texto `--hub-st-{tom}-fg`, ponto, raio `--hub-r-chip`. O clássico mantém `rounded-[4px]` e as cores de `STATUS_COLORS` (o teste atual continua valendo).

**`PostGrid` / `PostTile`.** A grade imita o perfil do Instagram (`grid-cols-2 sm:grid-cols-3`, 4:5, `gap-1`, tiles sem raio) e continua exatamente assim, inclusive as duas colunas no celular, em qualquer preset. No Pauta muda só: glifo de formato com raio `--hub-r-chip`, anel de seleção em `--hub-primary`.

**`StoriesRail`** (cores inline). Ramo Pauta: anéis/selos com os tokens de status e raios do preset.

**`PostCalendar`.** Pontos continuam por formato (`TIPO_COLOR`). O número do dia de hoje, que hoje é texto em `--hub-acc` (ilegível com uma marca âmbar), passa no Pauta a um círculo `--hub-primary` com texto `--hub-primary-fg`. Selos via `StatusPill semantic`.

**`PostCard`.** Selos via `StatusPill semantic`; o selo `agendado` (`bg-emerald-50 text-emerald-700` fixo, `PostCard.tsx:361`) usa o tom `sched` no Pauta.

**Filtros (`FloatingFilterBar`, `StatusFilterChips`, `FilterDropdown`, `MediaFilterDropdown`, `MonthFilterDropdown`, `SortToggle`).** Raios `--hub-r-ctl` / `--hub-r-chip`; opção ativa em `.hub-nav-pill`. O botão "Selecionar" de Aprovações (`rounded-[4px]`) passa a `.hub-btn-secondary` no Pauta.

**`PostDetailDialog` / `CorrectionPanel`.** Só tokens: "Aprovar" `.hub-btn-primary`, "Pedir ajuste" `.hub-btn-secondary`, selos semânticos. Nenhuma mudança de layout.

**Spinners.** `border-stone-300 border-t-stone-900` passa a `--hub-bd2` / `--hub-txt` **nos dois visuais**: é a exceção declarada à garantia do clássico, porque hoje ignoram o modo escuro.

## i18n (`packages/i18n/locales/{pt,en}/hubHome.json`)

Chaves novas em `home.pauta.*`: `greeting.morning|afternoon|evening` (com `{{name}}`), `summary.both`, `summary.pendingOnly`, `summary.weekOnly`, `summary.none`, `chip.posts_one|_other`, `chip.publications_one|_other`, `cta.review`, `kpi.reviewNow`, `section.approvals|calendar|agenda|resources|results` (rótulos do eyebrow), `waiting.title`, `waiting.seeAll`, `waiting.review`, `resources.title`. A frase-resumo usa `<Trans>` com componentes para os chips (padrão de `calendar.eventosCount`). Rótulo do contador do menu em `common` (`nav.openMenuPending_one|_other`).

## CRM

- `HubTab`: com a flag ligada, o seletor de par mostra "Assinatura" primeiro, rotulado "Padrão"; com ela desligada, o seletor fica como hoje (sem "Assinatura", "Editorial" como padrão). Um workspace que já gravou Assinatura e perde a flag continua vendo o par selecionado no seletor.
- `HubPreview`: recebe `look` do `HubTab` (como já recebe `customized`, `HubTab.tsx:680`), lido de `useWorkspaceLimits().features.feature_hub_pauta`. Com `pauta`, reproduz menu, saudação, faixa de KPIs e um tile com selo, usando os mesmos tokens de `packages/hub-theme`.

## Acessibilidade

- O acento nunca é cor de texto sobre `--hub-bg`/`--hub-card`. Texto sobre acento usa `accFg`.
- Status: 4.5:1 ou mais nos dois modos, medido sobre `--hub-card` **e** sobre `--hub-bg` (cartão Contorno é transparente).
- Alvos de toque: itens do menu com 40px ou mais no desktop e 48px na gaveta; botões primários 44px.
- `prefers-reduced-motion` continua desligando `.hub-fade-up`.

## Testes

- `theme.test.ts`: testes atuais intactos, exceto os dois `font allowlist sync`, que ganham os ids novos. Novos: Pauta com primário = acento e `customized: false`; Quente usa `PAUTA_WARM` (e o teste de contraste de `tx3` cobre `PAUTA_WARM`); tokens de raio por preset; `--hub-display-weight` por fonte; contraste dos tokens de status sobre cartão e fundo de cada superfície; clássico com os mesmos valores nas variáveis existentes.
- Hub (Vitest): `useHubLook` sem provider = clássico; `HubShell` só põe `data-hub-look` com a flag; `HomePage` Pauta (faixas de hora, frase com zero/uma/duas cláusulas, contagem da semana sem pendentes, "Esperando você" ausente sem pendentes, renumeração sem Agenda); `HubSidebar`/`HubMobileNav` com `.hub-nav-pill` e contador no botão do menu; `HubShell` carrega Bricolage + Figtree num hub Pauta sem personalização (e nada a mais no clássico); `HomeAgenda` Pauta com e sem eventos; contagem da semana na fronteira de domingo para segunda; `PageHeader` com eyebrow; `StatusPill` usa `semantic` só no Pauta; `StatusTag` Pauta; `statusTone` cobre os 8 status. Os testes atuais de `contentPages.test.tsx` (saudação "Olá,", cartão "Aprovações pendentes", avatar) continuam no clássico.
- `hub-bootstrap`: devolve `feature_hub_pauta` e cai para `false` quando a resolução falha.
- Entitlements (psql): `99_hub_pauta_flag.sql` com default `false`, override por workspace e os CHECKs aceitando os ids novos e recusando um desconhecido.
- Admin: fixtures com a chave nova; a flag aparece em `PlansPage` e no override do workspace.
- CRM: `HubPreview` com `look` clássico e Pauta (e as fontes efetivas de cada um); `HubTab` mostra "Assinatura" só com a flag.
- Navegador (Hub em `:5175`, workspace com override): as seis combinações da matriz do canvas, claro e escuro, em Início, Aprovações (grade + diálogo), Postagens, Agenda e a gaveta a 390px. Flag desligada: comparar com produção.

## Lançamento

1. Migração (coluna + CHECKs): staging, depois prod. Versão acima da cauda da `main` no momento do PR. Em cada ambiente, a migração vem **antes** do deploy do `platform-admin` (`plan-mutations` espalha `FEATURE_COLUMNS` nas escritas de plano).
2. `entitlements.ts` com a chave; redeploy de `hub-bootstrap`, `workspace-limits`, `platform-admin` e `paywall-report` (`--use-api`, `--no-verify-jwt` onde já usam), antes do merge.
3. Merge (deploy do Hub, CRM e Admin pela Vercel).
4. Override `{"feature_hub_pauta": true}` no DK (`cbaf0da8`) pelo Admin.
5. Piloto: Início, Aprovações, Postagens, Agenda e a gaveta no celular de verdade (iOS Safari); prévia no CRM.
6. Lançamento: ligar a coluna em todos os planos.
7. Limpeza (PR separado): remover o ramo clássico e a flag (runbook de remoção de coluna de feature); `PAUTA_WARM` vira `PALETTES.warm` (decidir junto se o tema "hub" dos relatórios acompanha); `ConvitePage` no Pauta; `index.html` pré-carrega Bricolage + Figtree; defaults das colunas `hub_font_display`/`hub_font_body` passam a `bricolage-grotesque`/`figtree`.

## Riscos

- **Dois caminhos de render** durante o piloto. O ramo clássico não muda; ele sai inteiro na limpeza.
- **Hub sem `brand_color`**: o `hub-bootstrap` manda `#1a1a2e` como fallback, que vira o primário no Pauta (azul-marinho quase tinta). Aceitável; no escuro o resolvedor já troca para `#F5F5F5`.
- **Workspaces personalizados com Fraunces gravado** continuam com serifa. Sem creme, brilho, itálico e terracota, deixam de lembrar o Claude (quadro "Pior caso" da matriz).
- **FOUT** do par Assinatura no piloto (ver Fontes).

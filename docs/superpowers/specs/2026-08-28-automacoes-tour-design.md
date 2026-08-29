# Tour guiado de criação de automação (coach marks) — Design

**Data:** 2026-08-28
**Status:** aprovado (UI e copy aprovados via mockup: https://claude.ai/code/artifact/559f8ebc-8501-4e03-843b-acb9536f4c33)
**Apps:** CRM

## Objetivo

Uma visita guiada passiva em 8 passos que ensina a criar uma automação de
comentário para DM: começa destacando o botão "Nova automação" na página
`/automacoes`, abre o formulário programaticamente e apresenta campo a campo
com tooltips ancorados (coach marks). Complementa a checklist "Comece por
aqui" já lançada: a checklist diz O QUE fazer; o tour mostra ONDE e COMO.

## Decisões de produto (aprovadas em brainstorm)

1. **Escopo página + formulário.** Passo 1 na página; passos 2 a 8 dentro do
   `AutomationFormDialog`.
2. **Gatilho duplo.** Auto-início na primeira visita elegível (uma vez por
   workspace) + link "Ver passo a passo" na checklist para reabrir manualmente.
3. **Passivo.** Navegação por Próximo/Voltar/Pular com contador "N de 8" e
   dots de progresso. Único passo com ação: o passo 1, cujo CTA "Abrir
   formulário" abre o dialog e avança.
4. **Implementação própria (sem biblioteca).** react-joyride/driver.js
   renderizam overlay no `body` e brigam com portal, focus-trap e z-index do
   Radix Dialog (guerra de z-index já documentada em `DRAWER_ELEVATED_Z`).
   Overlay nosso, renderizado DENTRO do `DialogContent` quando o passo é
   interno, resolve por construção.

## Os 8 passos (copy aprovada, verbatim)

Superfície `page` = página; `dialog` = dentro do formulário.

| # | Superfície | Âncora (`data-tour`) | Título | Texto |
|---|---|---|---|---|
| 1 | page | `nova-automacao` | Comece por aqui | Toda automação nasce neste botão. Vamos abrir o formulário para você e mostrar cada campo. |
| 2 | dialog | `campo-nome` | Dê um nome interno | Esse nome aparece só para a equipe. Use algo que identifique a campanha, como "Lançamento ebook". |
| 3 | dialog | `campo-cliente` | Escolha o cliente | Só aparecem clientes com Instagram conectado. Se faltar alguém, conecte a conta na aba Redes sociais do cliente. |
| 4 | dialog | `campo-alvo` | Defina onde a automação escuta | Todos os posts responde comentários de qualquer publicação. Post específico deixa você escolher um post em produção ou já publicado. |
| 5 | dialog | `campo-palavras` | Adicione as palavras-chave | Quando um comentário contém uma delas, a automação dispara. Digite e pressione Enter. Ex.: "eu quero", "link". |
| 6 | dialog | `campo-dm` | Escreva a mensagem do DM | É o que a pessoa recebe no privado. A prévia ao lado mostra como fica no Instagram. |
| 7 | dialog | `campo-botoes` | Inclua botões de link | Opcional: até 3 botões levam a pessoa ao seu site, checkout ou material. Com botões, a mensagem pode ter até 640 caracteres. |
| 8 | dialog | `campo-resposta` | Responda no comentário e salve | A resposta pública é opcional e mostra que o perfil é ativo. Pronto: revise e toque em Salvar para ativar. |

Botões do card: passo 1 tem CTA único "Abrir formulário"; passos 2 a 7 têm
"Voltar" (ghost) + "Próximo" (primário); passo 8 tem "Voltar" + "Concluir".
"Concluir" só fecha o tour: NÃO submete o formulário. Todos os passos têm
"Pular tour" no cabeçalho do card. Sem travessão em nenhuma copy (regra da
casa); todas as strings em pt + en via i18n (`automations.json`, chaves
`tour.*`).

"Voltar" no passo 2 volta ao passo 1 e FECHA o dialog (via `onOpenChange(false)`,
suprimindo o encerramento do tour descrito em Comportamento) para que o passo 1
possa destacar o botão da página novamente.

## Comportamento

- **Auto-início.** Dispara uma única vez por workspace, quando TODAS valem:
  `automationsQuery.isSuccess && readyQuery.isSuccess`, `readyQuery.data ===
  true` (conta pronta para automação), `automations.length === 0`, `canCreate
  && !isAgent` (o botão-âncora do passo 1 só existe nesse caso), e a chave de
  persistência ausente. Ao auto-iniciar, grava a chave imediatamente: dispensar
  sem ler não faz o tour reaparecer sozinho.
- **Persistência.** `localStorage`, chave
  `automacoes_tour_seen:${profile?.conta_id ?? ''}` (mesmo padrão de
  `automacoes_checklist_dismissed`). Escrita best-effort (try/catch como em
  `guideStorage.ts`): quota estourada ou Safari private mode não derruba o app.
- **Reabrir manualmente.** Link "Ver passo a passo" no cabeçalho da checklist
  (ao lado de "Dispensar"), visível apenas quando `canCreate` é true (o tour
  precisa do botão-âncora e do formulário). Inicia o tour do passo 1 mesmo com
  a chave gravada. Quando a checklist não está visível (dispensada ou 3/3),
  não há ponto de reabertura: aceito por design, o tour é para quem está
  começando.
- **Passo 1 → 2.** O CTA chama `openCreate()` da página e avança o índice. O
  tour espera o dialog montar e ancorar (`data-tour="campo-nome"` presente no
  DOM) antes de posicionar o card do passo 2.
- **Encerramento.** "Pular tour", "Concluir", ou fechar o dialog no meio
  (qualquer caminho que dispare `onOpenChange(false)` durante um passo interno,
  exceto o "Voltar" do passo 2) encerram silenciosamente. Nada reaparece
  sozinho depois. Encerrar NUNCA fecha o dialog por conta própria: quem fechou
  foi o usuário ou o fluxo normal.
- **Interação livre.** O campo destacado continua editável durante o tour
  (spotlight não bloqueia pointer events). Quem quiser preencher junto,
  preenche; o tour não valida nem reage ao conteúdo.
- **Tour + checklist.** Podem coexistir na tela; o overlay escurece a
  checklist como o resto. Sem acoplamento de estado entre os dois.

## Arquitetura

Tudo em `apps/crm/src/pages/automacoes/tour/` (o tour é específico desta
página; nada vai para `components/` compartilhado até existir um segundo
consumidor — YAGNI).

### `tourSteps.ts` (dados)

```ts
export interface TourStep {
  id: string;                    // 'nova-automacao', 'campo-nome', ...
  surface: 'page' | 'dialog';
  anchor: string;                // valor do data-tour do elemento alvo
  titleKey: string;              // 'tour.step1Title', ...
  textKey: string;
  ctaKey?: string;               // só no passo 1 ('tour.step1Cta')
}
export const TOUR_STEPS: TourStep[]; // os 8, na ordem da tabela acima
```

### `useAutomationTour.ts` (estado, dono: a página)

```ts
export interface AutomationTourApi {
  activeIndex: number | null;    // null = tour inativo
  activeStep: TourStep | null;
  start: () => void;             // manual (checklist)
  next: () => void;              // no passo 1 NÃO abre o dialog (isso é da página)
  back: () => void;
  skip: () => void;              // encerra e persiste
  finish: () => void;            // idem (passo 8)
  handleDialogClose: () => void; // página chama quando formOpen vira false com tour ativo
}
export function useAutomationTour(opts: {
  contaId: string | null;
  eligibleForAutoStart: boolean; // a página computa a condição composta
}): AutomationTourApi;
```

O hook é dono de: índice ativo, auto-início (efeito que roda quando
`eligibleForAutoStart` vira true e a chave está ausente), persistência da
chave e limites de navegação. Ele NÃO conhece dialog nem DOM: a página conecta
`next()` do passo 1 a `openCreate()`, e o "Voltar" do passo 2 a
`setFormOpen(false)` + retrocesso, marcando a transição para que o
`handleDialogClose` resultante não encerre o tour.

### `TourOverlay.tsx` (apresentação)

Props: `{ step, index, total, onNext, onBack, onSkip, onCta }`. Responsável
por: localizar o elemento `[data-tour="${step.anchor}"]` no DOM, rolar até ele
(`scrollIntoView({ block: 'center' })`), medir com `getBoundingClientRect` e
renderizar:

- **Spotlight:** um `div` posicionado sobre o rect do alvo com
  `box-shadow: 0 0 0 9999px rgba(10, 12, 15, 0.6)` (mesmo valor nos dois
  temas; não existe token de overlay no design system) + anel
  (`0 0 0 4px var(--card-bg), 0 0 0 6px var(--primary-color)`),
  `border-radius` 10px, `pointer-events: none`. O escurecimento é sombra, não
  um elemento: nenhum clique é intercetado, o que implementa "interação livre"
  de graça. Reposiciona em `resize` e `scroll` (captura, para pegar o scroll
  interno do dialog).
- **Card:** contador "N de 8", "Pular tour", título, texto, dots, botões.
  Posicionado abaixo do alvo, flip para cima se estourar o viewport, clamp
  horizontal. Em viewport < 640px o card vira folha fixa no rodapé
  (`position: fixed; bottom: 0`) mantendo o spotlight.
- **Âncora ausente** (ex.: dialog ainda montando): renderiza nada e re-tenta
  via `requestAnimationFrame` por até ~1s; se o alvo nunca aparece, encerra o
  tour silenciosamente (fail-safe, nunca um card órfão no meio da tela).
- `role="dialog"` e `aria-label` com o título do passo; `Esc` NÃO é capturado
  pelo tour (dentro do Radix Dialog, Esc segue fechando o dialog, o que já
  encerra o tour pela regra de encerramento).

### Montagem

- **Passo de página:** `AutomacoesPage` renderiza `<TourOverlay>` direto
  (elemento `position: fixed`, `z-index: 8990` — acima do chrome da página,
  abaixo da faixa 9000+ dos drawers, que não estão abertos nesse momento).
- **Passo de dialog:** `AutomationFormDialog` ganha prop opcional
  `tour?: { step, index, total, onNext, onBack, onSkip }` e renderiza
  `<TourOverlay>` como último filho do `DialogContent`. Dentro do portal do
  dialog, o stacking é herdado e o focus-trap do Radix enxerga o card como
  conteúdo do próprio dialog: os botões do card são focáveis sem briga.
- **`data-tour` nos alvos:** `nova-automacao` no `<Button>` de criar da
  página; no dialog, nos `<div>` wrappers já existentes de cada campo (nome,
  cliente, alvo, palavras-chave, DM, botões, resposta pública). Atributos
  inertes: zero impacto quando o tour está inativo.
- **Checklist:** `AutomacoesChecklist` ganha prop `onStartTour?: () => void`;
  quando presente, renderiza o link "Ver passo a passo" no cabeçalho ao lado
  de "Dispensar". A página só passa a prop quando `canCreate && !isAgent`.

## i18n

Novas chaves em `packages/i18n/locales/{pt,en}/automations.json` sob `tour.`:
`counter` ("{{current}} de {{total}}" / "{{current}} of {{total}}"), `skip`,
`back`, `next`, `finish`, `step1Cta`, e `stepNTitle`/`stepNText` para N de 1 a
8 (copy pt da tabela acima; en traduzida com o mesmo tom). `checklist.seeTour`
("Ver passo a passo" / "See the walkthrough").

## Testes

jsdom não computa layout (`getBoundingClientRect` devolve zeros), então os
testes cobrem conteúdo e comportamento; posicionamento e spotlight são
verificados manualmente no browser (regra da casa para UI responsiva).

- `tourSteps.test.ts`: 8 passos; passo 1 é o único `page` e o único com
  `ctaKey`; âncoras únicas; ordem estável.
- `useAutomationTour.test.ts` (renderHook): auto-inicia quando elegível e sem
  chave; grava a chave ao auto-iniciar; NÃO auto-inicia com chave presente,
  nem quando `eligibleForAutoStart` é false; `start()` manual funciona mesmo
  com chave; `next`/`back` respeitam limites; `skip`/`finish` encerram e
  persistem; `handleDialogClose` encerra; localStorage lançando exceção não
  quebra (espelho do padrão best-effort).
- `TourOverlay.test.tsx` (com âncora fake no DOM): título/texto/contador do
  passo; passo 1 mostra só o CTA; passo intermediário mostra Voltar+Próximo;
  passo 8 mostra Concluir; "Pular tour" chama `onSkip`; âncora ausente
  renderiza nada.
- `AutomacoesPage.test.tsx` (integração, casos novos): visita elegível
  auto-inicia no passo 1; CTA do passo 1 abre o dialog e avança; fechar o
  dialog no meio encerra; link "Ver passo a passo" aparece na checklist quando
  `canCreate` e reinicia o tour; agente/flag off não veem tour nem link.

## Fora de escopo

- Tour em outras páginas (não generalizar antes do segundo consumidor).
- Passos interativos (avanço por ação do usuário) além do passo 1.
- Analytics de funil do tour.
- Ponto de reabertura fora da checklist.
- Hub e Admin.

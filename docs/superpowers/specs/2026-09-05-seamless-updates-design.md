# Atualizações silenciosas entre deploys

Data: 2026-09-05. Apps: CRM, Hub, Admin. Pacote: `packages/app-lifecycle`.

## 1. Objetivo

Hoje cada merge em `main` vira um deploy na Vercel (176 commits nos últimos 30 dias,
cerca de seis por dia útil). Uma aba aberta atravessa vários deploys por dia e, em cada
um, recebe o toast persistente "Nova versão disponível / Atualizar" do CRM e do Admin, ou
o pill equivalente do Hub. Quem clica perde o estado da tela. Quem ignora fica com o aviso
pendurado até que uma rota lazy dê 404 e o `installDeployRecovery` force o reload no meio
de uma navegação.

Meta: o usuário nunca vê aviso de versão. O app troca de versão sozinho, em momentos em
que a troca é invisível, e a aba antiga continua funcionando enquanto espera por um desses
momentos.

Fora de escopo:

- Skew Protection da Vercel. Exige plano Pro ou Enterprise e o projeto está no Hobby.
- Emular Skew Protection apontando os assets para a URL única de cada deploy. Depende de
  desligar a Deployment Protection das URLs de produção e de servir assets cross-origin.
- Service worker. A pré-busca em cache HTTP resolve o mesmo problema sem ciclo de vida.
- Pré-busca no Hub. Sessão de cliente é curta e no celular; deploy no meio dela é raro e
  o reload automático de hoje já cobre.
- Atualização forçada para deploys que quebram contrato com as edge functions. Revisitar
  se um caso real aparecer; hoje o combinado é manter as edge functions compatíveis com o
  frontend anterior.

## 2. Decisões

| Decisão | Motivo |
|---|---|
| Atualizar sozinho em momento seguro (opção A) em vez de nunca recarregar (opção C) | Sem Skew Protection a aba antiga perde os chunks no primeiro deploy; "nunca recarregar" viraria "quebrar em silêncio" |
| Manter a aba antiga viva pré-buscando os chunks para o cache HTTP | Assets são `immutable` por um ano; uma aba antiga encontra tudo localmente mesmo depois que a Vercel parou de servir aquele build. Custo: cerca de 1 MB gzip extra em idle por build novo no CRM, e só os chunks que mudaram nos builds seguintes |
| Pré-busca só para usuário autenticado | Landing e páginas de SEO não pagam nada |
| Três gatilhos de troca: navegação, aba oculta, inatividade | Cobrem, respectivamente, o uso ativo, a pausa e quem passa o dia numa tela só |
| Navegação completa tem cão de guarda e uma única tentativa por aba | Se a aba estiver offline naquele instante, `location.assign` cai na página de erro do navegador. O bloqueador não dispara com `navigator.onLine === false`; se a página continuar viva 8 s depois do `assign`, `window.stop()` aborta a navegação de documento pendente, `proceed()` deixa a navegação client-side seguir e o gatilho de navegação fica desligado até o próximo carregamento. `reset()` sozinho engoliria o clique; `proceed()` sem `stop()` daria duas transições. Os gatilhos passivos só recarregam depois de confirmar que o servidor responde |
| Só PUSH com mudança de `pathname` troca de versão | REPLACE é usado para limpar query (`useOpenParam` abre o diálogo e remove `?novo=1` no mesmo tick; 17 ocorrências de `replace: true`) e PUSH sem mudança de pathname é filtro, aba ou drawer por query (10 `setSearchParams`). Uma navegação completa nesses casos perderia o estado em memória que a URL não carrega. POP duplicaria a entrada de histórico |
| Trabalho não salvo é um registro explícito, e os gatilhos passivos ainda checam o DOM | Recarregar nunca pode disparar diálogo de `beforeunload`, então a decisão tem que ser tomada antes. O registro cobre o que conhecemos; a heurística de DOM (diálogo aberto, editável focado, textarea ou contenteditable com conteúdo) cobre o que o registro não conhece, para que um editor novo sem hook falhe fechado nos três gatilhos |
| Polling continua em 5 minutos | Com a pré-busca, detectar o deploy mais cedo deixou de ser urgente |
| Recarregamento silencioso não depende de `sessionStorage` | O gatilho é um mismatch verificado de fingerprint, não um erro; não há risco de loop. Quando o storage existe, o carimbo de cooldown do deploy-recovery é gravado mesmo assim |

## 3. Arquitetura

```
packages/app-lifecycle/
  index.ts
  src/deploy-recovery.ts   inalterado: reload em chunk 404, última rede de segurança
  src/new-version.ts       detector; ganha checagem sob demanda
  src/unsaved-work.ts      novo: registro de trabalho não salvo
  src/use-unsaved-work.ts  novo: hook React sobre o registro
  src/silent-update.ts     novo: gatilhos e troca de versão
  src/prefetch-build.ts    novo: pré-busca dos chunks do build
```

O pacote continua sem dependências. `use-unsaved-work.ts` importa `react`, que os três
apps já resolvem pelo alias. `silent-update.ts` tipa o router estruturalmente, sem importar
o React Router.

Saem: `apps/crm/src/lib/new-version-toast.ts`, `apps/admin/src/lib/new-version-toast.ts`,
`apps/hub/src/components/NewVersionBanner.tsx` e seu teste, e as chaves `hub.newVersion` e
`hub.refresh` em `packages/i18n/locales/{pt,en}/common.json`, que só o banner usa.

### 3.1 `new-version.ts`

`watchForNewVersion` passa a devolver `{ stop, check }` em vez de só a função de parada.
`check()` executa a checagem ignorando a trava de aba oculta, porque quem chama está
pedindo de propósito, e resolve `true` quando o servidor respondeu com um documento
comparável (baseline definida ou fingerprint comparado) e `false` em erro, resposta sem
assets ou watcher já parado. O intervalo e o `visibilitychange` continuam respeitando a trava. O
resto não muda: primeira checagem vira baseline, fingerprint é a lista ordenada das
referências a `/assets/` do HTML, resposta sem referências é ignorada.

### 3.2 `unsaved-work.ts` e `use-unsaved-work.ts`

```ts
export function holdUnsavedWork(): () => void; // devolve release, idempotente
export function hasUnsavedWork(): boolean;    // registro explícito
export function trackUnsavedWork<T>(work: Promise<T>, maxMs?: number): Promise<T>; // segura até assentar, teto 30 min
export function isDocumentBusy(doc?: Document): boolean; // heurística de DOM
export function useUnsavedWork(active: boolean): void; // segura enquanto montado e active
```

`hasUnsavedWork` é um contador. `trackUnsavedWork` solta sozinho depois de 30 minutos: um
XHR sem timeout numa conexão travada nunca assenta, e não pode desligar os gatilhos passivos
pelo resto da vida da aba; nenhum upload legítimo passa disso. `isDocumentBusy` é a rede
para o que ninguém registrou e retorna `true` quando qualquer um vale:

- existe `[role="dialog"]` ou `[role="alertdialog"]` no documento (Dialog, Sheet e
  AlertDialog do Radix; cobre qualquer formulário modal);
- `document.activeElement` é `textarea`, `input` de texto (`text`, `search`, `email`,
  `url`, `tel`, `number`, `password`) ou `isContentEditable`;
- existe `textarea` com `value` não vazio, ou `[contenteditable="true"]` com
  `textContent` não vazio (editores TipTap).

A heurística é deliberadamente conservadora: um drawer aberto o dia inteiro adia a troca
até ser fechado. Um editor novo sem `useUnsavedWork` falha fechado nos três gatilhos.

Pontos de registro, todos via `useUnsavedWork`:

- `DialogContent` (`apps/crm/src/components/ui/dialog.tsx`) segura sozinho enquanto
  `confirmClose === true`. Cobre todo modal que já declara estado sujo: wizard de novo
  fluxo, modais de workflow, páginas do Hub no detalhe do cliente, checkout Pagar.me.
- `useLayoutAutosave` (editor de relatório) segura na mesma condição que o guard de
  `beforeunload` já usa: layout pendente, título sujo ou save em voo.
- Editores fora de modal, com a condição exata de cada um:
  - `WorkflowDrawer` (editor de post nos fluxos): `savingIds.size > 0`.
  - `StandalonePostDrawer` (post avulso): `isSaving`.
  - `ContratosPage`: `saving`.
  - Hub `QuestionItem` em `BriefingPage`: `answer !== (question.answer ?? '') ||
    status === 'saving' || locked` (`locked` cobre upload e transcrição de áudio).
  - Hub `IdeiaModal` em `IdeiasPage`: sem registro. O portal renderiza `role="dialog"` com
    `aria-modal="true"`, e a heurística o vê.
  - Comentários de aprovação no Hub: sem registro. São `textarea`, e a heurística cobre
    tanto o foco quanto o conteúdo digitado.
- Uploads em voo, via `trackUnsavedWork` na função exportada de cada serviço, para que um
  recarregamento passivo nunca aborte um envio: CRM `uploadPostMedia`, `uploadFile`,
  `uploadIdeiaImage`, `uploadInlineImage`, `uploadAutomationMedia` e o `storage.upload` do
  `ClienteAvatarUpload`; Hub `uploadBriefingAudio` e `uploadIdeiaImage`; Admin
  `uploadInlineImage`.

### 3.3 `silent-update.ts`

```ts
interface SilentUpdateRouter {
  getBlocker(key: string, fn: (args: {
    historyAction: 'PUSH' | 'REPLACE' | 'POP';
    nextLocation: { pathname: string; search: string; hash: string };
  }) => boolean): unknown;
  subscribe(fn: (state: {
    blockers: Map<string, { state: string; location?: { pathname: string; search: string; hash: string } }>;
  }) => void): () => void;
}

export function installSilentUpdate(options: {
  router: SilentUpdateRouter;
  hiddenAfterMs?: number;  // padrão 5 min
  idleAfterMs?: number;    // padrão 10 min
  documentUrl?: string;
  intervalMs?: number;
  /** Mutações em voo do app: cada main.tsx passa `() => queryClient.isMutating() > 0`. */
  holdWhile?: () => boolean;
}): () => void; // desinstala
```

Estados: `idle` → `pending` (o watcher viu build novo) → reload. Todo gatilho, inclusive o
de navegação, exige `pending`, `hasUnsavedWork() === false`, `isDocumentBusy() === false` e
`holdWhile() === false`. A navegação entra na mesma regra porque uma navegação completa
aborta requisições em voo (um PATCH do kanban, por exemplo), coisa que a troca de rota
client-side nunca faz; `holdWhile` é como o app expõe isso, via `queryClient.isMutating()`.
Os gatilhos passivos exigem ainda uma resposta 2xx do servidor, porque ninguém está lá para
ver uma página de erro de rede.

| Gatilho | Condição | Ação |
|---|---|---|
| Navegação | Bloqueador `silent-update` registrado com `router.getBlocker`; retorna `true` só para PUSH em que `nextLocation.pathname !== currentLocation.pathname`, quando pendente, sem registro, sem documento ocupado, sem `holdWhile`, com `navigator.onLine !== false` e sem tentativa anterior nesta aba | Ao ver o bloqueador em `blocked` via `router.subscribe`, arma o cão de guarda de 8 s e chama `window.location.assign(pathname + search + hash)` do destino. Se o cão de guarda disparar, a página não foi substituída: `window.stop()` aborta a navegação de documento pendente (o botão Parar do navegador, para que uma resposta lenta não chegue depois como segunda transição), `proceed()` deixa a navegação client-side que o usuário pediu seguir, e o gatilho de navegação fica desligado até o próximo carregamento. Se `holdWhile()` estiver ativo nesse instante, espera mais um período antes de parar as cargas. Ao desistir, apaga o carimbo de cooldown gravado antes do `assign`: ele existe para que um chunk 404 na página velha não cancele a navegação em voo com um reload do deploy-recovery, e não pode sobreviver a uma troca que não aconteceu |
| Aba oculta | `visibilitychange` para `hidden` arma um timer de `hiddenAfterMs`; `visible` desarma e reinicia a contagem de inatividade (uma aba que volta de horas oculta não pode recarregar no primeiro tick enquanto o usuário olha) | Ao disparar, chama `check()` do watcher (o polling estava pausado). Recarrega se ficou pendente, `isDocumentBusy()` é falso e o servidor respondeu: ou o próprio `check()` resolveu `true`, ou um GET do documento com `no-store` respondeu 2xx |
| Inatividade | `pointerdown`, `keydown`, `wheel`, `scroll` e `touchstart`, passivos e em captura, atualizam `lastInputAt`. Tick a cada 30 s | Se visível, `now - lastInputAt >= idleAfterMs` e `isDocumentBusy()` é falso, faz um GET do documento com `no-store` e recarrega se respondeu 2xx |

Recarregar é `window.location.reload()`, precedido do carimbo de cooldown do
deploy-recovery quando `sessionStorage` existe. Depois do reload, o documento novo vira a
baseline e nada fica pendente.

Caminho de falha da navegação completa: `location.assign` pode não substituir a página
(aba offline naquele instante, proxy, DNS no meio do cutover do próprio deploy). Três
proteções, em ordem: o bloqueador nem dispara com `navigator.onLine === false`; a tentativa
é única por aba, então um clique nunca repete um `assign` condenado; e o cão de guarda de 8 s
chama `window.stop()` e depois `proceed()`. O `stop()` é o que evita a transição dupla: sem
ele, uma navegação de documento lenta poderia chegar depois e substituir a página que o
router acabou de renderizar. O `proceed()` é o que honra o clique: `reset()` deixaria o
usuário exatamente onde estava, sem erro e sem tela nova, como se o clique não tivesse
existido. Como `window.stop()` aborta todas as cargas da página, o cão de guarda espera mais
um período enquanto `holdWhile()` acusar mutação em voo. Se o navegador já tiver trocado para a sua
página de erro de rede, nada roda mais, e o usuário volta com o botão voltar ou recarrega:
o mesmo que acontece hoje com qualquer link em uma aba offline. Os gatilhos passivos, por
recarregarem sem ação do usuário, exigem uma resposta 2xx do servidor imediatamente antes.

### 3.4 `prefetch-build.ts`

```ts
export function prefetchBuildAssets(options: {
  manifestUrl: string;     // '/build-manifest.json' no CRM, '/admin/build-manifest.json' no Admin
  concurrency?: number;    // padrão 3
}): () => void;            // cancela (AbortController)
```

CRM e Admin passam a gerar o manifest do Vite com `build.manifest: 'build-manifest.json'`
(caminho relativo ao `outDir`, fora de `/assets/` de propósito para não herdar o
`immutable`). Passos, todos em `requestIdleCallback` com fallback de 2 s:

1. Pula se `navigator.connection.saveData` for `true` ou `effectiveType` for 2g ou 3g.
2. Busca o manifest com `cache: 'no-store'`.
3. Todo `file` e `css[]` do manifest é relativo ao `outDir`, sem o `base` do Vite
   (`assets/index-XXXX.js`, nunca `/admin/assets/...`). Cada um vira URL absoluta com
   `new URL(file, new URL(manifestUrl, location.origin))`, que devolve `/assets/...` no CRM
   e `/admin/assets/...` no Admin. Confere que a URL da entrada `isEntry` é o `src` do
   `<script type="module">` do documento, comparando `pathname`. Se não bater, um deploy
   aconteceu entre o HTML e o manifest: aborta.
4. Coleta as URLs de todas as entradas, ignora as que o documento já referencia em
   `script[src]` ou `link[href]` e busca o resto com três em paralelo e `priority: 'low'`.
5. Erro em um arquivo é ignorado e a fila continua. Erro no manifest encerra em silêncio.

Ponto de chamada: CRM no `App.tsx`, uma vez por carregamento, quando `user` do
`AuthContext` deixa de ser nulo. Admin no layout autenticado, quando o usuário está
confirmado como admin. Hub não chama.

### 3.5 Ligação nos apps

- CRM `main.tsx`: `installDeployRecovery()` continua primeiro; `installSilentUpdate({ router,
  holdWhile: () => queryClient.isMutating() > 0 })` logo depois de `createBrowserRouter`. O
  `queryClient` passa a ser exportado de `App.tsx`. Sai o import do toast.
- Admin `main.tsx`: idem, com o `router` exportado de `router.tsx` e o `queryClient` local.
- Hub `main.tsx`: idem. Sai o `NewVersionBanner`.

Os botões de recarregar das telas de erro ficam como estão.

### 3.6 Ordem de entrada

Os gatilhos só podem ser ligados depois que todo registro de trabalho não salvo da seção 3.2
estiver no lugar: `DialogContent`, os editores listados e os uploads. Tudo entra em um único
PR, e o plano de implementação ordena as tarefas nessa sequência: registro e hook, depois os
pontos de registro, depois uploads, e só então `installSilentUpdate` e a ligação nos
`main.tsx`. Um PR que ligue os gatilhos sem o registro completo não está pronto para merge.

## 4. Vercel

Nada muda em `vercel.json`. `build-manifest.json` fica fora de `/assets/`, então recebe o
cache padrão de estático e é buscado com `no-store` de qualquer forma. O rewrite
`/admin/(.*)` não o intercepta porque a Vercel serve arquivo existente antes de aplicar
rewrites, o mesmo motivo pelo qual `/admin/assets/*` funciona hoje. A lista de chunks é
informação pública; os próprios chunks já expõem seus imports.

## 5. Primeiro deploy depois do merge

Abas que estiverem rodando o código antigo vão mostrar o toast uma última vez, porque o
código que decide isso é o delas. A partir do reload seguinte não há mais aviso. Não há
migration nem edge function envolvida.

## 6. Testes

Vitest em `packages/app-lifecycle/__tests__`, com timers falsos e `fetch` mockado:

- `unsaved-work`: hold e release, release idempotente, contagem com múltiplos holds;
  `trackUnsavedWork` segura até resolver, até rejeitar, e solta no teto se nunca assentar; hook segura e libera
  conforme `active` e desmontagem; `isDocumentBusy` com diálogo aberto, textarea focada,
  textarea com conteúdo, contenteditable com conteúdo, e documento limpo.
- `new-version`: os testes atuais adaptados ao retorno `{ stop, check }`; `check()` ignora a
  trava de aba oculta, o intervalo não; `check()` resolve `true` com resposta comparável e
  `false` em erro ou depois de parado.
- `silent-update`: nada acontece antes de pendente; PUSH com pathname novo vira `assign`
  no destino certo com search e hash; PUSH sem mudar pathname, REPLACE e POP passam;
  offline não troca; cão de guarda chama `window.stop()` e `proceed()`, espera enquanto
  `holdWhile` acusar mutação, e a navegação seguinte passa sem troca; registro de trabalho não salvo, documento ocupado e `holdWhile` bloqueiam os três
  gatilhos; aba oculta arma e desarma o timer
  e chama `check()` antes de recarregar; inatividade só conta com a aba visível, input
  reinicia a contagem e servidor sem resposta impede o reload; desinstalar remove
  listeners, timers e bloqueador.
- `prefetch-build`: pula em `saveData` e em conexão lenta; resolve URLs relativas ao
  manifest com `base` `/` e `/admin/`; aborta em mismatch de entry; ignora arquivos já
  referenciados; respeita a concorrência; erro em um arquivo não interrompe; cancelar
  aborta.
- `dialog.tsx`: teste existente ganha o caso "segura trabalho não salvo enquanto
  `confirmClose`".

Saem os testes do `NewVersionBanner`. Verificação manual no browser antes do merge: com o
app aberto contra o dev server, servir um HTML com hash diferente e confirmar que a
navegação seguinte vira navegação completa sem toast, e que a aba oculta recarrega.

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
| POP (botão voltar) não troca de versão | Navegação completa no POP duplicaria a entrada de histórico |
| Trabalho não salvo é um registro explícito; sem registro a tela é limpa | Recarregar nunca pode disparar diálogo de `beforeunload`, então a decisão tem que ser tomada antes, com dado confiável |
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
pedindo de propósito. O intervalo e o `visibilitychange` continuam respeitando a trava. O
resto não muda: primeira checagem vira baseline, fingerprint é a lista ordenada das
referências a `/assets/` do HTML, resposta sem referências é ignorada.

### 3.2 `unsaved-work.ts` e `use-unsaved-work.ts`

```ts
export function holdUnsavedWork(): () => void; // devolve release, idempotente
export function hasUnsavedWork(): boolean;
export function useUnsavedWork(active: boolean): void; // segura enquanto montado e active
```

Contador simples. Sem nenhum hold, a tela é considerada limpa.

Pontos de registro, todos via `useUnsavedWork`:

- `DialogContent` (`apps/crm/src/components/ui/dialog.tsx`) segura sozinho enquanto
  `confirmClose === true`. Cobre todo modal que já declara estado sujo: wizard de novo
  fluxo, modais de workflow, páginas do Hub no detalhe do cliente, checkout Pagar.me.
- `useLayoutAutosave` (editor de relatório) segura na mesma condição que o guard de
  `beforeunload` já usa: layout pendente, título sujo ou save em voo.
- O plano de implementação audita e registra, um a um, os editores fora de modal: drawer de
  post avulso e editor de post em abas no CRM, editor de contratos, briefing do Hub (texto e
  gravação de áudio em andamento), formulário de ideias e comentários de aprovação no Hub.
  Regra: segurar enquanto houver conteúdo digitado não persistido ou save em voo.

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
}): () => void; // desinstala
```

Estados: `idle` → `pending` (o watcher viu build novo) → reload. Todo gatilho exige
`pending` e `hasUnsavedWork() === false`.

| Gatilho | Condição | Ação |
|---|---|---|
| Navegação | Bloqueador `silent-update` registrado com `router.getBlocker`; retorna `true` para PUSH e REPLACE quando pendente e limpo | Ao ver o bloqueador em `blocked` via `router.subscribe`, navegação completa para o mesmo destino: `location.assign` no PUSH, `location.replace` no REPLACE |
| Aba oculta | `visibilitychange` para `hidden` arma um timer de `hiddenAfterMs`; `visible` desarma | Ao disparar, chama `check()` do watcher (o polling estava pausado) e recarrega se ficou pendente |
| Inatividade | `pointerdown`, `keydown`, `wheel`, `scroll` e `touchstart` passivos atualizam `lastInputAt`, no máximo uma vez por segundo. Tick a cada 30 s | Se visível e `now - lastInputAt >= idleAfterMs`, recarrega |

Recarregar é `window.location.reload()`, precedido do carimbo de cooldown do
deploy-recovery quando `sessionStorage` existe. Depois do reload, o documento novo vira a
baseline e nada fica pendente.

Se o bloqueador barrar uma navegação e a navegação completa não acontecer por qualquer
motivo, não há retorno ao estado anterior: a página está descarregando. Não existe caminho
em que o usuário fique preso, porque o bloqueador só retorna `true` quando a troca vai
acontecer.

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
3. Confere que o `file` da entrada `isEntry` é o `src` do `<script type="module">` do
   documento. Se não bater, um deploy aconteceu entre o HTML e o manifest: aborta.
4. Coleta os `file` e `css[]` de todas as entradas, ignora os que o documento já referencia
   e busca o resto com três em paralelo e `priority: 'low'`.
5. Erro em um arquivo é ignorado e a fila continua. Erro no manifest encerra em silêncio.

Ponto de chamada: CRM no `App.tsx`, uma vez por carregamento, quando `user` do
`AuthContext` deixa de ser nulo. Admin no layout autenticado, quando o usuário está
confirmado como admin. Hub não chama.

### 3.5 Ligação nos apps

- CRM `main.tsx`: `installDeployRecovery()` continua primeiro; `installSilentUpdate({ router })`
  logo depois de `createBrowserRouter`. Sai o import do toast.
- Admin `main.tsx`: idem, com o `router` exportado de `router.tsx`.
- Hub `main.tsx`: `installSilentUpdate({ router })`. Sai o `NewVersionBanner`.

Os botões de recarregar das telas de erro ficam como estão.

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

- `unsaved-work`: hold e release, release idempotente, contagem com múltiplos holds, hook
  segura e libera conforme `active` e desmontagem.
- `new-version`: os testes atuais adaptados ao retorno `{ stop, check }`; `check()` ignora a
  trava de aba oculta, o intervalo não.
- `silent-update`: nada acontece antes de pendente; navegação PUSH e REPLACE viram
  `assign`/`replace` no destino certo; POP passa; trabalho não salvo bloqueia os três
  gatilhos; aba oculta arma e desarma o timer e chama `check()` antes de recarregar;
  inatividade só conta com a aba visível e input reinicia a contagem; desinstalar remove
  listeners e bloqueador.
- `prefetch-build`: pula em `saveData` e em conexão lenta; aborta em mismatch de entry;
  ignora arquivos já referenciados; respeita a concorrência; erro em um arquivo não
  interrompe; cancelar aborta.
- `dialog.tsx`: teste existente ganha o caso "segura trabalho não salvo enquanto
  `confirmClose`".

Saem os testes do `NewVersionBanner`. Verificação manual no browser antes do merge: com o
app aberto contra o dev server, servir um HTML com hash diferente e confirmar que a
navegação seguinte vira navegação completa sem toast, e que a aba oculta recarrega.

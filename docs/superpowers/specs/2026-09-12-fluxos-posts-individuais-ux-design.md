# Ajustes de UX: posts individuais no quadro de Fluxos

## Contexto

A feature "processos individuais" (PRs #483-#488, em `main`) deixou o quadro de Fluxos com
quatro problemas de uso: a seção Produção do drawer ocupa a tela inteira sempre aberta; o
prazo de cada etapa só edita uma data absoluta, embora `post_process_steps` já tenha
`prazo_dias`/`tipo_prazo`; a coluna do quadro só cria fluxo, nunca post individual; e os
cards (`PostProcessCard`, `WorkflowCard`) são altos demais para a densidade que o quadro
precisa. Mockup aprovado: https://claude.ai/code/artifact/f87e284b-2b05-4817-9e8c-3f77a2e2c890.

## 1. Produção recolhida

`PostProductionSection.tsx` some do estado sempre-aberto. Fechada por padrão
(`sessionStorage` por `postId`), cabeçalho vira botão com resumo de uma linha (etapa atual,
posição, prazo curto, responsável); corpo atual (origem, timeline, histórico) só renderiza
aberto.

## 2. Prazo por dias úteis/corridos

Só se aplica a processos `modo_prazo = 'padrao'` (em `data_fixa`/`data_entrega` cada etapa
já nasce com data fixa materializada; edição continua só por data nesses casos).

Editar etapa passa a usar `prazo_dias` + `tipo_prazo` (úteis|corridos) como controle
primário. `etapaDeadlineDateOf` dá precedência a `prazo_efetivo` sobre tudo, então o
cliente **sempre recalcula `prazo_efetivo` a partir dos novos `prazo_dias`/`tipo_prazo`**
(via `computeDeadlineDate`, âncora `iniciado_em`) e envia os três juntos — nunca só
`prazo_dias`/`tipo_prazo` sozinhos, ou a data exibida ficaria presa ao valor antigo.
Clicar na data calculada alterna para "data fixa" (comportamento atual: `prazo_efetivo`
livre, `prazo_dias`/`tipo_prazo` enviados como `null`).

`update_post_process_step` (assinatura de 5 parâmetros em
`20260919000006_update_step_and_remove_process.sql`) precisa de uma nova migration que
**substitua** a função, não crie um overload: `CREATE OR REPLACE` com uma lista de
parâmetros de entrada diferente (7 em vez de 5) cria uma segunda função no Postgres, não
troca a existente — a migration precisa `DROP FUNCTION public.update_post_process_step(
bigint, integer, integer, bigint, timestamptz)` antes do `CREATE OR REPLACE` de 7
parâmetros, e repetir `REVOKE`/`GRANT` na assinatura nova. Arquivo datado depois de
`20260919000006` (checar o último prefixo em `supabase/migrations/` antes de nomear).

Etapas futuras não são reancoradas — mesma regra de hoje (`transition_post_process` ancora
a próxima etapa em `now` ao ativar).

## 3. "+ Novo ▾" na coluna

Botão "+ Novo fluxo" vira dropdown: "Fluxo" (comportamento atual) e "Post individual"
(atrás do flag `feature_post_processes`, só quando a linha tem template). "Post individual"
abre `NewAvulsoDialog` com o template pré-vinculado.

Criar o post e aplicar o processo continuam sendo duas chamadas separadas (o RPC
`apply_post_process` já faz sua própria validação/transação) — não há RPC atômica de
criar+aplicar neste escopo. Se `applyPostProcess` falhar depois do post criado (flag
mudou, template foi alterado/removido), mostrar um toast de erro e abrir o drawer do post
avulso normalmente: ele fica no estado "sem processo", que já existe hoje e já tem
recuperação manual via "Aplicar processo" (`ApplyProcessDialog`) — não é um estado
inválido, só não teve o atalho automático.

Templates com `modo_prazo` diferente de `padrao` pulam a aplicação automática: o post é
criado e o fluxo abre `ApplyProcessDialog` **pré-preenchido** com esse template (nova prop
nele para aceitar um `initialTemplateId`/`initialTemplate` e pular a etapa de escolha do
modelo, no mesmo espírito de `NewWorkflowWizard.initialTemplateId`) em vez de abrir com o
seletor de modelo zerado.

## 4. Cards compactos

`PostProcessCard`: thumb 26px (capa ou ícone do tipo) + cliente + badge "Individual"
ícone-only; pill de prazo combinando "23h corridos"; chip de tipo+status; rodapé com
responsável sem borda, grip, kebab (abrir, voltar etapa, **encerrar processo**, excluir
post) e botão de avançar; barra de progresso 4px sem rótulo (tooltip mostra "Copy 1/7").
Sem item "editar processo" no kebab: não existe essa capacidade (a única RPC de edição
mexe em responsável/prazo de uma etapa por vez) e `remove_post_process` encerra o processo,
não apaga — o rótulo do kebab é "Encerrar processo" para não prometer exclusão; editar
etapa a etapa continua só dentro do drawer, alcançado por "Abrir".

`WorkflowCard`: mesma silhueta — contagem de posts vira chip clicável no topo; prazo
combinado; responsável inline sem borda; barra 4px; rodapé com grip, kebab (editar, abrir
posts, voltar etapa, excluir) e botão de avançar fora do kebab. Histórico continua como
popover próprio no card, fora do kebab (não mudou).

## Fora de escopo

Sem migração de schema além da extensão de assinatura do item 2. Sem novo primitive Radix
Collapsible — `useState` simples.

`NewAvulsoDialog` ganhou mais do que o prop `templateId`: `templates` (para resolver o
template pré-vinculado), `onProcessApplied` (auto-apply bem-sucedido revela no quadro em
vez de abrir o drawer de avulso) e `onNeedsManualApply` (template com `modo_prazo !=
'padrao'` — o post já nasce criado e o chamador abre `ApplyProcessDialog` pré-preenchido).

## Verificação

`npm run lint`, `format:check`, os 4 `tsc`, `npm run test`, `npm run test:functions`;
migration aplicada em staging antes do merge; checagem visual no browser (staging) dos dois
cards e da seção Produção em claro/escuro.

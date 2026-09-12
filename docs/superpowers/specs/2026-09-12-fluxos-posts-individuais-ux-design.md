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

Editar etapa passa a usar `prazo_dias` + `tipo_prazo` (úteis|corridos) como controle
primário, com a data calculada exibida ao lado, somente leitura. Clicar na data alterna
para "data fixa" (comportamento atual). RPC `update_post_process_step` ganha
`p_prazo_dias`/`p_tipo_prazo` opcionais (assinatura compatível, `CREATE OR REPLACE`).
Etapas futuras não são reancoradas — mesma regra de hoje (`transition_post_process` ancora
a próxima etapa em `now` ao ativar).

## 3. "+ Novo ▾" na coluna

Botão "+ Novo fluxo" vira dropdown: "Fluxo" (comportamento atual) e "Post individual"
(atrás do flag `feature_post_processes`, só quando a linha tem template). "Post individual"
abre `NewAvulsoDialog` com o template pré-vinculado; ao criar, aplica o processo do template
automaticamente (mesma lógica de `ApplyProcessDialog`) e abre o drawer do post. Templates
com `modo_prazo` diferente de `padrao` caem no fluxo manual (`ApplyProcessDialog`) por
exigirem input extra.

## 4. Cards compactos

`PostProcessCard`: thumb 26px (capa ou ícone do tipo) + cliente + badge "Individual"
ícone-only; pill de prazo combinando "23h corridos"; chip de tipo+status; rodapé com
responsável sem borda, grip, kebab (abrir, voltar etapa, editar processo, remover processo,
excluir) e botão de avançar; barra de progresso 4px sem rótulo (tooltip mostra "Copy 1/7").

`WorkflowCard`: mesma silhueta — contagem de posts vira chip clicável no topo; prazo
combinado; responsável inline sem borda; barra 4px; rodapé com grip, kebab (editar, abrir
posts, voltar etapa, histórico, excluir) e botão de avançar fora do kebab.

## Fora de escopo

Sem migração de schema além da extensão de assinatura do item 2. Sem mudança em
`NewAvulsoDialog` fora do novo prop `templateId`. Sem novo primitive Radix Collapsible —
`useState` simples.

## Verificação

`npm run lint`, `format:check`, os 4 `tsc`, `npm run test`, `npm run test:functions`;
migration aplicada em staging antes do merge; checagem visual no browser (staging) dos dois
cards e da seção Produção em claro/escuro.

# Gestão de modelos de relatório (templates) — design

Data: 2026-09-25 · Branch: `claude/relatorios-interativos-default`

## Contexto

O relatório interativo (report_documents + editor de blocos) virou o relatório
padrão da página de analytics da conta. Os modelos (`report_templates`) só
nascem hoje dentro do editor de um relatório já gerado ("Salvar como
template") e só podem ser aplicados a um relatório existente. Não existe lugar
para listar, ver ou editar um modelo antes de gerar um relatório.

Objetivo: dar ao usuário um caminho claro para ver e editar os modelos antes de
gerar, reaproveitando o editor existente.

Fora de escopo: automação mensal (o cron do formato anterior segue como está),
migrations e edge functions.

Permissões: hoje as policies de `report_templates` e a RPC
`set_default_report_template` só verificam o workspace, então qualquer membro
já cria modelos ("Salvar como template") e pode ler, editar e apagar via
PostgREST. Esta feature NÃO restringe isso: esconder controles por
`configuracoes:editar` sem mudar policy/RPC seria um gate de fachada, e
restringir no banco tiraria de membros algo que eles fazem hoje. Quem vê a lista
de modelos pode gerenciá-los. Restringir no banco fica como decisão de produto
separada.

## 1. Lista de modelos em Configuração › Relatórios

Novo card "Modelos de relatório" em `apps/crm/src/pages/configuracao/tabs/RelatoriosTab.tsx`
(rota `/configuracao/relatorios`), num componente próprio
`ReportTemplatesCard.tsx` na mesma pasta.

- Primeira linha: "Padrão do sistema", embutido, com ícone de cadeado e ação
  única **Duplicar** (cria um modelo com o layout padrão do sistema e abre o
  editor).
- Demais linhas: modelos do workspace (`listReportTemplates`, query key
  `['report-templates']`, a mesma do dialog). Cada linha mostra nome, badge
  "padrão" quando `is_default`, e a contagem de blocos. Ações: botão
  **Editar** (navega para `/relatorios/modelos/:id`) e menu "…" com
  **Definir como padrão** (`setDefaultReportTemplate`), **Renomear** (dialog
  com input), **Duplicar** e **Excluir** (AlertDialog de confirmação).
- Botão **Novo modelo** no cabeçalho do card: cria um modelo "Novo modelo" com
  o layout padrão do sistema e navega para o editor.
- Permissão: a aba já exige `configuracoes:ver`. Dentro dela, todas as ações
  de modelo ficam disponíveis (ver "Permissões" acima), sem gate por
  `configuracoes:editar`.
- Estado vazio (só o padrão do sistema): linha de ajuda "Crie um modelo para
  reaproveitar a mesma estrutura em todos os relatórios."
- Toda mutação invalida `['report-templates']` e também a query de detalhe do
  modelo afetado: renomear invalida `['report-template', id]`, excluir faz
  `removeQueries(['report-template', id])` (o editor usa `staleTime: Infinity`,
  então um cache antigo mostraria nome/layout velhos ou um modelo já apagado).
  Toast sonner em sucesso/erro (mensagem genérica, sem detalhe cru).

## 2. Editor de modelo em `/relatorios/modelos/:id`

Nova página `apps/crm/src/pages/relatorio-editor/ModeloEditorPage.tsx`,
registrada em `App.tsx` antes de `/relatorios/:id` (rota estática vence a
dinâmica no React Router; `vercel.json` já cobre `/relatorios(/.*)?`; o gate de
plano `feature_analytics_reports` do `ProtectedRoute` para `/relatorios` já se
aplica, o mesmo do editor de relatório).

- Carrega o modelo com `getReportTemplate(id)` (query key
  `['report-template', id]`, `staleTime: Infinity`, sem refetch em foco, mesmo
  racional do editor de relatório). Não encontrado: mensagem "Modelo não
  encontrado." com link de volta.
- Snapshot de exemplo: `makeSnapshotFixture()` com `branding` sobrescrito pelo
  workspace real (nome, logo, cor, splash), como `ReportPreview.tsx` já faz.
- Reusa `EditorCanvas`, `LayersPanel`, `AddWidgetDrawer`, `AppearancePopover`,
  `TextBlockEditor` e as operações de `layoutOps`.
- Cabeçalho: link "← Modelos" para `/configuracao/relatorios`, input do nome
  (edita `name`), indicador "Salvando…", Aparência e Adicionar widget. Sem
  Exportar PDF, Atualizar dados, Ver como cliente, Salvar/Aplicar template.
- Faixa informativa: "Dados de exemplo. Os números reais entram quando o
  relatório é gerado."
- Blocos `ai_*`: o texto nunca é guardado em modelo (`stripAiTextForTemplate`).
  No editor de modelo eles aparecem como placeholder não editável "Gerado pela
  IA em cada relatório". Implementação: `renderTextBlock` do canvas devolve o
  placeholder para tipos `ai_*` e o `TextBlockEditor` para `text`.
- Toda gravação de layout passa por `stripAiTextForTemplate` antes de salvar.
- Não há modo leitura (ver "Permissões"): quem abre o editor pode editar.

## 3. Autosave compartilhado

`useLayoutAutosave` hoje chama `updateReportDoc` e escreve no cache
`['report-doc', id]`. Refatoração: o hook recebe um adaptador

```ts
interface AutosaveTarget {
  save(id: string, patch: { layout?: ReportLayout; title?: string }): Promise<void>;
  cacheKey(id: string): QueryKey;
  errorMessage: string; // "Erro ao salvar o relatório" / "Erro ao salvar o modelo"
}
```

O editor de relatório passa o adaptador de `report_documents` (comportamento
idêntico ao atual, adaptador default para não tocar nos chamadores); o editor
de modelo passa um que mapeia `title → name` e chama `updateReportTemplate`. A
cadeia de saves por id, retries, backoff e `useUnsavedWork` ficam como estão.
Os testes atuais do hook e do editor continuam verdes sem alteração de
expectativa.

## 4. Serviço `reportTemplates.ts`

Novas funções (PostgREST direto com RLS; a tabela já concede `UPDATE (name,
layout)` a `authenticated` e o trigger `validate_report_layout` valida o
layout):

- `getReportTemplate(id)` → `ReportTemplateRow | null`
- `updateReportTemplate(id, { name?, layout? })` com `.select('id')` e erro
  quando zero linhas voltam, mesmo contrato de `updateReportDoc`: um update
  filtrado por RLS (workspace ativo trocado, acesso revogado) responde 200 com
  zero linhas, e sem a checagem o autosave marcaria como salvo algo que não
  persistiu.
- `deleteReportTemplate` passa a usar a mesma checagem de zero linhas, para
  não emitir "Modelo excluído." falso.
- `buildSystemDefaultLayout()` → `buildDefaultLayout({ hasAi: true,
  hasAudience: true, hasBestTimes: true, hasTags: true })` importado de
  `supabase/functions/_shared/report-docs/default-layout.ts` (o CRM já tem
  `allowImportingTsExtensions`), passado por `stripAiTextForTemplate`.
- Duplicar e Novo usam o `createReportTemplate` existente.

Nome de cópia: "Cópia de {nome}" ("Padrão do sistema (cópia)" para o
embutido).

## 5. Dialog "Novo relatório"

Em `NewReportDialog.tsx`, ao lado do label "Modelo", link "Ver e editar
modelos" que abre `/configuracao/relatorios` em nova aba (o dialog e a página
não perdem estado). O link só aparece com `configuracoes:ver`, que é o gate da
aba. A query `['report-templates']` do dialog passa a usar
`refetchOnWindowFocus: 'always'`: o `QueryClient` global tem
`staleTime: 30_000`, então sem isso um modelo criado na outra aba e a volta em
menos de 30s manteriam a lista antiga no select. A escolha manual já é
protegida pelo `appliedDefaultRef` existente.

## Testes

- `ReportTemplatesCard`: lista (padrão do sistema primeiro, badge padrão,
  contagem de blocos), Novo/Duplicar criam e navegam, Definir como padrão,
  Renomear, Excluir com confirmação, erro vira toast, mutações invalidam ou
  removem a query de detalhe.
- `ModeloEditorPage`: carrega o modelo, edita nome e layout com autosave
  (via `updateReportTemplate`, com texto de IA removido), blocos `ai_*` mostram
  placeholder, ações de relatório ausentes, "não encontrado".
- `reportTemplates.ts`: update e delete com zero linhas lançam erro.
- `useLayoutAutosave`: testes existentes intactos; um caso novo com o
  adaptador de modelo.
- `NewReportDialog`: link presente com `configuracoes:ver`, ausente sem; query
  de modelos com `refetchOnWindowFocus: 'always'`.
- Verificação no browser (Configuração › Relatórios e editor de modelo) quando
  o ambiente local permitir; estas telas usam só PostgREST, então o bloqueio de
  CORS das edge functions no staging não deve impedir.

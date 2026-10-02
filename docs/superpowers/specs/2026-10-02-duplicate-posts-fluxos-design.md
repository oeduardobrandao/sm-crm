# Duplicar post e duplicar fluxo

Data: 2026-10-02
Status: aprovado no brainstorming, aguardando plano

## Objetivo

O usuário pode duplicar um post ou um fluxo inteiro. A cópia mantém o conteúdo, a mídia, as
propriedades e a posição no processo. No momento de duplicar ele escolhe entre manter o status
atual de cada post ou passar tudo para Rascunho.

## Decisões fechadas

| Tema | Decisão |
|---|---|
| Arquitetura | Duas RPCs Postgres atômicas: `duplicate_post` e `duplicate_workflow` |
| Agendado / Postado / Falha com "manter status" | Viram `aprovado_cliente` sem nenhum resultado de publicação |
| `scheduled_at` | Mantido nos dois modos (o post aparece no mesmo dia do Calendário) |
| Etapas do fluxo | Copiadas no estado atual: a cópia fica na mesma coluna do original |
| Destino | Mesmo lugar: post no mesmo fluxo (ou avulso), fluxo no mesmo cliente |
| Post individual (avulso com processo) | O processo é clonado na mesma etapa |
| Nome | `" (cópia)"` no fim do título do post e do fluxo |

`duplicateWorkflow` em `apps/crm/src/store/workflows.ts` é a cópia de recorrência (volta para a
etapa 0, recalcula prazos) e **não muda**. Os wrappers novos se chamam `clonePost` e
`cloneWorkflow`.

## Backend

### Forma das funções

```sql
duplicate_post(p_post_id bigint, p_to_rascunho boolean) RETURNS bigint          -- id do post novo
duplicate_workflow(p_workflow_id bigint, p_to_rascunho boolean) RETURNS bigint  -- id do fluxo novo
```

- `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`. DEFINER é necessário porque
  `post_processes` / `post_process_steps` recusam INSERT de `authenticated` (`WITH CHECK (false)`).
- A primeira coisa que cada função faz é carregar a origem e exigir
  `conta_id IN (SELECT get_my_conta_id())`. Origem inexistente ou de outro workspace levanta o
  mesmo erro genérico (`not_found`), sem distinguir os dois casos.
- `REVOKE ALL ... FROM PUBLIC, anon` com os papéis nomeados (REVOKE só de PUBLIC não tira de
  anon/authenticated no hosted) e `GRANT EXECUTE ... TO authenticated`.
- Qualquer membro pode duplicar (owner, admin e agent), igual a criar post hoje: a RLS de
  `workflow_posts` não restringe por papel.
- Tudo numa transação. Os triggers de limite de plano (`trg_limit_posts`,
  `trg_limit_posts_avulsos`, `trg_limit_workflows`) continuam disparando porque triggers rodam
  independentemente do papel; o `plan_limit_exceeded:<chave>` desfaz a cópia inteira.
- `duplicate_workflow` reutiliza a lógica de cópia de post por meio de uma função interna
  `_clone_post_row(p_src_post_id, p_target_workflow_id, p_to_rascunho, p_option_map jsonb)`
  (sem GRANT para `authenticated`), para que as regras de post fiquem num lugar só.

### Regras de cópia do post

**Colunas copiadas:** `titulo` + `" (cópia)"`, `conteudo`, `conteudo_plain`, `tipo`,
`platform`, `responsavel_id`, `ig_caption`, `music_note`, `cover_url`, `tiktok_caption`,
`tiktok_title`, `tiktok_settings`, `ig_trial_strategy`, `is_express`, `scheduled_at`,
`cliente_id` (só para avulso; com fluxo o trigger `post_a0_sync_cliente` deriva),
`conta_id`.

**Colunas definidas pela cópia:** `workflow_id` (o mesmo fluxo, ou o fluxo novo na cópia de
fluxo), `created_via = 'human'`, `created_at`/`updated_at` default.

**Colunas sempre zeradas (null / 0):** `instagram_container_id`, `instagram_media_id`,
`instagram_permalink`, `published_at`, `publish_error`, `publish_error_code`,
`publish_retry_count`, `publish_processing_at`, `story_segments`, `carousel_children`,
`tiktok_publish_id`, `tiktok_post_id`, `tiktok_post_url`, `tiktok_publish_status`,
`tiktok_publish_error`, `tiktok_publish_retry_count`, `tiktok_publish_processing_at`,
`media_autocleaned_at`. `story_segments` e `carousel_children` são estado de publicação
regenerado a partir da mídia (`ensureStorySegments`), então zerar não perde estrutura.

**Status:**

| Origem | `p_to_rascunho = true` | `p_to_rascunho = false` |
|---|---|---|
| qualquer | `rascunho`, `custom_status_id = null` | ver linhas abaixo |
| rascunho, revisão interna, aprovado interno, enviado ao cliente, aprovado pelo cliente, correção | (linha acima) | mesmo `status` e mesmo `custom_status_id` |
| agendado, postado, falha_publicacao | (linha acima) | `aprovado_cliente`, `custom_status_id = null` |

O `custom_status_id` só fica quando o `status` fica. Um status customizado que se comporta como
agendado/postado/falha cai na terceira linha, senão o trigger z1 forçaria o `status` de volta
para o `behaves_as`. Inserir com qualquer status não dispara eventos de status, automações nem
notificações (todos são de UPDATE). Auto-publicação só acontece em `hub-approve` numa aprovação
real do cliente, então um clone `aprovado_cliente` com data nunca publica sozinho.

**Posição:** logo depois do original. `ordem`: os posts do mesmo fluxo (ou, para avulso, do
mesmo cliente com `workflow_id IS NULL`) com `ordem > original.ordem` sobem 1 e o clone recebe
`original.ordem + 1` (não há UNIQUE em `ordem`). `board_ordem`: ponto médio entre o original e o
próximo post do quadro; sem próximo, `original.board_ordem + 1`. Na cópia de fluxo os posts
mantêm `ordem` e `board_ordem` originais (fluxo novo, sem colisão).

**Mídia (`post_file_links`):** uma linha nova por link, apontando para o **mesmo** `file_id`,
com o mesmo `sort_order` e `is_cover`. Arquivos são compartilhados por desenho: o
`reference_count` é mantido por trigger, não há cópia em R2 nem consumo de cota. A linha de capa é
inserida primeiro com `is_cover = true` e as demais com `is_cover = false`, para o trigger
`post_file_link_auto_cover` não escolher outra capa.

**Propriedades (`post_property_values`):** copiadas linha a linha. Na cópia de fluxo, valores
de select/multiselect/status passam pelo mapa de opções (abaixo); na cópia de post dentro do
mesmo fluxo as opções são as mesmas e o valor é copiado como está.

**Processo (post individual):** se o post tem processo vigente (`estado IN ('ativo',
'concluido')`), copiar a linha de `post_processes` (mesmo `template_id`, `template_nome`,
`assinatura`, `origem_*`, `estado`, `etapa_atual`, `modo_prazo`, `revisao`, `concluido_em`;
`created_by = auth.uid()`; `board_position` logo depois do original) e todas as
`post_process_steps` com o mesmo estado, prazos e datas. `post_process_events` não são copiados.
Se o workspace não tem mais `feature_post_processes` (o trigger `trg_feature_post_processes`
recusaria o INSERT), a função checa antes com o mesmo helper que `enforce_plan_feature` usa e
cria o clone como post avulso simples, sem processo, em vez de falhar.

**Não copiados:** `post_approvals`, `post_comment_threads`/`post_comments`,
`post_edit_suggestions`, `post_status_events`, `post_content_versions`,
`post_process_events`, `instagram_comment_automations`. Menções não são re-sincronizadas
(`syncMentions` não é chamado), para ninguém ser notificado de novo.

### Regras de cópia do fluxo

**`workflows`:** `titulo` + `" (cópia)"`, mesmos `cliente_id`, `template_id`, `status`,
`etapa_atual`, `recorrente`, `modo_prazo`, `link_notion`, `link_drive`, `concluido_em`;
`user_id = auth.uid()`, `created_via = 'human'`. `position`: logo depois do original na mesma
coluna (os fluxos posteriores da coluna sobem 1). O trigger de evento "created" de
`workflow_events` dispara normalmente; o resto do histórico não é copiado.

**`workflow_etapas`:** todas, com mesmo `ordem`, `nome`, `prazo_dias`, `tipo_prazo`,
`responsavel_id`, `tipo`, `status`, `iniciado_em`, `concluido_em`, `data_limite`.

**`workflow_select_options`:** uma linha nova por opção com `option_id` novo
(`gen_random_uuid()`, a coluna é UNIQUE global). Monta-se um mapa `option_id antigo → novo` e
cada valor de propriedade é reescrito: string presente no mapa é trocada; array tem cada
elemento presente no mapa trocado; o resto fica como está (opções vindas do `config` da
definição do template não são por fluxo e não mudam).

**Posts:** cada post do fluxo passa por `_clone_post_row` com o mesmo `p_to_rascunho`.

**Não copiados:** `portal_tokens` (o link do Hub é gerado sob demanda), histórico de
`workflow_events`.

### Migração

Um arquivo novo em `supabase/migrations/` com prefixo de versão único acima do topo de `main`
na hora de abrir o PR. Aplicar em prod **antes** do merge, porque o merge publica o frontend.

## Frontend

### Store

- `clonePost(postId: number, toRascunho: boolean): Promise<number>` em `store/posts.ts`.
- `cloneWorkflow(workflowId: number, toRascunho: boolean): Promise<number>` em
  `store/workflows.ts`.
- Ambos chamam `supabase.rpc(...)` e propagam o erro; o chamador mapeia
  `plan_limit_exceeded` com `apps/crm/src/lib/entitlement-errors.ts`.

### Pontos de entrada

| Onde | Item |
|---|---|
| `WorkflowDrawer` → kebab do `SortablePostItem` | "Duplicar post" |
| `PostProcessCard` kebab | "Duplicar post" |
| `StandalonePostDrawer` cabeçalho | botão "Duplicar post" (ícone `Copy`, com tooltip) |
| `WorkflowCard` kebab | "Duplicar fluxo" |

### Diálogo

Um componente `DuplicateDialog` (shadcn `Dialog` + `RadioGroup`), usado pelos dois casos:

- Título: "Duplicar post" / "Duplicar fluxo".
- Opção 1 (padrão): "Manter status atuais". Ajuda: "Posts agendados, postados ou com falha
  voltam para Aprovado pelo cliente, sem agendamento." Na versão de post, a ajuda só aparece
  quando o post está num desses três status.
- Opção 2: "Mudar tudo para Rascunho" (no post: "Mudar para Rascunho").
- Na versão de fluxo, uma linha informativa: "Os N posts do fluxo serão copiados com a mídia."
- Botões "Cancelar" e "Duplicar"; o segundo mostra estado de carregamento e o diálogo não fecha
  enquanto a chamada está em voo.
- Sucesso: fecha, `toast.success('Post duplicado' | 'Fluxo duplicado')` com ação "Abrir"
  (abre o drawer da cópia), invalida as queries de posts/fluxos/quadro afetadas.
- Erro: `plan_limit_exceeded` mostra a mensagem do mapeamento existente; qualquer outro erro,
  `toast.error('Não foi possível duplicar. Tente novamente.')`.

Copy sem travessão (regra da casa).

## Efeitos conhecidos (documentados, não corrigidos)

- Com "Manter status", um post em Enviado, Aprovado ou Correção aparece no Hub do cliente na
  hora como um post a mais, sem histórico de aprovação por trás.
- A pasta automática do post clonado (`trg_folder_sync_post`) nasce vazia: os arquivos são
  compartilhados e continuam com `folder_id` da pasta do original.
- Excluir o original não apaga a mídia do clone: o link do clone mantém o arquivo vivo
  (`file_id` é RESTRICT e o autoclean só leva arquivos cujos posts estão todos postados).

## Testes

- **psql (`supabase/tests/entitlements/`, gate no CI):**
  - isolamento: membro de outro workspace recebe `not_found`; `anon` não tem EXECUTE;
  - matriz de status dos dois modos, incluindo status customizado com `behaves_as` agendado;
  - campos de publicação zerados e `scheduled_at` mantido;
  - links de mídia apontando para o mesmo arquivo, capa preservada, `reference_count` +1;
  - posição: `ordem` e `board_ordem` do clone logo depois do original;
  - fluxo: etapas no mesmo estado, opções com `option_id` novo e valores select/multiselect
    remapeados;
  - limite de plano estourado desfaz tudo (nenhum fluxo, etapa ou post órfão);
  - post individual: processo e steps clonados; sem a feature, clone sem processo.
- **Vitest:** `clonePost`/`cloneWorkflow` chamam a RPC certa e propagam erro; `DuplicateDialog`
  envia a opção escolhida, bloqueia fechar em voo, mostra a ajuda certa.
- **Browser:** duplicar post e fluxo contra dados de seed e conferir quadro, drawer e mídia.

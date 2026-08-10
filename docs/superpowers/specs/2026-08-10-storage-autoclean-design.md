# Storage management: auto-limpeza de mídia de posts publicados

Data: 2026-08-10 · Status: aprovado (brainstorm + mockup visual validados com o usuário)

## Problema

Workspaces acumulam mídia até bater na cota do plano (Free = 100 MB). Owners querem
manter o armazenamento circulando: apagar automaticamente a mídia de posts que já
foram publicados, imediatamente ou depois de N dias, opcionalmente só quando o uso
passa de um limiar. Isso reduz fricção de upgrade, carga de suporte e o nosso próprio
custo de R2.

## Decisões de produto

- **Uma política**: apagar mídia **somente de posts publicados** (a ideia de "apagar
  o que tem mais de N dias" colapsa em "N dias depois de publicar"). Arquivos da
  página Arquivos sem vínculo com post, documentos e logos de marca **nunca** são
  tocados.
- Timing: imediatamente (0) ou N dias após a publicação (padrão 30). Desligado por
  padrão.
- Modificador de limiar (opcional): só rodar quando o uso > X% da cota do plano.
  Cota ilimitada ⇒ percentual indefinido ⇒ pula a execução (fail-safe: nunca apagar).
- Segurança: estimativa ao vivo na página de configurações ("isso liberaria ~X GB
  hoje"), entrada no audit_log e notificação in-app a cada execução. Sem fila de
  revisão.
- Depois da limpeza, o post mostra um placeholder "Mídia removida para liberar
  espaço" no CRM e no Hub, com o link da publicação no Instagram (já armazenado).
- Disponível em TODOS os planos (sem feature flag). Configuração exclusiva do owner.
- "Publicado" = `workflow_posts.status = 'postado'`, que já é agnóstico de
  plataforma: um post Instagram+TikTok só vira `postado` quando os dois lados
  publicam. Plataformas futuras herdam isso de graça.

## Arquitetura

Apagar uma linha de `files` já enfileira o objeto R2 em `file_deletions` (drenado
diariamente às 03:00 pelo `post-media-cleanup-cron`) e decrementa
`workspaces.storage_used_bytes` via triggers. A feature se reduz a: schema da
política, um predicado de candidatos correto, um cron e UI.

### Schema (colunas em `workspaces`, padrão da casa)

- `storage_autoclean_enabled boolean NOT NULL DEFAULT false`
- `storage_autoclean_delay_days int NOT NULL DEFAULT 30` (CHECK 0–365; 0 = imediato)
- `storage_autoclean_threshold_pct int` (CHECK NULL ou 1–100; NULL = sempre)
- `storage_autoclean_last_run_at timestamptz`, `_last_files int`, `_last_bytes bigint`
  (escritas só pelo executor)
- `workflow_posts.media_autocleaned_at timestamptz` — marcador do placeholder
  (distingue "limpo" de "nunca teve mídia")
- Guard trigger BEFORE UPDATE em `workspaces`: as três colunas de política só podem
  mudar quando o ator é owner em `workspace_members` (`auth.uid() IS NULL` passa,
  para service role/definer). A RLS `ws_update_owner_admin` é owner-OU-admin e
  row-level; RLS não compara OLD/NEW.

### Predicado de candidatos (superfície de corretude central)

Uma função SQL compartilhada `storage_autoclean_candidates(p_workspace, p_cutoff)`
usada pela preview E pelo executor (zero deriva). Um arquivo qualifica sse:

- pertence ao workspace;
- tem ≥1 `post_file_links` (arquivos só do Arquivos, documentos e logos de marca
  ficam estruturalmente de fora);
- NENHUM link desqualifica: post de outro tenant, `status <> 'postado'`, ou
  `COALESCE(published_at, scheduled_at)` NULL ou depois do cutoff (o data-import
  pode criar `postado` com `published_at` NULL e `scheduled_at` futuro);
- não é referenciado por `ideia_files`.

Nunca usar `reference_count` como gate (inflado em linhas antigas do Estúdio);
contar linhas de link reais.

### Executor

RPC `storage_autoclean_run(p_workspace, p_max_files DEFAULT 500)` — SECURITY
DEFINER, service-role-only, uma transação: lock do workspace (`FOR UPDATE`),
checagem de política + limiar (`effective_plan_limit`), candidatos com
`ORDER BY file_id LIMIT p_max_files` (batch determinístico; sobras na próxima
noite), carimbo de `media_autocleaned_at`, DELETE dos links (FK RESTRICT) e depois
dos files (triggers cuidam de R2 + contabilidade), atualização de
`storage_autoclean_last_*`, audit_log (`action='storage_autoclean'`) e
`insert_notification_batch` (tipo `storage_autoclean_report`, owners+admins).
NUNCA criar um RPC `decrement_storage` (o file-manage chama um inexistente com
`.catch(()=>{})`; criar causaria decremento duplo).

Preview: `storage_autoclean_preview(p_delay_days DEFAULT NULL)` — espelho de
segurança do `workspace_usage` (definer + `get_my_conta_id()` + recheck de
membership), retorna `{files_count, bytes_total}`.

### Cron

Edge function `storage-autoclean-cron` (fábrica handler/index como
`mention-email-cron`, `x-cron-secret` + `timingSafeEqual`, `reportCronFailure`),
agendada `30 2 * * *` (30 min antes do drain de R2 das 03:00) via migration com a
forma SUBSELECT de `vault.decrypted_secrets`. Itera workspaces habilitados,
continua após erro por workspace, agrega e reporta uma vez.

### UI

- Nova aba `Configurações → Armazenamento` (roles `['owner']`, grupo Workspace):
  medidor de uso (UsageMeter), card "Limpeza automática" (switch, "Quando remover"
  Imediatamente/7/30/90 dias, "Somente quando o uso passar de" Sempre/50/75/90% —
  oculto em plano ilimitado), caixa de estimativa ao vivo, linha de última
  execução, botão salvar. Guard interno `useIsWorkspaceOwner()`.
- CRM (drawer de Entregas): card tracejado "Mídia removida para liberar espaço" +
  data + botão "Ver publicação no Instagram" quando `media_autocleaned_at` está
  setado e o post não tem mídia.
- Hub: área de capa do card vira o placeholder com pill "Ver no Instagram" na cor
  da marca.
- Notificação no sino: "Limpeza de armazenamento · N arquivos removidos · X
  liberados".

Mockup completo validado: sessão do visual companion de 2026-08-10 (full-ui.html).

## Fora de escopo (v1)

- Fila de revisão antes de apagar.
- Manter thumbnails dos originais apagados.
- Limpeza de arquivos sem vínculo com posts.
- E2E dedicado.

## Ordem de deploy

1. Migrations 000001–000003 (`db push`, segurando a 000004).
2. Deploy `storage-autoclean-cron` (--no-verify-jwt --use-api) + re-deploy
   `hub-posts`.
3. Migration 000004 (schedule).
4. Frontend via merge → Vercel.
5. Rollback no inverso: `cron.unschedule` primeiro.

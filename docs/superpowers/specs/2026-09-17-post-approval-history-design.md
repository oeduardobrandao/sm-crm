# Histórico de aprovação e comentários por post (Hub)

**Data:** 2026-09-17
**Status:** Design proposto, aguardando aprovação
**Origem:** Feedback direto de Anna Lourenço (CLD Advogados), repassado via Hanna

## Contexto

Hoje o Hub do cliente tem três pontos de atrito de rastreabilidade:

1. **Aba "Aprovações":** ao aprovar ou pedir correção, o card não guarda o histórico — não fica visível o que já foi aprovado, rejeitado, ou o motivo de uma correção.
2. **Aba "Postagens":** mostra só a versão final publicada/agendada, sem o processo que levou até ali.
3. **Aba "Mensagens":** um chat único por workspace mistura pedidos de ajuste de posts diferentes numa fila só, sem status individual por post.

A cliente pediu, na prática, uma linha do tempo por post (log de versões com quem fez o quê e quando), um filtro de status, KPIs de gestão (rodadas de ajuste, motivos frequentes, tempo de resposta) e um espaço de comentários gerais dentro do card de cada post, como no Notion.

### O que já existe hoje (levantado antes de desenhar)

O backend já registra praticamente todo o material bruto necessário — isto é um trabalho de **exposição no Hub**, não de criar um pipeline de auditoria do zero:

- `post_approvals` (`supabase/migrations/20260402_workflow_posts.sql`): uma linha por ação do cliente (`aprovado` | `correcao` | `mensagem`), com `comentario` e `is_workspace_user`. É o que a RPC `record_client_approval` grava a cada aprovação/correção enviada pelo Hub (`supabase/functions/hub-approve/handler.ts`).
- `post_status_events` (mesma migration): trigger que loga toda transição de status (`from_status`, `to_status`, `source`, `actor_name`), ligado a `post_approvals` via `post_approval_id`.
- `post_content_versions` (`20260923000001...` + fixups `20260923000004-8`): snapshot completo do conteúdo a cada edição que muda algo (`conteudo`, `conteudo_plain`, `ig_caption`, `tiktok_caption`, `changed_fields`, `source`, `actor_name`), com coalescing de saves rápidos e captura de baseline no primeiro edit.
- `post_edit_suggestions` (`20260521000001`): sugestões de edição do cliente, pendentes de aceite/rejeição pela equipe.
- No CRM já existe um equivalente funcional: `buildPostTimeline()` / `PostTimelinePopover.tsx` (eventos de status + comentário) e `buildVersionTimeline()` / `PostVersionHistorySheet.tsx` (versões de conteúdo) — ambos em `apps/crm/src/pages/entregas/components/`. O Hub não tem nenhum dos dois hoje.
- MCP `list_post_feedback` já expõe uma leitura equivalente sobre `post_approvals` + `post_status_events`.

Ou seja: o gap real é (a) uma UI no Hub que junte esses dados num log v1/v2/v3/v4 legível, (b) uma tag de motivo estruturada (hoje é só texto livre), e (c) uma superfície de comentário por post que hoje não existe (só o chat de workspace).

## Decisões de escopo (validadas com a Hanna)

| Ponto em aberto | Decisão |
|---|---|
| "Rejeitado" vs "Em Refação" | **Mesmo status.** Não existe hoje um estado terminal de rejeição distinto de "precisa de ajuste" (`correcao_cliente`). "Rejeitado" no filtro é apenas um rótulo alternativo do mesmo status — nenhuma mudança de enum. Se a Anna realmente quiser dizer "descartado, não volta pra fila" como algo diferente de "pequeno ajuste", isso é um estado novo e fica fora deste escopo. |
| Onde a timeline aparece | Só no **Hub** por agora. O CRM já tem uma view equivalente (`PostVersionHistorySheet`/`PostTimelinePopover`); não será redesenhado junto. |
| Comentários gerais | Aba nova **dentro do card do post**, adicional ao chat de Mensagens existente (que continua servindo para assuntos que não são de um post específico). Não substitui nada. |
| Onde os KPIs aparecem | Por post (dentro do card) **e** um resumo agregado (painel acima da lista). |
| Diff de conteúdo | Incluído, mas **sob demanda**: cada item da timeline expande para mostrar o diff palavra-a-palavra ao ser clicado — não fica sempre visível. |
| Categorização de motivo de ajuste | **Tag manual** no momento do pedido de correção (chip: Legenda / Imagem-vídeo / Data / Outro), não inferência por IA. Ranking exato, mas só vale daqui pra frente — feedback histórico não tem tag. |
| Notificação de comentário novo | **Indicador passivo** (badge de não lidos) na primeira versão. Notificação ativa (e-mail/WhatsApp) fica fora de escopo. |

## Design

### 1. Timeline de versões por post

- Vive dentro do card do post (Aprovações, Postagens, Início — qualquer lugar que já renderize `PostCard`), como uma **aba inferior que expande para baixo** ("▾ Ver histórico"), nunca um painel lateral sobreposto — critério: o Hub é muito acessado no celular, e expandir para baixo não sobrepõe o próximo card em telas estreitas.
- Fonte dos dados: união de `post_status_events` + `post_approvals` (comentário/ação) + `post_content_versions` (para o diff), na mesma lógica de merge que `buildPostTimeline()`/`buildVersionTimeline()` já fazem no CRM — a UI do Hub consome os mesmos dados, não um pipeline novo.
- Cada entrada mostra: quem agiu (equipe vs. cliente, cor diferente — verde equipe, azul cliente, dourado para o status final), o quê, e quando.
- Clicar numa entrada com mudança de conteúdo expande um diff de texto (trecho removido riscado, trecho novo destacado) usando o `conteudo`/`changed_fields` salvos em `post_content_versions`. Mudança de mídia (imagem/vídeo) aparece como uma miniatura anexada ao evento, sem comparação lado a lado — diff de mídia fica fora de escopo.

### 2. Filtro de status

- Barra de chips no topo da lista (Aprovações e Postagens): Todos / Pendente de Aprovação (`enviado_cliente`) / Em Refação (`correcao_cliente`) / Aprovado (`aprovado_cliente`), cada um com contagem ao vivo.
- Nenhuma mudança de schema — é um filtro client-side (ou query param) sobre o status já existente em `workflow_posts`.

### 3. KPIs

- **Por post:** dentro do card, uma linha compacta com número de rodadas de ajuste (contagem de eventos `correcao` em `post_approvals` para aquele post) e tempo médio de resposta (delta entre um evento `correcao` e o próximo evento da equipe que muda o status de volta para `enviado_cliente`).
- **Agregado:** painel acima da lista com: rodadas médias por post, tempo médio de resposta, e motivos mais frequentes (contagem das tags de correção, ver abaixo), com uma janela padrão (ex.: últimos 30 dias) e — a definir na fase de planejamento — se filtra pelo status atual selecionado ou é sempre workspace-wide.
- Motivo de ajuste: ao pedir correção no Hub, o cliente escolhe uma tag curta (Legenda / Imagem-vídeo / Data / Outro) além do comentário livre atual. Isso é uma coluna nova em `post_approvals` (ou tabela de apoio), populada só a partir do deploy — histórico antigo fica sem tag e é excluído do ranking (ou aparece como "Outro/sem categoria", a definir no plano).

### 4. Comentários gerais por post

- Segunda aba dentro do mesmo card, ao lado de "Histórico": "Comentários" — uma lista de mensagens livre, sem ligação com mudança de status (diferente de `post_approvals`, que é sempre atrelado a uma ação de aprovação/correção).
- Requer uma tabela nova (ex.: `post_comments`, com RLS/token-scoping igual ao resto do Hub) — não reaproveita `mensagens` (que é por cliente, não por post) nem `post_approvals` (que é sempre atrelado a uma transição de status).
- Indicador de não lido: badge simples ao entrar no Hub/CRM. Sem e-mail/WhatsApp nesta versão.

## Fora de escopo (explicitamente)

- Estado "Rejeitado" como status terminal distinto de "Em Refação".
- Redesenho da view de histórico já existente no CRM.
- Diff lado a lado de mídia (imagem/vídeo).
- Categorização por IA dos motivos de ajuste.
- Notificação ativa (e-mail/WhatsApp) de comentário novo.
- Retroatividade da tag de motivo de ajuste para posts já existentes.

## Riscos / pontos a validar com a Anna antes de construir

1. Confirmar que "Rejeitado" não precisa ser um estado diferente de "Em Refação" na prática dela.
2. Confirmar que tags de motivo (4 opções fixas) cobrem os casos reais dela, ou se precisa de uma lista diferente/editável.
3. Confirmar que um indicador passivo de comentário é suficiente por agora (não uma notificação ativa).

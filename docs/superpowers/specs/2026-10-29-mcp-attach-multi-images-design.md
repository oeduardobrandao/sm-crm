# Card de anexar com várias imagens (MCP Apps)

Status: aprovado (mockups) em 2026-10-29. Mockups: https://claude.ai/artifact/FFy9puch4BGKmoAhKCpXWL
Base: `docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md` §4.6 (card de anexar, uma imagem).

## Por quê

No piloto, a pessoa mandou 6 imagens no ChatGPT e pediu "crie um post e adicione essas imagens". O agente
abriu 6 cards `show_attach_image`, um por imagem. Cada card calculou o slide padrão com o post como estava
quando abriu (vazio), então todos sugeriam o slide 1: a 6ª imagem virou o slide 1 e a pessoa teria de
confirmar 6 cards, um a um, sem ver o resultado junto.

Objetivo: **um card recebe todas as imagens, a pessoa ajusta a ordem, escolhe onde entram e confirma uma
vez**; o card anexa em sequência mostrando o progresso e termina mostrando como o post ficou.

Não-objetivos: anexar vídeo; reordenar ou remover slides que já estão no post (isso é o editor do CRM);
mudar o fluxo de uma imagem só (continua com o seletor de slide de hoje).

## Decisões do usuário

- Post que já tem slides: o card pergunta. Padrão "Depois dos slides atuais"; opção "Substituir os slides atuais".
- Ordem: começa na ordem do chat; setas ← → em cada miniatura mudam a posição.
- Vocabulário: "slide", nunca "lâmina".

## Ferramentas (`supabase/functions/mcp/attach.ts`)

### `show_attach_image` (modelo vê)

- `images: z.array(z.object(imageShape)).min(1).max(10)`; `image` continua aceito (hosts com a listagem
  antiga). Os dois juntos são mesclados (`image` primeiro, cada `file_id` uma vez); nenhum: `McpInputError`
  "Envie as imagens em `images` (uma lista, na ordem do chat)."
- `_meta["openai/fileParams"]: ["images", "image"]` (a doc do Apps SDK aceita campo de arquivo como array).
- Descrição: passe **todas** as imagens em `images`, na ordem do chat, numa chamada só, nunca um card por
  imagem; mais de 10, mande as 10 primeiras e diga que o resto precisa de outro post. `position` só vale
  com uma imagem: com duas ou mais é ignorado e não vai no `structuredContent` (um erro faria o modelo
  tentar de novo às cegas).
- `structuredContent` (card `attach_image`, `v: 1`): ganha `images` e mantém `image = images[0]` (o HTML
  em cache dos hosts segue funcionando com a primeira imagem); `media[]` ganha `link_id`.
- Resumo para o modelo cita K e, com K > 1, diz que um card com uma imagem só indica conector antigo.
- Auditoria: `{post_id, position, images: K}`; nunca URL.

### `attach_image_to_post` (só o widget, só OAuth, uma imagem por chamada)

- Ganha `expected_count` (anexar: quantos slides o card acha que o post tem antes desta imagem),
  `expected_link_id` (substituir: o link que o card viu nessa posição) e `trim_after`.
- Com expectativa: confere antes de baixar (economia) e chama `mcp_attach_post_file_v2`, que confere de
  novo sob o lock. Sem expectativa (card antigo em cache): `mcp_attach_post_file` como antes.
- `stale_post` vira "O post mudou no Mesaas depois que o card abriu. Peça para abrir o card de novo." e
  a chave subida vai para `file_deletions` (é um raise da RPC: nada foi gravado).
- Resultado ganha `trimmed`. Auditoria ganha `trim_after`.

## Banco: `mcp_attach_post_file_v2` (migration `20261109000001`)

Revisões (Fable e Codex) mostraram que uma RPC de trim separada e posições sem conferência não servem:

- uma chamada de resultado desconhecido (erro de transporte depois do commit) refeita pelo card anexaria
  a imagem duas vezes e deslocaria as seguintes;
- uma edição no CRM depois que o card abriu faria "substituir o slide 3" sobrescrever outro slide;
- o trim numa transação separada poderia apagar um slide que outra pessoa acabou de pôr.

`mcp_attach_post_file_v2(p_conta_id, p_post_id, p_actor, p_file, p_position, p_replace,
p_expected_count int, p_expected_link_id bigint, p_trim_after boolean) RETURNS jsonb`, SECURITY DEFINER,
EXECUTE só `service_role`. Membership em `workspace_members` (P0403), lock `FOR UPDATE` do post,
**depois** a conferência: substituir exige que o link na posição (ordem visível `sort_order, id`) seja
`p_expected_link_id`; anexar exige `count = p_expected_count`; diferente ou ausente: P0001 `stale_post`.
Então chama a v1 (mesma transação, reentra o lock) e, com `p_trim_after`, apaga os links com
`sort_order >= p_position`. Tudo numa transação: qualquer raise desfaz tudo, inclusive o trim.

- Retry de anexar cujo primeiro envio entrou: a contagem mudou, `stale_post`, sem duplicar.
- Retry de substituir: o link mantém o id, a conferência passa e o mesmo slide é substituído de novo
  (inofensivo: só mais um arquivo em Arquivos).
- Trim: só os links saem; os arquivos ficam em Arquivos (contagem de referência e capa pelos triggers; se
  a capa estava entre os removidos, vai para o primeiro que ficou). `tipo` não muda (carrossel com um slide
  segue carrossel, como no editor).
- A v1 fica para o `mcp` publicado antes deste; uma migration futura a remove.

## Widget (`apps/mcp-widgets/src/cards/`)

- `AttachImage` decide pelo número de imagens: 1 = card de hoje (seletor de slide, agora mandando a
  expectativa quando o servidor manda `link_id`); 2+ = `AttachImages`.
- `AttachImages`, conforme os mockups (antes, anexando, pronto, falha, substituir, celular):
  - Posições (`planSteps`, congeladas no clique): modo depois, imagem j vai em `N + 1 + j` com
    `expected_count = N + j`. Modo substituir, j < N vai em `j + 1` com `replace` e
    `expected_link_id = media[j].link_id`, e a última leva `trim_after` quando K < N; j >= N é anexada em
    `j + 1` com `expected_count = j`. Substituir só aparece quando todo slide atual tem `link_id`.
  - Limite: modo depois com N + K > 10 avisa e desabilita o botão.
  - Para na primeira falha; "Tentar de novo (R imagens)" continua dela com o mesmo plano (a conferência
    no servidor torna isso seguro).
  - Pronto: "K imagens anexadas no Mesaas, nos slides a a b.", o post como ficou com as novas marcadas,
    "Abrir no Mesaas" e "Outro post".
- **Link novo antes de cada envio**: `Host.refreshImageUrl(fileId)` (ChatGPT:
  `window.openai.getFileDownloadUrl({ fileId })`); falhou ou não existe, usa a URL original. Vale para os
  dois cards.
- **CSP**: as miniaturas das imagens do chat vêm do host de arquivos do chat. `resourceDomains` passa a
  incluir as origens de `MCP_IMAGE_HOSTS` (no ChatGPT em modo dev a CSP está desligada, por isso o
  piloto não viu).
- Recurso: `CARDS_URI` = `ui://mesaas/cards-v3.html`; `LEGACY_CARDS_URIS` = v2 e v1.

## Testes

- Deno: `images` em ordem com `image = images[0]`, `position` ignorado com K > 1, mescla de `image` +
  `images`, nenhum (erro), mais de 10 (schema); auditoria só com a contagem; `fileParams`; v2 chamada
  com a expectativa e o trim; `stale_post` antes do download e sob o lock (chave na fila de exclusão);
  recursos legados v2 e v1; `MCP_IMAGE_HOSTS` em `resourceDomains`.
- Vitest: `planSteps` (depois, substituir com menos e com mais imagens), ordem e setas, tela final, modo
  substituir, limite, parada na falha e retomada, `refreshImageUrl`, card de uma imagem com expectativa.
- SQL (`supabase/tests/mcp_attach_post_file_v2.sql`): ACL por `proacl`, retry de anexar recusado, replace
  por link id (retry passa), replace + trim com capa movida e arquivos mantidos, raise da v1 desfaz o
  trim, membership e post inexistente.

## Deploy

Migration `20261109000001` → `mcp` → merge (o CRM não muda). Em ChatGPT dev: "Refresh" no app. Se o
host da URL nova (`getFileDownloadUrl`) for outro, ele aparece em `[mcp] image host refused: <host>`:
acrescente em `MCP_IMAGE_HOSTS`.

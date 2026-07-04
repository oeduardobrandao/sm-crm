# Estúdio via MCP — guia para agentes

Como criar e editar artes (designs) de posts pelo conector Mesaas. Seis ferramentas:
`get_design_capabilities`, `get_design`, `create_design`, `update_design`, `preview_design`
(escopo `posts:read` para leituras, `designs:write` para escritas) e `generate_image`
(escopo `images:generate` — gera custo).

## O loop de trabalho

1. **Descubra** — `get_design_capabilities` (com `client_id` para o kit de marca): formatos e
   canvases válidos por tipo de post, catálogo de fontes, limites, quota de imagens.
2. **Leia** — `get_design {post_id}`: o documento atual + `rev` + estado da renderização.
   `design: null` significa que o post ainda não tem design (não é erro).
3. **Escreva** — `create_design` (primeiro design) ou `update_design` (substituição COMPLETA do
   documento — não existem patches parciais). Passe o `expected_rev` que você leu; a resposta
   traz o documento normalizado, `layout` (bboxes medidos) e o novo `rev`.
4. **Veja** — `preview_design {post_id, page_id?}` retorna a imagem renderizada (uma página por
   chamada). Olhe antes de declarar o trabalho pronto; ajuste e repita.

A renderização final (JPEG publicável) dispara automaticamente a cada escrita — você não
precisa (nem consegue) dispará-la manualmente.

## Convenções do documento (contratuais)

- Coordenadas em **pixels de canvas** (base 1080 de largura), origem no topo-esquerdo, y para
  baixo. `x, y` = canto superior esquerdo da caixa NÃO rotacionada.
- `rotation` em graus, sentido horário, em torno do centro da caixa. `opacity` 0–1.
- Cores: SOMENTE `#rrggbb` ou `#rrggbbaa`. Nada de nomes, `rgb()` ou `hsl()`.
- `line_height` é multiplicador (padrão 1.2); `letter_spacing` em px.
- **Z-order é a ordem do array** — camadas posteriores pintam por cima.
- Camadas de texto **não têm `h`** — o texto cresce verticalmente; `w` é a largura fixa de
  quebra. Use o `layout` da resposta para saber a altura real medida.
- Texto aceita `\n` e os tokens `{{page}}` / `{{pages}}` (contadores resolvidos no render).
- Estilo no meio da frase: use `runs` (array de trechos com `font_weight`/`color`/`font_style`
  próprios) em vez de `text`. `text` e `runs` são mutuamente exclusivos.
- Imagens SEMPRE por `file_id` (do workspace) — nunca URLs. `fit: 'cover' | 'contain'`.
- Fontes por `{font_key, font_weight, font_style}` do catálogo — nunca nomes de família crus.
  Consulte `get_design_capabilities` (fontes da marca vêm resolvidas em `brand.font_primary/
  secondary.resolved_key`; `null` = não incluída no catálogo, use o `fallback_key`).

## Limites (rejeitados na validação)

≤10 páginas · ≤40 camadas/página · ≤2000 caracteres por camada de texto · documento ≤256 KB ·
`format` deve casar com o tipo do post (feed→feed, carrossel→carrossel, reels→reel_cover;
stories não é suportado) · carrossel publica no máximo 10 itens.

## Corrigindo erros de validação (uma tentativa deve bastar)

Escritas inválidas retornam TODOS os problemas agregados — corrija todos de uma vez e reenvie:

```jsonc
{
  "error": "design_invalid",
  "doc_version": 1,
  "issues": [
    { "path": "pages[0].layers[2].font_key", "code": "unknown_font",
      "message": "Fonte 'Helvetica' não está no catálogo.",
      "allowed": ["dm-sans", "montserrat", "…"] },
    { "path": "pages[0].layers[3].color", "code": "invalid_color",
      "message": "use #rrggbb[aa]" }
  ],
  "issue_count": 2,
  "truncated": false
}
```

Cada `path` aponta o campo exato; `allowed`/`message` dizem o valor aceitável. Outros erros
estruturados que você pode receber:

- `design_already_exists` (em `create_design`) → use `update_design`.
- `rev_conflict` (em `update_design`) → alguém editou antes de você; a resposta traz
  `current_rev` — releia com `get_design`, reaplique sua mudança sobre o documento atual e
  reenvie com o novo `expected_rev`. (Omitir `expected_rev` faz a última escrita vencer — use
  apenas quando você acabou de ler o documento.)
- `post_has_video_media` → o post tem vídeo; designs feed/carrossel não se aplicam.
- `page_not_found` (em `preview_design`) → a resposta traz `page_ids` com as páginas reais.

## Gerando imagens (`generate_image` — custa dinheiro)

- `placement: 'background'` gera em 2K (fundos full-bleed); `'element'` em 1K.
- Com `client_id`, as cores e o segmento da marca entram como contexto do prompt;
  `use_brand_logo: true` anexa o logo como referência (exige logo materializado —
  `get_design_capabilities` mostra `brand.logo_file_id`).
- A resposta traz `file_id` — use-o em camadas de imagem ou como background do design. A imagem
  NUNCA é anexada ao post diretamente.
- SEMPRE passe `idempotency_key` (um UUID por submissão): retries ficam seguros e nunca cobram
  duas vezes. `quota` na resposta mostra uso/limite/renovação do mês.

## O que você não controla

- Publicação/agendamento: nunca acontecem por estas ferramentas; o gate de publicação exige o
  design renderizado e atual.
- Um post em `correcao_cliente` volta automaticamente para `revisao_interna` quando você grava
  um design (uma mudança de arte é uma edição de conteúdo).
- `get_design_capabilities` e `get_design` nunca têm efeitos colaterais (o logo só é
  materializado por `generate_image use_brand_logo` ou pelo CRM).

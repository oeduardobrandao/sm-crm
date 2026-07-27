# Como publicar um artigo no blog

Este guia descreve o que o código realmente valida. As regras vêm de
`apps/crm/src/content/__tests__/blog-content.test.ts` (o "content lint") e de
`apps/crm/src/content/blog.schema.ts` (o frontmatter) — se um artigo passa em
`npm run test`, ele está publicável.

## 1. Crie o arquivo

`apps/crm/src/content/blog/<slug>.md`. O nome do arquivo é a URL: `/blog/<slug>`.
O slug precisa ser kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`) e único entre os posts.

Não é preciso registrar nada em `vercel.json` ou no App router — as rotas
`/blog` e `/blog/:slug` já existem de forma genérica. O índice do blog, o
sitemap e o `llms.txt` são gerados a partir dos arquivos em `content/blog/`
no prerender; um `.md` novo aparece neles sozinho.

## 2. Frontmatter

Todos os campos são obrigatórios, exceto `updated`:

```yaml
---
title: <título da aba/Google — 50 a 60 caracteres>
h1: <título da página — 10 a 120 caracteres, pode ser mais longo que o title>
description: <resumo para o Google — 120 a 160 caracteres>
date: AAAA-MM-DD
updated: AAAA-MM-DD # opcional; use ao revisar um artigo antigo
category: comparativo | guia
---
```

Os limites de caracteres são checados por schema (zod) e falham o build se
violados. `title`, `h1` e `description` passam pelas mesmas regras de conteúdo
do corpo (item 3) — não dá para contornar a regra de preço ou de feature não
lançada escondendo a frase no frontmatter.

## 3. Escreva o corpo

Markdown com GFM (tabelas, listas, links). Comece as seções em `##` — o `#`
(h1) é gerado pela página a partir do frontmatter; um `#` no corpo quebra o
teste, e o corpo precisa de pelo menos duas seções `##`.

Não use HTML cru (`<a>`, `<img>`, `<br>` etc.) — os posts renderizam com
`react-markdown` sem `rehype-raw`, então uma tag vira texto literal na tela em
vez de virar markup. Use markdown puro; autolinks (`<https://…>`) não contam
como HTML e são permitidos.

Todo link interno (`](/algo)`) precisa apontar para uma rota que existe -
outra página do site, outro post do blog, ou `/login?tab=register` (o CTA de
cadastro). E todo post precisa linkar para pelo menos uma página de produto
real (o CTA de cadastro sozinho não conta).

### Preço — só dentro de um exemplo rotulado

Nunca cite o preço de um plano do Mesaas (nem "nosso plano", "plano Pro",
"plano mais barato", "planos da plataforma") — link para `/precos` em vez
disso. Qualquer valor em R$ no corpo só é permitido dentro de uma citação
(`>`) cuja **primeira linha** contenha a palavra "Exemplo":

```markdown
> Exemplo: você vende um plano de 12 posts para o cliente por R$ 1.200.
```

Isso é mais estrito do que parece à primeira vista:

- A citação precisa **abrir** com "Exemplo" — um blockquote que fala de preço
  três linhas depois de um bloco já rotulado não herda o rótulo; cada `>`
  novo (separado por uma linha em branco) reabre a checagem.
- Um preço que é o **do cliente do leitor** (ex.: "cobrar R$ 300 por reels do
  cliente") é permitido mesmo fora de citação — desde que a frase não cite o
  nome Mesaas.
- Mencionar "exemplo" no meio de uma frase normal ("veja o exemplo: são R$ 49
  por post") não conta como rótulo — só a citação conta.

### Features que o Mesaas não lançou

O lint bloqueia afirmar que o Mesaas publica no TikTok ou gera imagens/artes
com IA — essas features ainda não existem no produto. As regras pegam mais
casos do que se imagina:

- **Primeira pessoa do plural conta como afirmação sobre o Mesaas.** Estes
  textos falam do produto na primeira pessoa e do leitor na segunda pessoa —
  então "publicamos no TikTok" ou "geramos as imagens com IA" é pego mesmo
  sem a palavra "Mesaas" na frase.
- **Uma afirmação sem sujeito conta como sendo sobre o Mesaas.** Se a frase
  não cita nosso nome nem o de um concorrente, o lint assume que é sobre o
  Mesaas (falha fechado, não aberto).
- **A capacidade verificada de um concorrente pode ser afirmada.** Uma seção
  ou frase que fala de um rival nomeado (Aprova Post, mLabs, Etus, Doo
  Studio, Postgrain, Robopost) — "o Doo Studio aprova os formatos do
  TikTok" — passa, porque recusar descrever o que um concorrente realmente
  entrega tornaria a comparação desonesta.
- **Uma negação honesta é permitida — mas só se estiver na mesma oração da
  afirmação, e antes dela.** "O Mesaas não publica no TikTok" passa. Mas a
  negação precisa estar entre o início da oração (ou o começo da linha) e a
  afirmação: "O Mesaas publica no TikTok sem sair do kanban" ainda é uma
  afirmação (o "sem" qualifica a saída do kanban, não o TikTok). E a negação
  não atravessa fronteira de oração: "Não é editor de design. O Mesaas gera
  imagens com IA." é dois pensamentos — o segundo continua sendo uma
  afirmação, mesmo com a negação logo antes na frase anterior. Vírgula também
  quebra a oração: "Sem editor de design, o Mesaas gera imagens com IA" é uma
  afirmação, não uma negação (o "sem" está numa oração subordinada anterior).

Na dúvida, escreva a negação e a afirmação na mesma frase, sem vírgula ou
pontuação entre elas: "O Mesaas não gera imagens com IA: o agente escreve o
texto e você anexa a arte."

## 4. Sobreposição de texto entre artigos

Depois de escrever, rode o checador de sobreposição contra os artigos já
publicados:

```bash
npm run blog:overlap -- <slug-ou-caminho-do-novo-artigo>
```

Essa é **a única medição que conta** — duas pessoas medindo o mesmo par de
frases já obtiveram 0,667 e 0,714 porque um tokenizador descartava tokens de
uma letra só e o outro não, o que fazia "≥0,55" significar coisas diferentes
para cada uma. O script em `scripts/blog/overlap.ts` fixa o método: divide o
texto em segmentos por `. ! ? : ;` e quebras de linha, remove acentos, **não**
filtra stopwords, e só reporta pares de segmentos com 8 palavras ou mais (abaixo
disso o placar é ruído e o par tem que ser lido por uma pessoa). Score ≥ 0,55
é reportado como par ofensivo.

Sem argumento nenhum, ele audita o corpo inteiro (todos os pares entre os
posts publicados) — é assim que se confirma que nada regrediu.

## 5. Imagem de compartilhamento (OG)

```bash
npm run og:image
```

Gera `public/og/blog/<slug>.png` a partir do título e categoria do
frontmatter. Rode de novo (e re-commite o PNG) sempre que o `h1` mudar.

## 6. Valide e publique

```bash
npm run test        # inclui o content lint (blog-content.test.ts)
npm run prerender    # gera o HTML estático em dist/blog/<slug>.html — confira
```

Faça commit do `.md` **e** do PNG em `public/og/blog/`. Não há mais nada para
registrar em `vercel.json`, no `App.tsx` ou no sitemap — tudo isso deriva dos
arquivos em `content/blog/`.

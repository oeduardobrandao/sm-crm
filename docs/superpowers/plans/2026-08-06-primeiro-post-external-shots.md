# Capturas externas: guia do primeiro post

Três passos da etapa 3 do artigo `como-agendar-seu-primeiro-post` acontecem em telas do
Facebook, fora do Mesaas. O script de captura não alcança essas telas.

**Você captura, eu subo e autoro.** Deixe cada PNG no caminho da tabela, dentro de
`e2e/.shots/como-agendar-seu-primeiro-post/`, e me avise.

O artigo já está publicado com esses três slots vazios. O passo aparece com texto e sem
imagem, o que é o comportamento normal do helper. Nada quebra enquanto eles não chegarem.

## Configuração da captura

Para casar com as capturas automáticas: janela de navegador com cerca de 1440 de largura,
zoom normal, modo claro. Capture a aba do navegador, não a tela inteira. Formato PNG.

## Redação, confira antes de entregar

Depois de publicado, isso fica visível para todos os clientes. Borre ou corte:

- Seu e-mail e sua foto de perfil, que o Facebook mostra
- Nomes de páginas e de clientes reais no seletor de páginas, que é o maior risco do conjunto
- Qualquer workspace não relacionado a uma demonstração limpa

## As três capturas

| Arquivo | Tela | Estado necessário |
|---|---|---|
| `ext-13-facebook-autorizar.png` | Autorização do Facebook | A tela de "continuar como…" com a lista de permissões |
| `ext-14-selecionar-pagina.png` | Seletor de página vinculada | A lista de escolha de página, de preferência com mais de uma opção, para que a instrução de escolher a certa faça sentido |
| `ext-15-confirmar-permissoes.png` | Confirmação de permissões | A lista final de acessos concedidos, com a permissão de publicação visível e o botão de confirmar |

`ext-15` é a mais importante do conjunto. A permissão de publicação é a causa mais comum
de falha de agendamento, e o artigo pede em texto que o leitor a confirme nessa tela.

Este fluxo só aparece durante uma conexão real, e a tela de consentimento não volta sem
desconectar antes. Se tiver uma página de teste, conectá-la é o caminho mais seguro.

## Quando os arquivos estiverem no lugar

Me avise. Eu rodo:

    node --env-file=.env.kb-upload.local scripts/upload-kb-images.mjs como-agendar-seu-primeiro-post

e preencho os três slots `NULL` da etapa 3 na migration.

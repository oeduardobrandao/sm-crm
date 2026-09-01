# Milestone 0: generic template em private reply (staging)

Objetivo: provar que a Meta aceita `template_type: "generic"` numa private
reply de comentário, antes de qualquer UI. Precedente: com botões, a doc
omitia o requisito de escopo e só o teste real revelou (2026-08-15).

## Pré-requisitos (operador)
- Conta IG de staging com papel no app Meta e automação já funcional
  (a mesma usada na prova dos botões).
- Um comentário NOVO e real em um post dessa conta (private reply é 1 por
  comentário; comentário já respondido devolve already_replied).
- Token de acesso da conta: descriptografar via fluxo interno de staging
  (nunca colar token em chat/issue).

## Chamada
POST https://graph.instagram.com/v22.0/<IG_ID_PROFISSIONAL>/messages
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "recipient": { "comment_id": "<COMMENT_ID>" },
  "message": {
    "attachment": {
      "type": "template",
      "payload": {
        "template_type": "generic",
        "elements": [{
          "title": "Chegou! Aqui está o guia.",
          "subtitle": "Qualquer dúvida, me chama por aqui.",
          "image_url": "<URL_PUBLICA_DE_IMAGEM_JPEG>",
          "buttons": [{ "type": "web_url", "url": "https://mesaas.com.br", "title": "Abrir" }]
        }]
      }
    }
  }
}

Versão da Graph API confirmada em `supabase/functions/_shared/instagram-graph.ts`:
a constante `GRAPH_VERSION` é usada nesse mesmo arquivo para montar
`GRAPH_BASE`, que por sua vez é importada e consumida em
`supabase/functions/_shared/instagram-messaging.ts`. Valor atual: `v22.0`. O
placeholder original desta task citava v23.0; o valor real no código é v22.0
e é o que a chamada acima usa.

## Variações a testar (cada uma exige comentário novo)
1. Cartão completo (acima): imagem + título + subtítulo + botão, `image_url`
   pública.
2. Sem `buttons`: cópia exata da variação 1, removendo apenas o campo
   `buttons` (imagem + título + subtítulo, `image_url` pública).
3. `image_url` de presigned GET do R2 de staging: cópia exata da variação 2
   (sem `buttons`), trocando apenas `image_url` para a URL assinada. Isola se
   a URL presigned é a causa de uma eventual rejeição, sem misturar com o
   botão.
4. Cartão completo com `image_url` presigned: cópia exata da variação 1
   (com `buttons`), trocando apenas `image_url` para a URL assinada. Só
   roda depois de 1, 2 e 3 confirmarem cada peça isoladamente.

Para as variações 3 e 4: gere a URL presigned imediatamente antes do POST (o
signer compartilhado emite GET presigned com validade de 1 hora) e registre
no resultado o horário de geração, o horário do envio do POST e o horário de
expiração calculado. Uma URL expirada durante o teste produz falso negativo
atribuído à Meta.

## Resultado (preencher)

Para cada variação (1 a 4), registrar:
- Status HTTP da resposta do POST.
- Corpo de resposta sanitizado: `message_id` em caso de sucesso, ou o erro
  Graph completo (`code`, `subcode`, `message`) em caso de falha. Nunca
  registrar o token de acesso usado.
- Horário do envio (e, para variações 3 e 4, horário de geração da URL
  presigned e horário de expiração calculado).
- Variante de `image_url` usada (pública ou presigned).
- Resultado visual por plataforma: renderizou como cartão no iOS? No
  Android? Na web, se testado?

| Variação | Status HTTP | message_id / erro (code/subcode) | Horário envio | URL: pública/presigned (expira às) | iOS | Android | Web |
|---|---|---|---|---|---|---|---|
| 1 (completo) | 200 | message_id recebido | 2026-09-01T12:09:27Z | pública | cartão OK | - | - |
| 2 (sem buttons) | 200 | message_id recebido | 2026-09-01T12:09:29Z | pública | cartão OK | - | - |
| 3 (sem buttons, URL presigned) | 200 | message_id recebido | 2026-09-01T12:09:30Z | presigned (gerada 12:09:30Z, expira 13:09:30Z) | cartão OK | - | - |
| 4 (completo, URL presigned) | 200 | message_id recebido | 2026-09-01T12:09:31Z | presigned (gerada 12:09:31Z, expira 13:09:31Z) | cartão OK | - | - |

Execução: 2026-09-01, conta mesaas.com.br (staging), post DbD26OckbXX, via
function descartável milestone0-card-proof (action auto). As QUATRO variações
aceitas pela Graph (200 + message_id), incluindo image_url presigned gerada
imediatamente antes do POST. GATE DE API: PASSOU. Confirmação visual (iOS, 2026-09-01): as 4 DMs
renderizaram como cartão com imagem carregada, nas duas formas esperadas
(sem botão nas variações 2/3; com botão Abrir nas 1/4) -- inclusive as de
image_url presigned. GATE COMPLETO: PASSOU. Android/web não testados
(não bloqueante).

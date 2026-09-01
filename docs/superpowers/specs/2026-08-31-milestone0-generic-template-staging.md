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

Versão da Graph API confirmada em `supabase/functions/_shared/instagram-graph.ts`
(constante `GRAPH_VERSION`, consumida por `GRAPH_BASE` em
`_shared/instagram-messaging.ts`): `v22.0`. O placeholder original desta task
citava v23.0; o valor real no código é v22.0 e é o que a chamada acima usa.

## Variações a testar (cada uma exige comentário novo)
1. Cartão completo (acima).
2. Sem `buttons` (imagem + título + subtítulo apenas).
3. `image_url` de presigned GET do R2 de staging (não só URL pública),
   para provar que a Meta baixa de URL assinada com query string.

## Resultado (preencher)
- [ ] 1 aceito? Renderizou no app iOS/Android como cartão?
- [ ] 2 aceito?
- [ ] 3 aceito?
- Códigos de erro observados (se houver):

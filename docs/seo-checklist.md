<!-- docs/seo-checklist.md -->
# SEO/GEO — ações pós-deploy (humanas)

Itens que o código não resolve sozinho. Marcar conforme concluído.

## Imediato (bloqueia o resultado do trabalho técnico)
- [ ] **Google Search Console**: verificar a propriedade do domínio `mesaas.com.br`
      (verificação por DNS cobre www e apex) e submeter `https://www.mesaas.com.br/sitemap.xml`.
- [ ] **Redirecionamento de domínio**: confirmar no painel da Vercel que `mesaas.com.br`
      redireciona (308) para `https://www.mesaas.com.br` — o canonical de todo o site aponta para www.
- [ ] **Confirmar o 404 real em produção**: `curl -sI https://www.mesaas.com.br/url-que-nao-existe`
      deve responder `404` (não `200`).
- [x] **Perfis sociais**: `SOCIAL_PROFILES` preenchido com o Instagram
      (`instagram.com/mesaas.com.br`). Adicionar LinkedIn etc. quando existirem.
- [ ] **E-mails de contato**: confirmar que `contato@mesaas.com.br` e `privacidade@mesaas.com.br`
      (usados em /sobre, Termos e LGPD) existem e são monitorados.
- [ ] Após o deploy, pedir indexação das 10 URLs principais no Search Console.
- [ ] **Headers noindex em produção**: `curl -sI https://www.mesaas.com.br/dashboard | grep -i x-robots-tag`
      e o mesmo para uma URL real de hub (`/<workspace>/hub/<token>`) devem retornar `noindex, nofollow`.

## Próximas 2–4 semanas
- [ ] Cruzar impressões do Search Console com o mapa de keywords (análise de 24/07/2026)
      para priorizar as próximas páginas.
- [ ] Validar rich results (FAQ, Organization) em https://search.google.com/test/rich-results.
- [ ] Testar OG/Twitter cards em https://www.opengraph.xyz ou no validador do LinkedIn.
- [ ] Conferir no relatório de indexação do GSC que /dashboard, /login e afins aparecem
      como "Excluída por noindex" (e não indexadas).

## Fases seguintes (planos futuros — ver seção "Out of scope" do plano)
- Fase 1b: páginas /briefing-de-cliente, /agendamento-instagram,
  /relatorio-mensal-instagram, /crm-para-social-media (infra pronta — 1 content module + 1 rota cada).
- Fase 2: blog em markdown prerenderizado + comparativos ("Mesaas vs Aprova Post",
  "alternativa ao Doo Studio", "migração da Etus", comparativo de plataformas de aprovação).
- Fase 3: conteúdo de autoridade IA/MCP (documentar o agente, casos reais).
- Fase 4: ativo proprietário (calculadora de precificação de social media / benchmark de engajamento).

## Blog (fase 2)

### Antes do merge — trava, não conselho
- [ ] **Rewrite parametrizado no preview da Vercel.** É a única coisa desta fase que não dá
      para provar localmente: `/blog/:slug` → `/blog/:slug.html` depende da interpolação da
      Vercel. Na URL do preview do PR:
      ```
      curl -sI https://<preview>.vercel.app/blog | head -3
      curl -sI https://<preview>.vercel.app/blog/mesaas-vs-aprova-post | head -3
      curl -s  https://<preview>.vercel.app/blog/mesaas-vs-aprova-post | grep -o '<title>[^<]*</title>'
      curl -sI https://<preview>.vercel.app/blog/nao-existe | head -3
      curl -sI https://<preview>.vercel.app/og/blog/mesaas-vs-aprova-post.png | head -3
      ```
      Esperado: `200` no índice e no artigo, o `<title>` do próprio artigo, **`404`** no slug
      inexistente, e `200` + `image/png` na imagem.
      **Se o `:slug` não interpolar:** troque por um rewrite explícito por artigo e estenda o
      teste-guarda para exigir um por `.md`. Não mergeie com `/blog/<slug>` quebrado — artigo
      que dá 404 em produção é pior que artigo nenhum.

### Depois do deploy
- [ ] Pedir indexação de `/blog` e dos 6 artigos no Search Console.
- [ ] Validar um artigo em https://search.google.com/test/rich-results — deve reconhecer
      `BlogPosting` e `BreadcrumbList`.
- [ ] Testar o card de compartilhamento de um artigo no WhatsApp: a imagem vem de
      `/og/blog/<slug>.png`, e é a primeira vez que esses arquivos existem em produção.
- [ ] Conferir que `/blog` e os artigos **não** aparecem como "Excluída por noindex" no GSC.

### Em 30 dias
- [ ] Cruzar as impressões dos 6 artigos no GSC com o mapa de keywords para decidir a próxima
      leva: fase 1b (as 4 páginas de funil restantes) ou fase 3 (autoridade IA/MCP).
- [ ] Os 3 comparativos citam concorrentes com dados verificados em julho de 2026. Reconferir
      antes de considerar o conteúdo estável — site de concorrente muda sem avisar.

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
- [ ] **Perfis sociais**: preencher `SOCIAL_PROFILES` em `apps/crm/src/content/site-meta.ts`
      com as URLs reais (Instagram, LinkedIn, …) para o `sameAs` do schema Organization.
- [ ] **E-mails de contato**: confirmar que `contato@mesaas.com.br` e `privacidade@mesaas.com.br`
      (usados em /sobre, Termos e LGPD) existem e são monitorados.
- [ ] Após o deploy, pedir indexação das 10 URLs principais no Search Console.

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

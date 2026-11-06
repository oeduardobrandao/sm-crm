# Sign in with ChatGPT: application draft

Form: https://openai.com/form/sign-in-with-chatgpt-interest/ (fields could not be read from here; the
answers below cover what such forms usually ask, adapt them to the real fields).
Docs: https://developers.openai.com/siwc

## Company

- **Name:** Mesaas
- **Website:** https://mesaas.com.br
- **Country:** Brazil
- **Contact:** Eduardo Brandão, founder, [CONTACT EMAIL]
- **What we do:** SaaS CRM for social media agencies and freelance social media managers in Brazil:
  clients, editorial calendar, post approvals with the end client, Instagram/TikTok publishing and
  analytics, briefings and content strategy, finance.
- **Stage / size:** [PAYING WORKSPACES] paying workspaces, [MONTHLY ACTIVE USERS] monthly active users.

## What we want to build

Two integrations, both for ChatGPT Plus and Pro subscribers:

1. **"Use seu plano do ChatGPT" inside Mesaas** (scope `resource.invoke` / `chatgpt.tokens.use.direct`).
   An assistant panel in the CRM that writes captions, carousel copy and reels scripts in each client's
   voice. It reads the client's briefing, content strategy and best-performing posts, and saves the
   result as a draft post the agency reviews. Text only through the Responses API with function tools.
   Every write needs an explicit click from the user, and nothing is published automatically. Our users
   are social media professionals who already pay for ChatGPT. Almost none have an API key, so today
   they copy and paste between ChatGPT and Mesaas all day.
2. **"Continuar com o ChatGPT" for the Mesaas app in ChatGPT.** We already run a remote MCP server with
   OAuth (≈45 tools: clients, posts, tasks, approvals) and are adding MCP Apps cards (carousel preview,
   caption options, save as draft). We would like Sign in with ChatGPT to make connecting the app
   one click.

## Why it matters to users

- Content production is the core daily job of our users; ChatGPT is already their writing tool.
- Using their own plan means no API key, no extra bill, and the usage limits they already manage at
  chatgpt.com/settings/usage.

## Responsible use

- Usage controls: we will show "Usar seu plano do ChatGPT" only where eligible, link to "Gerenciar uso",
  and handle `subscription_sharing_usage_limit_exceeded` / `subscription_sharing_usage_unavailable`
  with clear messages.
- Tokens are stored encrypted at rest (AES-256-GCM), used only server-side, never shown to the browser
  after connection, revocable by the user at any time.
- Data scope: each request carries only the data of the workspace and client the user is working on,
  limited by the user's role in Mesaas.
- No automated publishing: the model drafts, people approve.

## Expected volume

[ESTIMATE: e.g. N users in the first 3 months, average M generations per user per day]

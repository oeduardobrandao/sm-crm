# App Store submission: Mesaas for iOS

Everything App Store Connect asks for, ready to paste. Copy fields are pt-BR (primary
language). Keep them free of prices, plans, trials and "assine": App Review rejects metadata
that points to purchases outside the app (3.1.1), and the app itself never mentions them (D33).

## App information

| Field            | Value                             |
| ---------------- | --------------------------------- |
| Name             | Mesaas                            |
| Subtitle (30)    | Gestão para social media          |
| Bundle ID        | br.com.mesaas.app                 |
| Primary language | Portuguese (Brazil)               |
| Category         | Business. Secondary: Productivity |
| Content rights   | No third-party content            |
| Price            | Free (no in-app purchases)        |
| Devices          | iPhone and iPad                   |
| Copyright        | 2026 EBS IT SOLUTIONS LTDA        |

## URLs

| Field              | URL                                               |
| ------------------ | ------------------------------------------------- |
| Support URL        | https://www.mesaas.com.br/ajuda                   |
| Marketing URL      | https://www.mesaas.com.br                         |
| Privacy Policy URL | https://www.mesaas.com.br/politica-de-privacidade |

## Version 1.0 text

**Promotional text (170):**

> Clientes, posts, aprovações e relatórios da sua agência no bolso. Receba um aviso no
> celular quando o cliente aprovar, pedir ajuste ou mandar mensagem.

**Description:**

> O Mesaas é o sistema de gestão da sua agência de social media. Com o app, a equipe acompanha
> o trabalho de qualquer lugar e responde aos clientes na hora.
>
> CLIENTES E ENTREGAS
> Veja cada cliente, os fluxos de produção e em que etapa está cada post. Mova posts entre
> etapas, comente e anexe fotos e vídeos direto da câmera ou da galeria.
>
> CALENDÁRIO EDITORIAL
> Planeje e agende publicações do Instagram e do TikTok pela API oficial, com legenda, mídia e
> data em um só lugar.
>
> APROVAÇÃO DO CLIENTE
> Seus clientes aprovam posts, pedem ajustes e enviam ideias e referências pelo Hub. Você
> recebe tudo no app, com notificação.
>
> AGENDA E EQUIPE
> Reuniões, gravações e prazos em uma agenda compartilhada, com chat da equipe e menções.
>
> RELATÓRIOS
> Métricas do Instagram e do TikTok por cliente e relatórios prontos para enviar.
>
> NOTIFICAÇÕES
> Aprovações, pedidos de ajuste, mensagens de clientes, tarefas atribuídas e prazos chegando,
> no seu iPhone.
>
> O app é para equipes que já usam o Mesaas. Entre com o mesmo e-mail e senha da sua conta.

**Keywords (100):**

```
social media,agência,crm,instagram,tiktok,calendário editorial,aprovação,posts,clientes,relatório
```

**What's New:** leave empty for 1.0.

## App Privacy (data collection)

Tracking: **No**. The app loads no ad tags (Meta Pixel and Google Ads are off inside the app,
see `googleAdsLoader.ts` / `metaPixelLoader.ts`), and no data is shared with data brokers.

Answer "Yes, we collect data", then declare these. None is used for tracking.

| Apple data type                  | Why (Apple purpose)                 | Linked to the user | Source                                       |
| -------------------------------- | ----------------------------------- | ------------------ | -------------------------------------------- |
| Contact Info: Name               | App Functionality                   | Yes                | Profile, team members                        |
| Contact Info: Email Address      | App Functionality, Customer Support | Yes                | Login, Crisp support chat                    |
| Contact Info: Phone Number       | App Functionality                   | Yes                | Profile, client records                      |
| User Content: Photos or Videos   | App Functionality                   | Yes                | Post media, attachments                      |
| User Content: Customer Support   | Customer Support                    | Yes                | Crisp chat (only with the "Suporte" consent) |
| User Content: Other User Content | App Functionality                   | Yes                | Posts, captions, comments, chat, agenda      |
| Identifiers: User ID             | App Functionality, Analytics        | Yes                | Supabase user id, PostHog identify           |
| Usage Data: Product Interaction  | Analytics                           | Yes                | PostHog (only with the "Análise" consent)    |
| Diagnostics: Crash Data          | App Functionality                   | No                 | Sentry                                       |
| Diagnostics: Performance Data    | App Functionality                   | No                 | Sentry                                       |

Not collected in the app: location, contacts, browsing history, health, financial or payment
info (billing happens only on the website), purchases, sensitive info.

## Age rating

Answer "None" to every content question and "No" to unrestricted web access (the web view only
loads mesaas.com.br). Messaging between users exists but is limited to the agency's own team
and clients. Expected result: 4+.

## Export compliance

Already answered in the build (`ITSAppUsesNonExemptEncryption = false`): HTTPS only.

## App Review information

**Sign-in required:** yes. Use the demo account below (a workspace created in Admin > Criar conta
demo, seeded with sample data). Put the password only in App Store Connect, never in this file.

| Field     | Value                              |
| --------- | ---------------------------------- |
| User name | (demo account e-mail)              |
| Password  | (set in App Store Connect)         |
| Contact   | Eduardo Brandão, (phone), (e-mail) |

**Notes (paste in English):**

> Mesaas is a business tool (CRM) for social media agencies. Agencies sign up and manage their
> subscription on our website; the iOS app is a companion for team members who already have an
> account, so there is no sign-up, purchase or subscription flow in the app, and the app does
> not link to one (guideline 3.1.3(c), services sold to organizations for their staff). The demo
> account above belongs to a sample agency with example clients, posts and events.
>
> Native features: push notifications (client approvals, change requests, client messages,
> assigned tasks, deadlines), photo and video upload from the camera or library, session stored
> in the iOS Keychain, and a phone-specific interface with a bottom tab bar.
>
> To see a notification: sign in, allow notifications, then lock the device. Notifications
> arrive when a client acts in the client portal, so on a demo account the list under the bell
> icon shows earlier examples.
>
> Account deletion: accounts are created on the website by the agency owner, who can request
> deletion of the whole account at privacidade@mesaas.com.br, as described in our privacy policy
> (data is deleted within 30 days after the account is closed).

## Screenshots

Required sizes (portrait, PNG, no alpha):

| Display     | Simulator             | Pixels      |
| ----------- | --------------------- | ----------- |
| iPhone 6.9" | iPhone 18 Pro Max     | 1320 x 2868 |
| iPad 13"    | iPad Pro 13-inch (M5) | 2064 x 2752 |

Captured from the demo account so no real client data shows. Suggested set, in order:
Entregas (fluxos e etapas), Calendário editorial, post aberto, Agenda, notificações, Relatórios.

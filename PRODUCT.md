# Mesaas — Product context

## Register

**Product.** Design serves the work. Mesaas is an authenticated CRM that social media managers sit inside all day: kanban boards, calendars, post editors, approval threads, billing. Nothing here is a marketing surface. The Hub (`apps/hub/`) is client-facing but still a task surface (review, approve, comment), not a landing page.

The one exception is `apps/crm/src/pages/landing/`, which is a brand surface and should be treated as such if it is ever worked on.

## Who uses it

Brazilian social media managers and small agencies, mostly running 5–15 client accounts at once. They live in the tool during working hours, on desktop, with many browser tabs open. The recurring failure they are escaping is content scattered across WhatsApp, Drive, Notion and Meta Business Suite, with approvals lost in DMs.

Secondary user: the **client** (a doctor, a clinic, a small business owner) who enters only the Hub through a tokenless link, to approve posts and leave feedback. Lower frequency, lower tolerance for complexity, often on a phone.

## What it does

Runs the production line for a client's content: workflows with staged etapas, posts moving from draft to internal review to client approval to scheduled to published, plus the surrounding CRM (clients, contracts, finance, team) and Instagram/TikTok publishing.

## Language

**All user-facing copy is Portuguese (pt-BR).** No English strings in the UI, ever. Code, comments and commits are English.

## Brand personality

Calm and competent. The product's pitch is that the chaos stops here, so the interface cannot itself feel chaotic. Warm rather than corporate (the brand yellow, the rounded surfaces), but the warmth lives in accent and tone, never in decoration that competes with the data.

## Anti-references

- Dense enterprise CRMs (Salesforce, Dynamics): grey, dead, and hostile.
- Over-animated SaaS marketing dashboards: motion on a task surface is noise.
- Trello-flat colour blocks used as the primary information channel: colour should reinforce a written label, never replace it.

## Strategic design principles

1. **Colour reinforces, never replaces.** Every colour-encoded distinction also carries a written label or an icon. Roughly 8% of the male user base cannot separate the red/green end of the palette, and the tipo palette leans on exactly that pair.
2. **Density where the user is scanning, air where they are deciding.** Calendars and boards can be dense. Editors and approval flows get room.
3. **Ownership must be legible.** The product shows a client's whole schedule across workflows; at any moment the user must be able to tell what is theirs to move and what belongs to someone else's plan, without clicking.
4. **The tool disappears into the task.** Familiar affordances beat invented ones. Standard drag-and-drop, standard date pickers, standard form controls.

## Accessibility baseline

Body text ≥4.5:1, large/bold ≥3:1. Keyboard paths for every drag interaction (the calendar's drag handle doubles as the keyboard activator). No colour-only encoding, per principle 1.

## Existing visual system

See `DESIGN_SYSTEM.md` for the committed tokens: brand yellow `#eab308`, surface/ink ramps for light and dark, DM Sans / Playfair Display / DM Mono, and the tipo palette (`feed #eab308`, `reels #E1306C`, `stories #42c8f5`, `carrossel #3ecf8e`) which is now canonical in `apps/crm/src/pages/entregas/postLabels.ts`.

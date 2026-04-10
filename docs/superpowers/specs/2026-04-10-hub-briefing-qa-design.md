---
title: Hub Briefing Q&A System
date: 2026-04-10
status: approved
---

## Overview

Replace the existing Briefing tab (which read cliente profile fields) with a Q&A system: the agency creates a list of questions in the CRM, and the client answers them in the hub. Both sides can view the complete Q&A.

## Motivation

The previous Briefing design showed duplicated information (nome, email, etc.) that the agency already has. The real need is a structured way to collect client input on open-ended questions — a discovery questionnaire that the client fills in through their hub link.

## Data Model

New table `hub_briefing_questions` (added via migration):

```sql
CREATE TABLE hub_briefing_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- `question` — written by the agency (CRM)
- `answer` — written by the client (hub); nullable until answered
- Only one answer per question (no versioning)
- Ordering controlled by `display_order`

## Architecture

### CRM side (`apps/crm/`)

**BriefingEditor** — new component inside `HubTab.tsx` replacing the placeholder:
- Lists all questions for the client (fetched via React Query from Supabase directly)
- Agency can: add a new question, edit question text, delete a question (even if answered)
- Shows client's answer inline (read-only on CRM side)
- Inline editing: clicking a question row enters edit mode for that question's text

Store functions added to `apps/crm/src/store.ts`:
- `getHubBriefingQuestions(clienteId)` — SELECT from hub_briefing_questions ORDER BY display_order
- `addHubBriefingQuestion(clienteId, contaId, question)` — INSERT
- `updateHubBriefingQuestion(id, question)` — UPDATE question text only
- `deleteHubBriefingQuestion(id)` — DELETE

### Hub side (`apps/hub/`)

**BriefingPage** — replace current clientes-fields display with Q&A interface:
- Lists questions with answer field below each question
- Each answer is an editable textarea; Save button per question (or a single Save All)
- Empty answer shows placeholder "Digite sua resposta..."
- Already-answered questions show the answer in the textarea (pre-filled)

Edge function changes (`supabase/functions/hub-briefing/`):
- `GET ?token=` — returns `{ questions: Array<{ id, question, answer, display_order }> }` (replaces current briefing response)
- `POST` body `{ token, question_id, answer }` — upserts the answer for that question (validates token, checks cliente_id matches)

Hub API changes (`apps/hub/src/api.ts`):
- `fetchBriefing(token)` — already exists, update return type to `{ questions: BriefingQuestion[] }`
- `submitBriefingAnswer(token, question_id, answer)` — new POST call

Hub types (`apps/hub/src/types.ts`):
- Replace `ClientBriefing` with `BriefingQuestion { id: string; question: string; answer: string | null; display_order: number }`

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20260410_hub_briefing_questions.sql` | New table |
| `apps/crm/src/store.ts` | 4 new functions |
| `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` | Replace Briefing placeholder with BriefingEditor |
| `supabase/functions/hub-briefing/index.ts` | GET returns questions; add POST for answers |
| `apps/hub/src/types.ts` | Replace ClientBriefing with BriefingQuestion |
| `apps/hub/src/api.ts` | Update fetchBriefing type, add submitBriefingAnswer |
| `apps/hub/src/pages/BriefingPage.tsx` | Rewrite to show Q&A interface |

## Out of Scope

- No real-time updates (polling/subscriptions)
- No question reordering UI (display_order set on insert, sequential)
- No file attachments to answers
- No notifications when client answers

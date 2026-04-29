# Preserve Follower History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Instagram follower history when a client disconnects and reconnects their account.

**Architecture:** Change the disconnect endpoint from a hard-delete (delete account row + cascade) to a soft-disconnect (clear token, keep row + follower history). The reconnect flow already upserts on `client_id`, so it reuses the existing row and UUID — no changes needed there.

**Tech Stack:** Deno edge function (Supabase), i18n JSON files

---

### Task 1: Soft-disconnect edge function endpoint

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts:619-625`

- [ ] **Step 1: Replace the hard-delete disconnect logic with a soft-disconnect**

Replace lines 619-625 in the disconnect handler. The old code deletes posts, follower history, and the account row. The new code deletes only posts, then updates the account row to clear credentials.

Old code (lines 619-625):
```typescript
         // Get account id first to clean up child tables
         const { data: account } = await serviceClient.from('instagram_accounts').select('id').eq('client_id', clientId).single();
         if (account) {
           await serviceClient.from('instagram_posts').delete().eq('instagram_account_id', account.id);
           await serviceClient.from('instagram_follower_history').delete().eq('instagram_account_id', account.id);
           await serviceClient.from('instagram_accounts').delete().eq('id', account.id);
         }
```

New code:
```typescript
         const { data: account } = await serviceClient.from('instagram_accounts').select('id').eq('client_id', clientId).single();
         if (account) {
           await serviceClient.from('instagram_posts').delete().eq('instagram_account_id', account.id);
           await serviceClient.from('instagram_accounts').update({
             encrypted_access_token: null,
             token_expires_at: null,
             authorization_status: 'disconnected',
             last_synced_at: null,
           }).eq('id', account.id);
         }
```

- [ ] **Step 2: Verify the edge function has no syntax errors**

Run: `deno check supabase/functions/instagram-integration/index.ts`

If `deno check` is not available or fails due to missing Supabase types, open the file and visually confirm the edit is syntactically correct (matching braces, no dangling commas).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/instagram-integration/index.ts
git commit -m "fix: soft-disconnect Instagram to preserve follower history"
```

---

### Task 2: Update disconnect warning text in i18n

**Files:**
- Modify: `packages/i18n/locales/en/clients.json:64`
- Modify: `packages/i18n/locales/pt/clients.json:64`

- [ ] **Step 1: Update the English disconnect warning**

In `packages/i18n/locales/en/clients.json`, change line 64:

Old:
```json
    "disconnectWarning": "Historical data will be removed and syncing will stop.",
```

New:
```json
    "disconnectWarning": "Posts will be removed and syncing will stop. Follower history will be preserved.",
```

- [ ] **Step 2: Update the Portuguese disconnect warning**

In `packages/i18n/locales/pt/clients.json`, change line 64:

Old:
```json
    "disconnectWarning": "Os dados históricos serão removidos e a sincronização será interrompida.",
```

New:
```json
    "disconnectWarning": "As postagens serão removidas e a sincronização será interrompida. O histórico de seguidores será preservado.",
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`

Expected: Build succeeds with no type errors (i18n JSON changes don't affect types, but confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add packages/i18n/locales/en/clients.json packages/i18n/locales/pt/clients.json
git commit -m "fix(i18n): update disconnect warning to reflect preserved follower history"
```

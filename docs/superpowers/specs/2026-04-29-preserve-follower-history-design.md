# Preserve Instagram Follower History Across Disconnect/Reconnect

## Problem

When a client disconnects their Instagram account and reconnects, all follower history is permanently deleted. The current disconnect flow deletes the `instagram_accounts` row, which cascades to `instagram_follower_history`. On reconnect, a new account UUID is generated, so history starts from scratch.

## Solution: Soft-Disconnect

Change the disconnect flow to clear credentials instead of deleting the account row. Follower history stays linked to the same account UUID.

## Changes

### 1. Edge function disconnect endpoint

**File:** `supabase/functions/instagram-integration/index.ts` (lines 619-625)

Current behavior:
- Deletes `instagram_posts`
- Deletes `instagram_follower_history`
- Deletes `instagram_accounts` row

New behavior:
- Deletes `instagram_posts` (posts are re-fetched on reconnect)
- Updates `instagram_accounts` row:
  - `encrypted_access_token` → `null`
  - `token_expires_at` → `null`
  - `authorization_status` → `'disconnected'`
  - `last_synced_at` → `null`
- **Does not touch** `instagram_follower_history`

### 2. UI disconnect warning text

**File:** i18n translation files (both `en` and `pt-BR`)

Update the `disconnectWarning` and `disconnectConfirm` strings to reflect that only post data is removed, not follower history.

### 3. No migration needed

- `encrypted_access_token` and `token_expires_at` are already nullable
- `authorization_status` already supports the `'disconnected'` value
- No schema changes required

### What stays the same

- **Reconnect (OAuth callback):** The upsert on `client_id` conflict reuses the existing row, preserving the account UUID and its linked follower history
- **Summary endpoint:** Already reads account + history by account ID — works unchanged
- **Sync cron:** Already skips accounts with expired/missing tokens — null token is handled
- **Follower history FK:** Stays intact since the account row is never deleted

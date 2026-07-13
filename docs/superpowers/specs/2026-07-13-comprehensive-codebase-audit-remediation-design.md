# Comprehensive Codebase Audit Remediation Design

**Date:** 2026-07-13  
**Branch:** `codex/comprehensive-codebase-audit`  
**Status:** Approved for implementation planning

## Context

Mesaas CRM is a React 19 and Supabase monorepo with three Vite applications: the internal CRM, the client-facing Hub, and the platform Admin. Vercel hosts the static applications, Supabase provides Auth, Postgres, RLS, and Deno Edge Functions, and Cloudflare R2 plus a Worker deliver media.

The audit prioritizes a short set of Critical and High findings, plus Medium fixes that are low-risk and directly adjacent. The branch must remain reviewable, use regression tests, and avoid broad infrastructure changes.

The baseline is green:

- CRM, Hub, and Admin production builds pass.
- The frontend Vitest suite passes, with existing DOM and accessibility warnings identified by this audit.
- The Deno Edge Function suite passes: 754 tests.
- The media-proxy suite passes: 5 tests.

## Goals

1. Close the tenant-authorization path that trusts user-editable Auth metadata.
2. Stop returning unexpected internal error details to interactive clients.
3. Sanitize externally sourced navigation URLs and isolate new windows.
4. Update production dependencies with known High advisories.
5. Make image delivery truthful and improve cache reuse and small-preview loading without assuming unavailable Cloudflare image transformation services.
6. Reduce the initial Hub and Admin bundles through route-level code splitting.
7. Fix confirmed invalid DOM, nested navigation, dialog accessibility, and Auth profile-loading races.
8. Preserve existing behavior with focused regression tests and complete build/test verification.

## Non-goals

- Deploying migrations, Edge Functions, Workers, or Vercel builds.
- Adding Cloudflare Images or Image Resizing bindings.
- Backfilling media or generating a complete responsive WebP/AVIF variant set.
- Designing and enforcing a production Content Security Policy.
- Refactoring the duplicated inline-image editor or deleting large apparently unused modules.
- Rewriting the stale README or root build configuration.
- Fixing cron-only error payloads unless a change is mechanical and demonstrably risk-free.

## 1. Invitation and Tenant Authorization

### Problem

`handle_new_user_workspace` currently reads `conta_id` and `role` directly from `auth.users.raw_user_meta_data`. Public sign-up clients can supply that metadata. The trigger then creates or updates `profiles.active_workspace_id`, and RLS policies derive tenant access from that profile field. A caller can therefore select another workspace and role without a server-authoritative invitation.

The invitation Edge Function also creates the Auth user before it inserts the pending `invites` row, so the current ordering cannot support validation in the Auth-user trigger.

### Design

Add a forward-only migration that replaces the current trigger function:

- A sign-up without `conta_id` remains the normal owner flow and creates a new account/workspace.
- A sign-up with `conta_id` is treated as an invite flow.
- The metadata `conta_id` is only a selector. The trigger must find an unexpired `pending` invite whose normalized email and `conta_id` match.
- The profile's `conta_id`, `active_workspace_id`, and `role` come from the selected invite. The metadata role is ignored.
- A supplied `conta_id` without a valid invitation raises an exception, aborting user creation instead of falling back to an owner workspace.
- The existing repair for a missing `workspaces` row remains, but runs only after the invitation has been validated.
- `get_my_conta_id()` returns the active workspace only when a matching `workspace_members` row exists. A pending invite/profile alone therefore cannot satisfy tenant RLS before transactional acceptance.

Change `invite-user` so a new-user invitation is recorded before `inviteUserByEmail` runs. If Auth invitation creation fails, delete only the newly created pending invite before returning a generic internal error. Existing-user and resend-link paths keep their current semantics.

Change invite acceptance so the request body cannot select an email or authorization attributes:

- The Edge Function uses `user.email` from the verified JWT.
- A new transactional SQL function, executable only by `service_role`, finds the pending invitation associated with the authenticated user/profile, marks it accepted, and inserts or updates `workspace_members` from the invitation's own workspace and role.
- Repeated acceptance is idempotent.
- The profile onboarding flag is set only after membership succeeds.
- Audit logging uses the server-derived email and workspace.

### Failure behavior

- Missing or expired invitation: a specific 4xx domain response.
- Metadata workspace with no valid invitation: Auth insertion fails closed.
- Auth invite delivery failure: pending invitation cleanup is attempted and the client receives a generic 500 response.
- Duplicate acceptance: success with the existing membership preserved.

### Tests

- Reject a metadata workspace with no matching pending invite.
- Reject an expired invite.
- Ignore a metadata role that differs from the persisted invitation role.
- Ignore a body email that differs from the authenticated user's email.
- Verify invite-before-Auth ordering and cleanup after Auth failure.
- Verify acceptance creates membership from invitation data and is idempotent.

Where a local Postgres/Supabase instance is unavailable, SQL behavior will be covered by migration contract tests plus unit-tested extracted invitation orchestration. The final report will state that limitation explicitly.

### Existing-access review

The forward fix cannot prove that the metadata path has never been used. The handoff must therefore include a read-only SQL audit that lists non-owner workspace memberships and profiles for which no matching invitation history exists. The branch must not automatically delete or disable those rows because older legitimate/manual memberships may predate the invitation table. Any suspicious rows require an operator to validate and revoke them deliberately.

## 2. HTTP Errors, URL Safety, and Dependencies

### Unexpected errors

Create a small shared Edge Function helper for unexpected server failures. It logs the real error internally and returns a stable generic JSON payload with the caller's existing CORS headers.

Apply it to interactive functions exposed to CRM and Hub where database/API `error.message` currently reaches a 500 response. Explicitly handled domain errors such as quota, plan, validation, authentication, and conflict codes remain unchanged so clients can preserve their current UX. Cron-secret endpoints are outside the primary scope.

### URL safety

- Make the CRM compatibility shim re-export the canonical CRM URL sanitizer instead of carrying a second implementation.
- Give the Hub one canonical sanitizer and replace its divergent local implementations.
- Add an Admin sanitizer for externally sourced links.
- Allow only `http:` and `https:` for external navigation. Internal relative URLs remain allowed only where the caller explicitly needs them.
- Sanitize the identified Hub page blocks, brand files, Instagram permalinks, dashboard post links, CRM file links, and Admin Stripe URLs.
- Add `noopener,noreferrer` to new-window calls and preserve `rel="noopener noreferrer"` on anchors.

### Dependency remediation

Update `react-router-dom`/`react-router` and the transitive `ws` package to non-vulnerable compatible versions, updating the lockfile. Do not make unrelated major-version upgrades. Verify route behavior and all production builds after the update.

### Tests

- Reject `javascript:`, `data:`, protocol-relative hostile URLs, embedded credentials, and malformed input.
- Preserve expected HTTPS and explicitly permitted relative application paths.
- Verify unsafe rendered links resolve to the inert fallback.
- Verify unexpected Edge Function failures are generic while known domain codes remain stable.
- Run `npm audit --omit=dev` and record any remaining production advisories.

## 3. Images and Initial Loading

### Current mismatch

Both `OptimizedImage` copies append `w` and `f` query parameters and advertise responsive AVIF/WebP sources. The `fit` prop is declared but never used. The media Worker ignores all transformation parameters and always serves the original R2 object and content type. The browser still downloads the original bytes, while the edge cache is split across fake width and format keys.

### Design

- Remove the unsupported source builders and `<picture>` format declarations from both image components.
- Keep the useful behavior: intrinsic dimensions, blur placeholder, lazy/eager selection, async decoding, and explicit high priority/preload for the intended LCP media.
- Remove the unused `fit` API.
- In the media Worker, remove ignored transformation parameters from the cache key so old and new clients share the same original-object entry.
- Prefer existing `thumbnail_url` values in genuinely small contexts that currently load originals, especially carousel thumbnail strips and Instagram grid previews.
- Add lazy loading, asynchronous decoding, and stable dimensions/aspect ratios to high-fan-out raw image elements below the fold.
- Keep the first relevant above-the-fold Hub media eager/high-priority; do not mark every first item in nested or offscreen lists as priority.

### Route splitting

- Convert Hub page imports to route-level dynamic imports while keeping `HubShell` in the initial shell.
- Convert Admin pages to dynamic imports while keeping authentication/layout code in the initial shell.
- In CRM, retain existing page splitting, replace broad runtime store-barrel imports in initial layout/auth paths with direct module imports, and load the Markdown banner asynchronously.
- Avoid changing Sentry initialization in this branch because deferring it would change early-error capture semantics.

### Measurement and tests

- Test that `OptimizedImage` never emits unsupported `w`/`f` URLs.
- Test lazy versus priority attributes and preload cleanup.
- Test media Worker cache equivalence for URLs that differ only by ignored transformation parameters.
- Build CRM, Hub, and Admin and record before/after initial chunk sizes.

### Deferred definitive image pipeline

A later task should choose one of:

1. Generate persisted responsive WebP/AVIF variants at upload time with schema support and backfill.
2. Configure Cloudflare Images/Image Resizing and implement validated Worker transformations.

That task must define allowed widths/formats, fit behavior, source-size caps, cache keys, cost limits, and a migration strategy for existing media.

## 4. Correctness, Accessibility, and Safe Cleanup

### Invalid table markup

`FileContextMenu` currently inserts a `div` around every child. In list mode this places a `div` between `tbody` and `tr`. Replace the wrapper with child composition using Radix Slot or an equivalent single-element clone so the context-menu handler is attached without changing the DOM hierarchy.

### Nested links

`TodayCard` wraps the entire card in a calendar link, while its empty state renders a clients link. Restructure the card so the header/list own the calendar navigation and the empty-state clients action remains independent.

### Dialog accessibility

Add meaningful, visually hidden descriptions to the file picker and rename dialogs. Preserve the existing visible titles and controls.

### Auth profile race

Refactor `AuthProvider` so initial session discovery only establishes the user identity. A single user-dependent effect loads the profile, initializes the store role, and heals pending invitations. Each run has cancellation/staleness protection so a response from an old user cannot repopulate state after logout or account switching. `loading` remains true until the active profile attempt finishes.

### Safe cleanup

- Remove stale `portal-approve` and `portal-data` entries from `supabase/config.toml` because no corresponding functions exist.
- Remove only code made dead by this remediation, including the unsupported image source builders, the unused `fit` prop, and duplicate sanitizer bodies replaced by canonical imports.

Large cleanup candidates remain audit findings rather than branch changes: the stale README/root config, apparently unused Hub `PostCard`, and duplicated inline-image editor/service implementations.

### Tests

- Assert `tbody` has `tr` children with no intermediate wrapper and right-click behavior still works.
- Assert `TodayCard` has no nested anchors and both navigation destinations remain available.
- Assert dialogs expose descriptions.
- Assert a stale profile request cannot restore profile state after logout or user change.

## Implementation and Commit Strategy

Implementation follows test-driven development. Each behavior change starts with a focused failing test, then the smallest production change, then targeted and full verification.

Planned commit boundaries:

1. Invitation/RLS authorization and tests.
2. Interactive error and URL hardening plus dependency updates.
3. Image contract/cache fixes and bundle splitting.
4. DOM, accessibility, Auth-race, and safe-cleanup fixes.
5. Final audit documentation, if not already captured by the previous commits.

## Verification Gate

The branch is complete only when all applicable checks pass from the isolated worktree:

```bash
npm run test
npm run test:functions
npm run build
npm run build:hub
npm run build:admin
npm run lint
npm audit --omit=dev
npm test --prefix workers/media-proxy
```

The final handoff includes:

- Counts by severity and the top three recommendations.
- Detailed findings grouped by correctness, security, dead code, duplication, and performance.
- Severity, effort, exact file/line references, impact, and recommended fix for every finding.
- Before/after bundle measurements and remaining image-pipeline limitations.
- The branch diff and a suggested order of operations/deployment.

## Rollout and Operational Notes

No deployment is performed by this audit. The safe rollout order is:

1. Deploy the backward-compatible `invite-user` change that persists the pending invite before creating the Auth user.
2. Apply the database migration that validates the trigger and adds the transactional acceptance function.
3. Deploy `manage-workspace-user` so acceptance uses the new database function.
4. Deploy the static applications and then the media Worker.

Deploying the migration before the invite reordering would make new invitations fail because the trigger would not yet find a persisted invite. Staging should also run the read-only existing-access audit and verify new invite, expired invite, resend, existing-user invite, acceptance, logout/login, Hub navigation, and representative image-heavy pages before production.

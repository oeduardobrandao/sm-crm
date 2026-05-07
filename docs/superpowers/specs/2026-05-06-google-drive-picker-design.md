# Google Drive Picker for Post Media

**Date:** 2026-05-06
**Status:** Approved
**Approach:** Google Picker API (client-side only, no backend OAuth)

## Summary

Add a Google Drive picker to the post media gallery so agency team members can select images, videos, and PDFs from their own Google Drive when creating/editing posts. Uses the Google Picker API — a Google-hosted widget that handles auth inline via popup. No backend edge functions or stored refresh tokens needed.

Media is referenced, not copied to R2. The CRM stores Drive file metadata (thumbnail URL, file ID, view link) and renders thumbnails from Google's URLs.

## Google Cloud Setup

**APIs to enable:**
- Google Picker API
- Google Drive API

**OAuth 2.0 Client ID** (Web application type):
- Authorized JavaScript origins: `http://localhost:5173` (dev), production domain
- No redirect URIs needed — Picker uses implicit grant

**Env vars (Vite, client-side):**
- `VITE_GOOGLE_CLIENT_ID` — OAuth client ID
- `VITE_GOOGLE_APP_ID` — Google Cloud project number (needed by Picker)
- `VITE_GOOGLE_API_KEY` — API key restricted to Picker + Drive APIs

## Auth Flow

1. User clicks Google Drive icon in the media gallery
2. Google Identity Services (GIS) SDK requests an OAuth access token via popup
3. Token held in memory only (never persisted) — valid ~1 hour
4. Token passed to Picker widget for file browsing and metadata fetch
5. No backend involved

## Data Model

Extend existing `PostMedia` / files table with new columns:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `source` | `text` | `'upload'` | `'upload'` or `'google_drive'` |
| `google_drive_file_id` | `text` | `null` | Drive file ID |
| `google_drive_thumbnail_url` | `text` | `null` | Thumbnail URL snapshot at pick time |
| `google_drive_view_url` | `text` | `null` | `webViewLink` for opening in Drive |

**For Drive-sourced media:**
- `r2_key` stays `null`
- `original_filename`, `mime_type`, `kind`, `size_bytes` populated from Drive metadata
- `blur_data_url` not available — skip progressive blur effect

**Why extend rather than a new table:** the gallery already queries PostMedia — one table means reordering, cover selection, and deletion work without branching logic. `source` tells the UI how to render.

## Frontend Components

### Google Drive service (`apps/crm/src/services/googleDrive.ts`)

- `loadPickerSdk()` — lazily loads `https://apis.google.com/js/api.js` and `https://accounts.google.com/gsi/client` scripts
- `getAccessToken()` — requests OAuth token via GIS `tokenClient.requestAccessToken()`. Cached in memory for the session. Re-requests if expired
- `openPicker(onFilesSelected)` — creates Picker widget filtered to images, video, and PDF mime types. Grid layout with thumbnails. Returns array of selected file metadata

### PostMediaGallery integration

- Google Drive icon button added next to existing upload button
- On click: `openPicker()` handles auth popup if needed, then shows file browser
- On selection: `addDriveMedia(postId, driveFiles)` creates PostMedia records with `source: 'google_drive'`
- Gallery renders Drive media using `google_drive_thumbnail_url` instead of signed R2 URLs
- "Open in Drive" action on Drive-sourced media (opens `google_drive_view_url` in new tab)
- Delete removes the DB record only — no R2 cleanup needed

### PostMedia type update (`store/posts.ts`)

Add optional fields: `source`, `google_drive_file_id`, `google_drive_thumbnail_url`, `google_drive_view_url`. Gallery checks `source` to decide which URL to display.

## Display & Edge Cases

### Rendering by file type
- **Images:** `google_drive_thumbnail_url` as `<img>` src
- **Videos:** thumbnail with play icon overlay + "Open in Drive" to view (no inline playback)
- **PDFs:** PDF icon placeholder + filename + "Open in Drive" link

### Thumbnail expiry
- Google thumbnail URLs typically last weeks/months but aren't guaranteed permanent
- On `onError`: show fallback placeholder with filename and "Re-sync" option (requires user to re-auth and refresh URL)
- No automatic refresh for v1

### Cover image
- Drive media can be set as cover — `is_cover` flag works regardless of source
- Post cards, hub, and anywhere cover thumbnails are shown use `google_drive_thumbnail_url`

### Hub (client portal)
- Drive thumbnails are public-ish URLs, work without auth
- Expired thumbnails show fallback placeholder — acceptable for v1

## Out of Scope (v1)

- No folder browsing / Drive file manager inside CRM
- No automatic sync or watching Drive folders
- No copying files to R2
- No inline video playback for Drive videos
- No automatic thumbnail refresh

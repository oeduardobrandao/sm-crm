# Instagram Integration Specification

## Purpose
Connects Instagram business accounts via Meta OAuth, syncs profile and post data, and manages encrypted access tokens.

## Requirements

### Requirement: OAuth2 Connection
The system SHALL connect Instagram business accounts via Meta OAuth2 flow.

#### Scenario: Successful account connection
- GIVEN an authenticated user
- WHEN they complete the Meta OAuth flow
- THEN the system SHALL store the encrypted access token
- AND sync the Instagram business account data

### Requirement: Token Encryption
The system SHALL encrypt all Instagram access tokens using AES-GCM with the TOKEN_ENCRYPTION_KEY environment variable. The system SHALL NOT start if TOKEN_ENCRYPTION_KEY is missing.

### Requirement: Token Refresh
The system SHALL automatically refresh Instagram tokens via a scheduled cron job before expiration.

### Requirement: Data Sync
The system SHALL sync Instagram profile data and post-level content from the Graph API.

### Requirement: Account Disconnection
The system SHALL allow users to disconnect Instagram accounts, removing stored tokens.

### Requirement: Profile Picture Integration
The system SHALL use Instagram profile pictures as client avatars when available.

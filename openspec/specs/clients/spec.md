# Clients Management Specification

## Purpose
Full lifecycle management of client records including creation, editing, status tracking, and bulk import.

## Requirements

### Requirement: Client CRUD
The system SHALL support creating, reading, updating, and deleting client records with fields: name, email, phone, plan, monthly value, Notion page URL, payment day, and status.

#### Scenario: Create a new client
- GIVEN an authenticated user
- WHEN they submit a new client form with required fields
- THEN the system SHALL create the client record in the database
- AND display the client in the clients list

### Requirement: Client Avatars
The system SHALL display client avatars sourced from their Instagram profile picture, with a fallback to colored initials.

### Requirement: Status Filtering
The system SHALL allow filtering clients by status: Active, Paused, or Closed.

#### Scenario: Filter by active status
- GIVEN clients with mixed statuses
- WHEN the user selects the "Active" filter
- THEN the system SHALL display only clients with Active status

### Requirement: CSV Import
The system SHALL allow bulk client creation via CSV file upload.

### Requirement: Client Detail View
The system SHALL provide a detail page for each client showing their full profile, associated contracts, and portal access links.

### Requirement: Notion Integration
The system SHALL link clients to their Notion documentation pages via stored URL.

# Contracts Management Specification

## Purpose
Manages client contracts with lifecycle tracking, expiration alerts, and bulk import.

## Requirements

### Requirement: Contract CRUD
The system SHALL support creating, reading, updating, and deleting contracts with fields: title, client, start date, end date, total value, and status.

### Requirement: Contract Statuses
The system SHALL track contract statuses: Pending Signature, Active, and Closed.

### Requirement: Expiration Monitoring
The system SHALL alert users about contracts expiring within 30 days.

#### Scenario: Expiring contract alert
- GIVEN a contract with an end date within 30 days
- WHEN the user views the contracts list or dashboard
- THEN the system SHALL visually highlight the expiring contract

### Requirement: CSV Import
The system SHALL allow bulk contract creation via CSV file upload.

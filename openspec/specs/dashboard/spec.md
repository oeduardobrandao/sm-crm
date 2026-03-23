# Dashboard Specification

## Purpose
Provides an executive overview of all CRM modules with KPIs, summaries, and quick access to key data.

## Requirements

### Requirement: KPI Display
The system SHALL display key performance indicators: monthly revenue, expenses, balance, active clients, and active contracts.

#### Scenario: Dashboard load
- GIVEN an authenticated user
- WHEN the dashboard page loads
- THEN the system SHALL aggregate and display KPIs from financial, client, and contract modules

### Requirement: Multi-Section Hub
The system SHALL display sections for Leads summary, Financial overview, Instagram Analytics, Contracts status, Deliveries, Team info, and Calendar.

### Requirement: Role-Based Visibility
The system SHALL show a limited dashboard to Agent-role users, hiding administrative and financial sections.

#### Scenario: Agent views dashboard
- GIVEN a user with Agent role
- WHEN they access the dashboard
- THEN the system SHALL hide financial KPIs and admin sections

### Requirement: Calendar View
The system SHALL display a monthly calendar showing scheduled client payments and team member payments with visual income/expense indicators.

# Financial Management Specification

## Purpose
Tracks income and expenses, provides financial KPIs, projections, and bulk transaction import for agency financial oversight.

## Requirements

### Requirement: Transaction Tracking
The system SHALL support recording transactions with type (income/expense), date, description, category, amount, and status (Paid/Scheduled).

#### Scenario: Record an expense
- GIVEN an authenticated user
- WHEN they submit a new expense with category, amount, and date
- THEN the system SHALL save the transaction
- AND update financial KPIs accordingly

### Requirement: Financial KPIs
The system SHALL calculate and display: total received, pending income, pending expenses, current balance, and projected balance.

### Requirement: Transaction Categories
The system SHALL support categories: Mensalidade, Produção, Tráfego, Salário, Imposto, Ferramenta, Outro.

### Requirement: Income Projection
The system SHALL project future income based on client payment schedules and team salary schedules.

### Requirement: CSV Import
The system SHALL allow bulk transaction creation via CSV file upload.

### Requirement: Status Tracking
The system SHALL track transaction payment status and allow marking transactions as paid.

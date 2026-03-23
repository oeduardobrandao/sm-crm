# Deliveries & Workflows Specification

## Purpose
Kanban-style project management system for tracking client deliverables through configurable workflow stages.

## Requirements

### Requirement: Workflow Management
The system SHALL support creating workflows with configurable stages, linked to specific clients.

### Requirement: Workflow Statuses
The system SHALL track workflow statuses: Pending, Active, and Completed.

### Requirement: Kanban Board
The system SHALL provide a Kanban board view for visual project management across workflow stages.

#### Scenario: Move deliverable between stages
- GIVEN an active workflow with multiple stages
- WHEN the user moves a deliverable to the next stage
- THEN the system SHALL update the stage assignment
- AND reflect the change on the Kanban board

### Requirement: Workflow Templates
The system SHALL support reusable workflow templates for common project structures.

### Requirement: Stage Assignments
The system SHALL allow assigning team members to specific workflow stages.

### Requirement: Deadline Tracking
The system SHALL visually indicate approaching and overdue deadlines.

### Requirement: Workflow Duplication
The system SHALL allow duplicating existing workflows as a starting point for new ones.

### Requirement: Portal Token Generation
The system SHALL generate secure tokens for client portal access to specific workflows.

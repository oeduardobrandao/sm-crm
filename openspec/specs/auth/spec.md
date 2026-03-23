# Authentication & Authorization Specification

## Purpose
Manages user authentication, session handling, multi-role access control, and workspace user management for the CRM application.

## Requirements

### Requirement: User Authentication
The system SHALL allow users to log in with email and password via Supabase Auth.

#### Scenario: Successful login
- GIVEN a registered user with valid credentials
- WHEN the user submits email and password
- THEN the system SHALL authenticate via Supabase Auth
- AND redirect the user to the dashboard

#### Scenario: Failed login
- GIVEN invalid credentials
- WHEN the user attempts to log in
- THEN the system SHALL display an error message
- AND remain on the login page

### Requirement: User Registration
The system SHALL allow new users to register with email and password.

#### Scenario: Successful registration
- GIVEN a valid email not already registered
- WHEN the user submits registration details
- THEN the system SHALL create a new account
- AND send a confirmation email if required

### Requirement: Password Reset
The system SHALL allow users to reset their password via email.

#### Scenario: Password reset flow
- GIVEN a registered user
- WHEN the user requests a password reset
- THEN the system SHALL send a reset link to their email
- AND allow them to set a new password via the link

### Requirement: Role-Based Access Control
The system SHALL enforce three roles: Owner, Admin, and Agent, with descending privilege levels.

#### Scenario: Agent restricted access
- GIVEN a user with the Agent role
- WHEN accessing the dashboard
- THEN the system SHALL show a limited dashboard view
- AND hide administrative sections

### Requirement: Session Management
The system SHALL maintain user sessions using JWT tokens passed in the Authorization header.

#### Scenario: Session expiration
- GIVEN a user with an expired session token
- WHEN the user makes a request
- THEN the system SHALL redirect to the login page

### Requirement: Profile Management
The system SHALL allow users to update their profile (name, company, phone, WhatsApp).

### Requirement: Workspace User Management
The system SHALL allow Owners and Admins to invite, assign roles to, and remove workspace users.

#### Scenario: User invitation
- GIVEN an Owner or Admin
- WHEN they invite a new user by email
- THEN the system SHALL send an invitation
- AND track invitation status (pending, accepted, expired)

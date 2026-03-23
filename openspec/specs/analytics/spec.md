# Analytics & Reporting Specification

## Purpose
Provides Instagram analytics at portfolio and account levels, with AI-powered insights and automated report generation.

## Requirements

### Requirement: Portfolio Analytics
The system SHALL aggregate Instagram analytics across all connected accounts with KPIs: followers, reach, impressions, profile views, website clicks, engagement, and saves rate.

### Requirement: Delta Tracking
The system SHALL display metric changes (current vs. previous period) with directional indicators.

### Requirement: Chart Visualization
The system SHALL render benchmark comparison charts for engagement rates using Chart.js.

### Requirement: AI-Powered Insights
The system SHALL generate portfolio analysis insights using the Gemini API.

### Requirement: Automated Monthly Reports
The system SHALL generate monthly analytics reports via a cron job on the 1st of each month.

### Requirement: Account-Level Analytics
The system SHALL provide detailed per-account analytics views with post-level metrics (likes, comments, shares).

### Requirement: Analytics Caching
The system SHALL cache analytics data in the database for up to 6 hours to reduce API calls.

### Requirement: Workflow Analytics
The system SHALL provide analytics for delivery workflows including completion rates and performance metrics.

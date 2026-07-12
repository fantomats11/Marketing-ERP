# Marketing ERP Frontend Requirements

## Purpose

This document defines the frontend quality bar for the production Marketing ERP used by Rent A Coat, GO Mall, and future Winterra operations.

The frontend must prioritize trustworthy data, fast operational use, clear decisions, accessibility, and maintainability over decorative visual effects.

## Product Scope

The frontend will support:

- Executive Overview
- Revenue Dashboard
- Rental Analytics
- Sales Analytics
- Marketing Performance
- SEO/GSC Performance
- Paid Media Performance
- Content Calendar
- Competitor Intelligence
- KPI and Budget Management
- Product Sale Master
- Branch and Brand Mapping
- Data Reconciliation
- Integration Health
- Settings and Access Control

## Canonical Dimensions

Dashboards and tables must distinguish the following dimensions:

- `brand_id`
- `branch_id`
- `destination`
- `date_range`
- `channel`
- `campaign_id`
- `customer_type`
- `settlement_type`

`destination` means the customer's travel destination. It must not be displayed or used as a substitute for `branch_id`.

## Frontend Technology Constraints

- Next.js App Router
- TypeScript with strict mode
- Tailwind CSS
- Accessible component primitives
- TanStack Table for data-heavy tables where appropriate
- A chart library with accessible labels and tooltips
- Zod or equivalent runtime validation for API responses and form input
- Server state must use a consistent query/cache strategy
- No `any` unless explicitly justified in a code comment
- Secrets and API credentials must never be sent to Client Components

## Required UI States

Every data-driven page, chart, table, and KPI section must define:

- Loading state
- Empty state
- Error state
- Stale-data state
- Last updated timestamp
- Data source or source-status indicator where relevant
- Permission-denied state where access is restricted

The UI must not render invented, placeholder, or fabricated business figures to fill an empty view.

## Anti-AI-Slop Requirements

The frontend must not look like a generic AI-generated dashboard or marketing template.

Do not use:

- Full-screen purple, blue, or pink gradients as the primary visual treatment
- Glassmorphism or glow effects without a functional reason
- Large rounded cards for every section
- Excessive KPI cards used only to fill space
- Charts that do not answer a defined business question
- Fake or invented numbers, trends, rankings, or campaign results
- Lorem Ipsum, generic placeholder copy, or vague marketing claims
- The same three-card grid repeated across every section
- Generic dashboard mockups or decorative charts disconnected from real data
- Gradient icon boxes for every navigation item
- Heavy shadows, oversized border radii, or excessive accent colors
- Animation applied to every element
- Decorative elements that do not help the user understand data or take action
- A landing-page visual language in place of an operational business tool

The interface should use hierarchy, typography, spacing, alignment, tables, restrained color, and meaningful visual emphasis. Each visual treatment must have a reason connected to user comprehension or workflow.

## Decision-First Design Rule

Every visible element must support at least one of these questions:

1. What decision does the user need to make from this information?
2. What action should the user take next?
3. What is the authoritative data source and when was it updated?
4. What should the user do if the data is missing, delayed, or inconsistent?

If an element does not support any of these questions, remove it or move it out of the primary workflow.

## Dashboard Design Rules

- Lead with the primary business outcome and highest-signal drivers.
- Show target versus actual when a target exists.
- Keep date range, brand, branch, channel, and campaign filters consistent across related views.
- Use charts only where they communicate movement, comparison, mix, or relationship better than a table.
- Use tables for lookup, reconciliation, and operational follow-up.
- Every KPI must have a clear definition, period, unit, and denominator where applicable.
- Revenue views must distinguish rental revenue, sales revenue, fees, deposits, VAT, discounts, cash revenue, and reported revenue.
- Provide drill-down or source-record references for material business figures where technically possible.

## Accessibility and Responsive Requirements

Verify at minimum at:

- Mobile: 375px
- Tablet: 768px
- Desktop: 1440px

The frontend must:

- Support keyboard navigation
- Provide visible focus states
- Use semantic HTML and correct heading hierarchy
- Meet readable color contrast requirements
- Support `prefers-reduced-motion`
- Avoid horizontal overflow
- Avoid clipped Thai text and overflowing table content
- Provide accessible names for icon-only controls
- Preserve usable filtering and table interaction on small screens

## Review Gates

### Before implementation

- Data model and KPI definitions are approved.
- User roles and primary workflows are documented.
- Each proposed page has a decision or operational purpose.
- The Anti-AI-Slop Requirements are included in the frontend brief.

### During implementation

- Components use real domain labels and data contracts.
- Empty and error states are implemented with the feature, not afterward.
- No secret or fabricated data is added to the browser bundle.
- Repeated structures are data-driven rather than duplicated markup.

### Before UAT

- Responsive checks pass at 375px, 768px, and 1440px.
- Console errors are resolved.
- Tables, filters, charts, and permissions behave correctly.
- Numbers reconcile with the approved metric definitions.
- Source freshness and missing-data warnings are visible.
- A visual review confirms that the interface is purposeful, restrained, and not decorative AI output.

## Priority Order

```text
Data correctness
> User comprehension
> Operational speed
> Accessibility
> Maintainability
> Visual polish
```

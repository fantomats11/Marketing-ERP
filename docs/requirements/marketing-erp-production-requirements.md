# Brandname Marketing ERP — Production Requirements

## 1. Objective

Build a production Marketing ERP for GO Mall as the umbrella brand and its operating brands Rent A Coat, Winterra, and CoCoat. The system must connect operational revenue with marketing activity, support planning and team execution, and provide traceable management reporting.

The first production scope covers Rent A Coat and GO Mall. Winterra and CoCoat must be supported by the data model and can be activated later without restructuring the platform.

## 2. Business Context

### Brand architecture

- GO Mall: umbrella retail and rental brand; positioning “ครบ จบ ในที่เดียว”; increase basket size through bundles, family sets, and rent-plus-buy offers.
- Rent A Coat: winter-clothing rental with value, size confidence, warmth, cleanliness, and trip readiness as primary propositions; also sells winter accessories.
- Winterra: owned-product brand launching in August 2026; functional and fashionable winter essentials designed for Thai travellers.
- CoCoat: in-store imported merchandise label; operational product line rather than a major standalone brand-building program.

### Current channels

- Rent A Coat: website, LINE OA with developer mode, Facebook, Instagram, TikTok, Google Ads, SEO/GSC, GA4, and GBP.
- GO Mall: website, LINE OA with developer mode, Facebook, Instagram, TikTok, Google Ads, SEO/GSC, GA4, and GBP.
- Websites: `https://www.rentacoat.com` and `https://gomall.fashion`.

### Branches and location migration

The current canonical locations are:

- `rac-rama9`: Rent A Coat พระราม 9
- `gomall-rama9`: GO Mall พระราม 9
- `rac-vibhavadi`: Rent A Coat วิภาวดี

The Vibhavadi operation is planned to move to a new Phetkasem location around August 2026. The existing high-value Rent A Coat Vibhavadi GBP listing must not be renamed, moved, merged, or otherwise mutated by this system until an approved migration runbook exists. GBP integration is read-only in the first release.

## 3. Source-of-Truth Policy

- Airtable is the operational source of truth for customers, employees, rental products, transactions, transaction details, B2B, wash, and repair records.
- Rent A Coat and GO Mall use separate Airtable bases.
- `RE` identifies rental invoices and `CA` identifies sales invoices.
- A transaction can contain rental and sale components. Use `order_group_id` to reconcile related RE and CA documents without collapsing their document identities.
- Sale products require a dedicated `Sale_Product_Master` in Airtable containing SKU, category, brand, price, and lifecycle status.
- Every operational transaction must carry a canonical `branch_id`; travel `destination` must remain a separate dimension.
- FlowAccount is the accounting document source when a matching document exists. The first integration is read-only reconciliation; it must never create, edit, or cancel FlowAccount documents.
- Existing Google Sheets may be used for backfill and reconciliation, but must not silently override Airtable operational records.

## 4. Required Modules

### 4.1 Master Data and Governance

- Brand, branch, channel, account, campaign, customer, rental product, sale product, category, employee, team, competitor, source dictionary, and lost-reason masters.
- Effective-dated branch and brand mappings.
- Data ownership, validation status, source record links, and change audit history.

### 4.2 Integration Hub

- Airtable, GA4, GSC, Google Ads, GBP, Meta Graph/Marketing APIs, TikTok Business API, LINE Messaging API, FlowAccount, and approved Google Sheets backfills.
- Health status, last successful sync, cursor/checkpoint, row counts, reconciliation errors, API quota/rate-limit state, and retry history.
- Airtable target freshness: at most 15 minutes during business operation.
- Other integrations: daily unless the source supports and the business requires a shorter interval.

### 4.3 Revenue and Customer Analytics

- Rental, product sale, wash, asset sale, B2B, barter, damage fee, and late fee reporting.
- Deposits and refunds must be represented but excluded from recognized revenue.
- VAT, discounts, cash collected, recognized revenue, document totals, and refunds must be separately measurable.
- Customer acquisition, repeat customer, basket size, rent-plus-buy attachment, bundle performance, family set performance, destination, branch, and brand analysis.
- Drill-through from aggregate KPIs to canonical records and source references.

### 4.4 Campaign and Budget Management

- Annual, quarterly, monthly, campaign, brand, channel, and objective budgets.
- Planned, committed, actual, forecast, variance, burn rate, and pacing.
- Campaign brief, audience, proposition, channel plan, UTM convention, owner, approval, launch window, KPI targets, and post-campaign review.
- Read-only paid-media ingestion in MVP. Campaign creation or budget write-back to ad platforms is excluded.

### 4.5 Content Operations

- Cross-channel content calendar for website, SEO, LINE, Facebook, Instagram, TikTok, GBP, and paid media.
- Workflow: Draft → Review → Approved → Scheduled → Published → Measured → Archived.
- MVP supports planning and approval; automatic publishing is excluded.
- Content pillars, funnel stage, target brand, audience, destination, product, campaign, owner, due date, asset links, CTA, UTM, and performance fields.

### 4.6 SEO, SEM, Social, and AI Visibility

- GSC query/page/country/device performance, indexation monitoring, branded versus non-branded queries, and landing-page opportunity analysis.
- Google Ads (including Keyword Planner API standard access for search volume and CPC forecasting), Meta Ads where account access exists, and TikTok Ads spend/performance ingestion.
- GA4 acquisition, landing page, events, ecommerce/lead outcomes, and source/medium/campaign reporting.
- GBP local visibility and engagement monitoring without mutation.
- AI Mention Audit & GEO Monitoring System: Run scheduled simulation queries (e.g., "เช่าชุดกันหนาวที่ไหนดี") via OpenAI, Gemini, and Perplexity APIs. Track engine recommendations, cited brands, cited URLs, competitor mentions, and calculate an AI Share of Voice (SoV) index to inform Generative Engine Optimization (GEO) strategies.

### 4.7 Competitor Intelligence

- Maintain direct, adjacent, and aspirational competitor classifications.
- Seed competitors include mellowrentcoat, winterclothing, becloset, cocorentt, and 24dec.
- Hybrid Competitor Tracking: Combine automated signals (Meta Ad Library ad counts, SERP SEO positions) with manual competitor updates. Capture websites, branches, offers, pricing signals, product/brand assortment, content themes, search visibility, ad signals, reviews, strengths, weaknesses, evidence URL, and observation timestamp.
- Competitor discovery must produce candidates requiring human approval before entering the canonical competitor set.

### 4.8 Team KPI and Workflow

- Hybrid KPI Tracking (Performance + Activity Based):
  - Activity Metrics: Track content creation, approvals, and publishing schedules (linked to owners in `content_ideas` and `ad_plans`).
  - Performance Metrics: Track impressions, clicks, CPL, spend, and conversion outcomes from ad platforms and search consoles, mapped to responsible team members.
- KPI definitions, owner, target, actual, period, denominator, source, freshness, confidence, and status.
- Scorecards for executive, marketing lead, channel owner, content owner, and analyst roles.
- Targets must be versioned; historical KPI results must not change when a future target is edited.

### 4.9 Reconciliation and Data Quality

- Airtable-to-FlowAccount document reconciliation by document number, date, customer, subtotal, VAT, total, and payment status.
- Duplicate, missing key, invalid branch, unknown SKU, unmatched RE/CA, stale source, and amount variance queues.
- Every material KPI must expose definition, source, last refresh, and data-quality status.

### 4.10 Administration and Access

- Google Workspace SSO.
- RBAC roles: System Admin, Executive, Marketing Lead, Channel Owner, Content Contributor, Analyst, and Read Only.
- Secret access is service-only; no credential may be returned to browser clients.
- Audit trail for approvals, configuration changes, mapping overrides, and manual reconciliation decisions.

### 4.11 Omnichannel Chat and Agent Copilot

- Unified Inbox: Consolidate active chats from LINE OA, Facebook Messenger, Instagram DM, and TikTok comments/messages into a single dashboard interface.
- Customer CRM Identity Linkage: Automatically match incoming social media/chat handlers with canonical customer profiles in Airtable (using phone numbers or customer reference hash).
- Customer Context Card: Display the matched customer's rental history (`RE` records), active size attributes (boots height, pants/shirt length, colors, size), travel destination, and trip dates alongside the chat screen.
- AI Chat Copilot: Real-time LLM parsing of incoming chats to:
  - Generate draft replies for agents based on the product inventory, sizing chart, and store policies (warmth, cleanliness, trip readiness).
  - Extract and populate CRM attributes: travel destination, trip date, rental/purchase intent, pain points, and objections into `conversations` and `conversation_extractions` tables.
- Transactional Triggers: Allow agents to send size guides, booking deposit links, or invoice drafts directly from the chat interface.

### 4.12 CRM and Customer Lifecycle Management

- Unified Customer CRM Profiles: Aggregate customer data from Airtable bases, LINE OA profile metadata, and social messenger handlers into a single Customer Master Record.
- Sizing Master Tracking: Store and track historical customer size profiles, including boots height (`pa_boots-height`), bag capacity (`pa_bag-capacity`), pants length (`pa_pants-length`), shirt length (`pa_shirt-length`), colors (`pa_color`), and general size (`pa_size`) to enable frictionless future orders.
- Traveler Segments & Tagging: Segment customers by travel destination, frequency of rental, estimated basket value, and active pain points (e.g., "cold-sensitive", "family renter", "first-time traveler").
- Lead Scoring & Pipelining: Link customer profiles to the sales pipeline (`leads` and `pipeline_items` tables), tracking stages from Lead $\rightarrow$ Qualified $\rightarrow$ Reserved $\rightarrow$ Paid $\rightarrow$ Completed $\rightarrow$ Follow-up.
- Automated Retention Outreach: System triggers manual task creation or pre-approved LINE message drafts for follow-up based on trip return dates (e.g., wash feedback, review requests) and upcoming season reminders (e.g., travel anniversary reminders).

## 5. Canonical Revenue Rules

Revenue categories are `rental`, `sale`, `wash`, `asset_sale`, `b2b`, `barter`, `damage_fee`, and `late_fee`. `deposit` and `refund` are settlement types, not positive revenue categories.

Required measures:

- `gross_amount`: amount before discount and tax treatment.
- `discount_amount`: commercial discount.
- `net_before_vat`: taxable or recognized amount before VAT.
- `vat_amount`: VAT stated on the source document.
- `document_total`: final document amount.
- `cash_collected`: payments received in the period.
- `recognized_revenue`: revenue under the approved management-accounting rule.
- `deposit_amount`: refundable customer deposit; excluded from revenue.
- `refund_amount`: amount returned; reported separately and applied consistently to cash/revenue views.

## 6. Attribution Requirements

- Preserve source-platform attribution where available.
- Provide first-touch and last-touch views using normalized source, medium, campaign, content, and term dimensions.
- Store identity confidence and matching method for every cross-source customer/order link.
- Do not present attributed revenue as audited truth where identifiers are absent; label modeled or inferred results explicitly.
- Multi-touch algorithmic attribution is outside MVP.

## 7. Technology and Deployment

- Runtime: Node.js with TypeScript strict mode.
- Application: production web application with server-side authorization and an internal API.
- Operational database: Cloud SQL for PostgreSQL.
- Analytical warehouse: BigQuery.
- GCP services: Cloud Run, Cloud Scheduler, Pub/Sub, Secret Manager, Cloud Logging, Cloud Monitoring, and IAM.
- Environments: separate staging and production GCP projects/resources.
- Dashboard delivery: custom operational dashboard plus Looker Studio for flexible analysis.
- Releases: staging → pilot users → production.
- Infrastructure and deployment must be reproducible through version-controlled configuration.

## 8. Non-Functional Requirements

- Idempotent ingestion and replay-safe jobs.
- Encryption in transit and at rest using managed GCP controls.
- Least-privilege service accounts and environment-specific secret references.
- Structured logs with secret and PII redaction.
- Backup, point-in-time recovery, disaster recovery procedure, and restore test evidence.
- Monitoring and alerting for failed syncs, stale datasets, reconciliation variances, OAuth expiry, quota errors, and application errors.
- Thai and English text support; timestamps stored in UTC and displayed in Asia/Bangkok by default.
- Accessibility and responsive constraints are defined in `docs/architecture/frontend-requirements.md`.

## 9. MVP Acceptance Criteria

- Rent A Coat and GO Mall data remain separate by `brand_id` and correct by `branch_id`.
- Airtable ingestion is incremental, idempotent, observable, and can backfill records from 2023 to present.
- RE rental documents and CA sale documents remain distinguishable and can be grouped by `order_group_id`.
- Deposits do not appear as revenue; refunds and fees are reported according to the canonical rules.
- FlowAccount documents reconcile read-only and amount/status differences appear in an actionable queue.
- GSC, GA4, Google Ads, LINE, and available Meta/TikTok sources expose integration health and normalized daily metrics.
- Dashboard totals drill through to source-linked records and show freshness/data-quality status.
- Budget pacing, content approval, campaign KPI, and team KPI workflows are usable under RBAC.
- No production secret or customer PII is committed to Git, logged, or exposed to clients.
- Staging UAT passes before pilot and production promotion.

## 10. Explicit MVP Exclusions

- Writing campaigns, bids, or budgets back to ad platforms.
- Automatic social/content publishing.
- Creating or modifying FlowAccount documents.
- Mutating GBP locations or performing the Vibhavadi-to-Phetkasem migration.
- Algorithmic multi-touch attribution.
- Full Winterra and CoCoat channel activation; only model readiness is required.

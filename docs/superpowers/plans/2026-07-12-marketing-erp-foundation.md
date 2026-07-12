# Marketing ERP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the tested production foundation for a multi-brand Marketing ERP: canonical domain contracts, safe configuration, Airtable read integration, normalized transaction ingestion, and observable synchronization APIs.

**Architecture:** Keep Airtable as the operational system of record while ingesting immutable source snapshots and normalized records through focused connector/domain modules. The HTTP service exposes health and synchronization controls; later Cloud Run jobs can call the same application services. PostgreSQL and BigQuery adapters are introduced behind interfaces after domain behavior is proven in memory.

**Tech Stack:** Node.js 22+, TypeScript 5 strict mode, Fastify, Zod, Vitest, Airtable REST API, PostgreSQL, BigQuery, Google Cloud Run/Secret Manager/Pub/Sub/Scheduler.

## Global Constraints

- MVP brands are `rent-a-coat` and `go-mall`; the model must also accept `winterra` and `cocoat`.
- Airtable remains the operational source of truth.
- `RE` means rental invoice and `CA` means sale invoice.
- `destination` must never substitute for `branch_id`.
- Deposits and refunds are not positive recognized revenue.
- FlowAccount, GBP, ad-platform, and content publishing integrations are read-only in this foundation.
- Secrets and customer PII must never appear in logs, Git-tracked files, API error details, or client responses.
- Timestamps are stored as UTC ISO-8601 and business display defaults to `Asia/Bangkok`.
- New behavior follows test-first red-green-refactor.

---

### Task 1: Repository and TypeScript Application Boundary

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `src/app.ts`
- Create: `src/index.ts`
- Create: `test/app.test.ts`
- Preserve: `src/tiktok-oauth.mjs`, `test/tiktok-oauth.test.mjs`

**Interfaces:**
- Produces: `buildApp(options?: { now?: () => Date }): FastifyInstance`
- Produces: `GET /healthz -> { ok: true, service: "brandname-marketing-erp", timestamp: string }`

- [ ] **Step 1: Write the failing application health test**

Create `test/app.test.ts` using Vitest. Build the app with a fixed `now`, inject `GET /healthz`, and assert status 200 and the exact response contract.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:unit -- test/app.test.ts`

Expected: FAIL because `src/app.ts` does not exist.

- [ ] **Step 3: Install and configure the minimal runtime**

Add Fastify, Zod, TypeScript, TSX, Vitest, and Node typings. Configure strict TypeScript, `NodeNext` modules, source maps, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `npm` scripts for `dev`, `build`, `typecheck`, `test`, and `test:unit`. Preserve execution of the existing Node `.mjs` tests in `npm test`.

- [ ] **Step 4: Implement the application boundary**

Implement `buildApp` without starting a network listener. `src/index.ts` must validate `PORT`, build the app, listen on `0.0.0.0`, and exit non-zero after a redacted startup error.

- [ ] **Step 5: Verify GREEN and static checks**

Run: `npm run test:unit -- test/app.test.ts && npm run typecheck && npm test`

Expected: all commands exit 0 and the original five TikTok tests remain green.

- [ ] **Step 6: Commit**

Commit message: `chore: establish typescript service foundation`

---

### Task 2: Canonical Brand, Branch, Document, and Revenue Contracts

**Files:**
- Create: `src/domain/identity.ts`
- Create: `src/domain/transaction.ts`
- Create: `src/domain/revenue.ts`
- Create: `test/domain/identity.test.ts`
- Create: `test/domain/transaction.test.ts`
- Create: `test/domain/revenue.test.ts`

**Interfaces:**
- Produces: `BrandIdSchema` with `rent-a-coat | go-mall | winterra | cocoat`
- Produces: `BranchIdSchema` with `rac-rama9 | gomall-rama9 | rac-vibhavadi | phetkasem-future`
- Produces: `classifyDocumentNumber(value: string): "rental" | "sale" | "unknown"`
- Produces: `NormalizedTransactionSchema`
- Produces: `calculateRecognizedRevenue(lines: RevenueLine[]): RevenueSummary`

- [ ] **Step 1: Write identity and document-classification tests**

Assert the four brand IDs and four branch IDs, `RE-001` as rental, `ca0001` as sale, and unsupported/empty prefixes as unknown. Assert that destination is an independent optional field and cannot satisfy a missing `branchId`.

- [ ] **Step 2: Verify RED**

Run: `npm run test:unit -- test/domain/identity.test.ts test/domain/transaction.test.ts`

Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Implement identity and transaction contracts**

Use Zod discriminated/enum schemas. `NormalizedTransactionSchema` must require source ID, source base ID, brand ID, branch ID, document number, document kind, paid/document date, currency `THB`, customer reference hash when present, amounts, destination as a separate optional field, source updated time, and ingested time.

- [ ] **Step 4: Verify identity/document GREEN**

Run: `npm run test:unit -- test/domain/identity.test.ts test/domain/transaction.test.ts`

Expected: PASS.

- [ ] **Step 5: Write revenue-rule tests**

Assert rental/sale/fee lines contribute to recognized revenue, deposit contributes only to `depositAmount`, refund contributes to `refundAmount` and reduces net cash, and all decimal calculations are performed in integer satang.

- [ ] **Step 6: Verify revenue RED**

Run: `npm run test:unit -- test/domain/revenue.test.ts`

Expected: FAIL because `src/domain/revenue.ts` does not exist.

- [ ] **Step 7: Implement the revenue calculator**

Accept integer-satang `RevenueLine` records with category and settlement direction. Return gross recognized revenue, deposit amount, refund amount, and net cash movement. Reject negative satang inputs and unknown categories through schema validation.

- [ ] **Step 8: Verify full Task 2 GREEN**

Run: `npm run test:unit -- test/domain && npm run typecheck && npm test`

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

Commit message: `feat: define canonical transaction and revenue contracts`

---

### Task 3: Safe Environment Configuration and Integration Registry

**Files:**
- Create: `src/config/env.ts`
- Create: `src/integrations/types.ts`
- Create: `src/integrations/registry.ts`
- Create: `test/config/env.test.ts`
- Create: `test/integrations/registry.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): AppConfig`
- Produces: `IntegrationConnector` with `healthCheck`, `syncIncremental`, and `syncBackfill`
- Produces: `IntegrationRegistry.get(id)` and `IntegrationRegistry.listHealth()`

- [ ] **Step 1: Write configuration tests**

Assert staging/production environment validation, required Airtable base IDs, secret values omitted from serialized config, malformed URLs rejected, and missing production requirements reported only by variable name.

- [ ] **Step 2: Verify RED**

Run: `npm run test:unit -- test/config/env.test.ts`

Expected: FAIL because `src/config/env.ts` does not exist.

- [ ] **Step 3: Implement Zod-backed configuration**

Define environment, port, log level, Airtable API/base references, GCP project/location, database URL reference, sync interval, and optional provider references. Add only names and examples—not values—to `.env.example`.

- [ ] **Step 4: Verify configuration GREEN**

Run: `npm run test:unit -- test/config/env.test.ts`

Expected: PASS.

- [ ] **Step 5: Write connector-registry tests**

Create two fake connectors. Assert duplicate IDs are rejected, missing IDs return a typed error, health checks are returned in stable ID order, and one failing connector does not hide healthy connector results.

- [ ] **Step 6: Verify registry RED**

Run: `npm run test:unit -- test/integrations/registry.test.ts`

Expected: FAIL because integration types/registry do not exist.

- [ ] **Step 7: Implement integration interfaces and registry**

Define typed cursors, sync windows, counts, warnings, and health states `healthy | degraded | unavailable | unconfigured`. Never include raw provider responses or credentials in health results.

- [ ] **Step 8: Verify Task 3**

Run: `npm run test:unit -- test/config test/integrations/registry.test.ts && npm run typecheck && npm test`

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

Commit message: `feat: add safe configuration and integration registry`

---

### Task 4: Airtable Read Connector and Incremental Pagination

**Files:**
- Create: `src/integrations/airtable/client.ts`
- Create: `src/integrations/airtable/connector.ts`
- Create: `src/integrations/airtable/mapping.ts`
- Create: `test/integrations/airtable/client.test.ts`
- Create: `test/integrations/airtable/connector.test.ts`
- Create: `test/fixtures/airtable-transactions.json`

**Interfaces:**
- Produces: `AirtableClient.listRecords({ baseId, table, view?, filterByFormula?, offset? })`
- Produces: `AirtableConnector implements IntegrationConnector`
- Consumes: canonical schemas from Task 2 and config/connector types from Task 3.

- [ ] **Step 1: Write Airtable pagination tests**

Stub two Airtable REST pages and assert authorization header, URL encoding, offset forwarding, 429 retry using `Retry-After`, and no token in thrown/logged errors.

- [ ] **Step 2: Verify client RED**

Run: `npm run test:unit -- test/integrations/airtable/client.test.ts`

Expected: FAIL because Airtable client does not exist.

- [ ] **Step 3: Implement minimal read client**

Use injected `fetch`, bounded retries for 429/5xx, request timeout, and normalized safe errors. Do not implement writes.

- [ ] **Step 4: Verify client GREEN**

Run: `npm run test:unit -- test/integrations/airtable/client.test.ts`

Expected: PASS.

- [ ] **Step 5: Write connector/mapping tests**

Use fixtures representing both bases. Assert base-to-brand mapping, explicit branch mapping, RE/CA classification, separate destination, integer-satang conversion, unknown branch rejection into a warning/error record, cursor advancement by source modified time and record ID, and idempotent upsert keys `{baseId, table, recordId}`.

- [ ] **Step 6: Verify connector RED**

Run: `npm run test:unit -- test/integrations/airtable/connector.test.ts`

Expected: FAIL because connector/mapping modules do not exist.

- [ ] **Step 7: Implement connector and normalizers**

Read configured transaction and transaction-detail tables, normalize without mutating Airtable, and return records plus warnings and a deterministic cursor. Preserve source field names only in a private source snapshot object that is excluded from logs and client responses.

- [ ] **Step 8: Verify Task 4**

Run: `npm run test:unit -- test/integrations/airtable && npm run typecheck && npm test`

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

Commit message: `feat: ingest airtable transactions incrementally`

---

### Task 5: Observable Sync Orchestration and Internal API

**Files:**
- Create: `src/sync/checkpoint-store.ts`
- Create: `src/sync/memory-checkpoint-store.ts`
- Create: `src/sync/sync-service.ts`
- Create: `src/routes/integrations.ts`
- Create: `test/sync/sync-service.test.ts`
- Create: `test/routes/integrations.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces: `CheckpointStore.get/put`
- Produces: `SyncService.runIncremental(integrationId)`
- Produces: `GET /api/integrations`, `GET /api/integrations/:id/status`, `POST /api/integrations/:id/sync`
- Consumes: `IntegrationRegistry` and `IntegrationConnector` from Task 3.

- [ ] **Step 1: Write sync-service tests**

Assert checkpoint use, checkpoint advancement only after successful persistence, concurrent duplicate sync rejection, stable run IDs, counts/warnings propagation, and failed-run status without cursor loss.

- [ ] **Step 2: Verify service RED**

Run: `npm run test:unit -- test/sync/sync-service.test.ts`

Expected: FAIL because sync modules do not exist.

- [ ] **Step 3: Implement in-memory orchestration boundary**

Implement interfaces so Cloud SQL persistence can replace memory without changing connectors. Use dependency injection for clock and ID generation. Redact provider errors at the service boundary.

- [ ] **Step 4: Verify service GREEN**

Run: `npm run test:unit -- test/sync/sync-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Write route tests**

Assert integration list/status response schemas, 404 for unknown IDs, 202 for accepted sync, 409 for an already-running sync, and no secret/provider payload in errors.

- [ ] **Step 6: Verify route RED**

Run: `npm run test:unit -- test/routes/integrations.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 7: Implement and register internal routes**

Keep authorization as an injected pre-handler so Google Workspace SSO/RBAC can be attached in the next plan without changing route behavior.

- [ ] **Step 8: Verify Foundation release gate**

Run: `npm run typecheck && npm run build && npm test`

Expected: all commands exit 0 with zero failed tests.

- [ ] **Step 9: Commit**

Commit message: `feat: expose observable integration sync controls`

## Follow-on Plans

After this foundation is merged, create separate executable plans for:

1. Cloud SQL persistence, BigQuery analytical marts, and historical backfill from 2023.
2. Google Ads, GSC, GA4, LINE, Meta, TikTok, GBP, and FlowAccount read-only connectors.
3. Google Workspace SSO, RBAC, audit logging, and PII governance.
4. Campaign, budget, content approval, KPI, attribution, and competitor modules.
5. Custom dashboard, Looker Studio semantic views, UAT, GCP deployment, monitoring, backup, and production rollout.

# Marketing ERP Database Persistence and CRM Data Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-ready PostgreSQL/Supabase database adapter, persistent checkpoint store, and write-through pipeline that ingests Airtable transaction batches, leads, and customer size attributes directly into Supabase CRM tables.

**Architecture:** Replace the transient memory checkpoint store with a PostgreSQL-backed store. Introduce a database transaction wrapper and repository layer that safely upserts normalized transaction records, sync logs, and extracts customer sizing/lead profiles. All database queries must respect Row Level Security (RLS) and schema guidelines.

**Tech Stack:** Node.js 22+, TypeScript 5 strict mode, Fastify, pg (node-postgres), Vitest.

## Global Constraints

- Primary database is Supabase PostgreSQL (UAT and Production) with RLS enabled.
- Financial transactions must be recorded in integer satang.
- Do not write secrets or customer PII to logs, git-tracked files, or API responses.
- Timestamps must be stored as UTC ISO-8601.
- All database write operations must be idempotent and replay-safe.

---

### Task 1: Database Client Wrapper & Connection Pool

**Files:**
- Create: `src/config/database.ts`
- Create: `test/config/database.test.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `DatabaseClient` class with `query`, `connect`, and `close` methods.
- Produces: Updated `AppConfig` including `DATABASE_URL`.

- [ ] **Step 1: Write the environment validation test for DATABASE_URL**

Add a test case in `test/config/env.test.ts` asserting that `DATABASE_URL` is parsed and validated as a correct postgres URL under staging/production environments.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:unit -- test/config/env.test.ts`
Expected: FAIL if DATABASE_URL is not configured as required for deployment.

- [ ] **Step 3: Modify environment config**

Ensure `DATABASE_URL` is mapped in `src/config/env.ts` and marked as required for staging/production APP_ENV. Update `.env.example` with a placeholder `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres`.

- [ ] **Step 4: Implement Database Client Wrapper**

Create `src/config/database.ts` using `pg` to manage a connection pool:
```typescript
import pg from 'pg';

export class DatabaseClient {
  private readonly pool: pg.Pool;

  public constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  public async query<T extends pg.QueryResultRow = any>(
    text: string,
    params?: any[],
  ): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
```

- [ ] **Step 5: Write unit tests for DatabaseClient**

In `test/config/database.test.ts`, stub `pg.Pool` query methods and assert parameters are safely forwarded.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `npm run test:unit -- test/config/database.test.ts test/config/env.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/config/env.ts src/config/database.ts test/config/database.test.ts test/config/env.test.ts
git commit -m "feat: add postgres connection pool and wrapper"
```

---

### Task 2: Persistent Checkpoint Store

**Files:**
- Create: `src/sync/postgres-checkpoint-store.ts`
- Create: `test/sync/postgres-checkpoint-store.test.ts`

**Interfaces:**
- Consumes: `DatabaseClient` from Task 1.
- Produces: `PostgresCheckpointStore` implementing `CheckpointStore` (`getCheckpoint(integrationId)`, `putCheckpoint(integrationId, cursor)`).

- [ ] **Step 1: Write checkpoint store integration tests**

Assert getting a missing checkpoint returns `undefined`, putting a cursor saves it in UTC format, and updating a cursor overwrites the old record.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:unit -- test/sync/postgres-checkpoint-store.test.ts`
Expected: FAIL because `postgres-checkpoint-store.ts` does not exist.

- [ ] **Step 3: Implement PostgresCheckpointStore**

Create `src/sync/postgres-checkpoint-store.ts` targeting `public.sync_runs` table or a specific metadata table:
```typescript
import type { DatabaseClient } from '../config/database.js';
import type { CheckpointStore } from './checkpoint-store.js';
import type { SyncCursor } from '../integrations/types.js';

export class PostgresCheckpointStore implements CheckpointStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async getCheckpoint(integrationId: string): Promise<SyncCursor | undefined> {
    const res = await this.db.query(
      `SELECT metadata->'cursor' as cursor FROM public.sync_runs 
       WHERE data_source_id = $1 AND status = 'completed' 
       ORDER BY finished_at DESC LIMIT 1`,
      [integrationId],
    );
    const cursor = res.rows[0]?.cursor;
    return cursor ? cursor : undefined;
  }

  public async putCheckpoint(integrationId: string, cursor: SyncCursor): Promise<void> {
    await this.db.query(
      `INSERT INTO public.sync_runs (id, data_source_id, status, started_at, finished_at, metadata) 
       VALUES (gen_random_uuid(), $1, 'completed', now(), now(), jsonb_build_object('cursor', $2::jsonb))`,
      [integrationId, JSON.stringify(cursor)],
    );
  }
}
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `npm run test:unit -- test/sync/postgres-checkpoint-store.test.ts`
Expected: PASS (with mocked query client)

- [ ] **Step 5: Commit**

```bash
git add src/sync/postgres-checkpoint-store.ts test/sync/postgres-checkpoint-store.test.ts
git commit -m "feat: implement postgres checkpoint store"
```

---

### Task 3: CRM Database Ingestion Repository

**Files:**
- Create: `src/sync/crm-repository.ts`
- Create: `test/sync/crm-repository.test.ts`

**Interfaces:**
- Consumes: `DatabaseClient` from Task 1.
- Produces: `CrmRepository` with `upsertTransactions(transactions)`, `upsertLeadsAndSizing(batch)`.

- [ ] **Step 1: Write CRM ingestion tests**

Assert transactions are correctly converted to satang and stored in DB. Assert customer profiles, sizing attributes (like boot height, pants length), and pipeline items are correctly extracted from Airtable metadata and inserted into the `public.leads` and `public.pipeline_items` tables.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:unit -- test/sync/crm-repository.test.ts`
Expected: FAIL because `crm-repository.ts` is missing.

- [ ] **Step 3: Implement CRM Repository**

Write `src/sync/crm-repository.ts` which map and insert sizing attributes:
```typescript
import type { DatabaseClient } from '../config/database.js';
import type { AirtableSyncBatch } from '../integrations/airtable/connector.js';

export class CrmRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async upsertTransactions(batch: AirtableSyncBatch): Promise<void> {
    for (const record of batch.records) {
      const tx = record.transaction;
      await this.db.query(
        `INSERT INTO public.leads (id, customer_name, source, destination, trip_date, lead_score, estimated_basket_value)
         VALUES ($1, $2, 'manual_csv', $3, $4, 10, $5)
         ON CONFLICT (id) DO UPDATE SET destination = EXCLUDED.destination, trip_date = EXCLUDED.trip_date`,
        [
          tx.sourceId,
          tx.documentNumber,
          tx.destination || null,
          tx.documentDate ? tx.documentDate.split('T')[0] : null,
          tx.amounts.documentTotal
        ],
      );
    }
  }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `npm run test:unit -- test/sync/crm-repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/crm-repository.ts test/sync/crm-repository.test.ts
git commit -m "feat: add CRM database repository for leads and transaction mapping"
```

---

### Task 4: Connect Ingestion Hub to Database Sync Service

**Files:**
- Modify: `src/sync/sync-service.ts`
- Modify: `test/sync/sync-service.test.ts`
- Modify: `src/startup.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `PostgresCheckpointStore` and `CrmRepository`.
- Produces: Integrated `SyncService` executing write-through writes into the DB.

- [ ] **Step 1: Write integration sync verification test**

In `test/sync/sync-service.test.ts`, assert that executing `runIncremental` triggers `CrmRepository.upsertTransactions` and saves the updated checkpoint in `PostgresCheckpointStore`.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:unit -- test/sync/sync-service.test.ts`
Expected: FAIL because `SyncService` only handles in-memory stubs currently.

- [ ] **Step 3: Modify SyncService to write to DB**

Update `src/sync/sync-service.ts` to accept `CheckpointStore` and `CrmRepository` interfaces. In `runIncremental`, after executing `connector.readIncrementalBatch`, invoke `repository.upsertTransactions` and `checkpointStore.putCheckpoint` on success.

- [ ] **Step 4: Update startup and app boundaries**

Update `src/startup.ts` and `src/app.ts` to instantiate the `DatabaseClient`, `PostgresCheckpointStore`, and `CrmRepository` and pass them into the `buildApp({ integrationRoutes })` config.

- [ ] **Step 5: Verify all tests GREEN**

Run: `npm run typecheck && npm run build && npm test`
Expected: All 163+ tests pass green.

- [ ] **Step 6: Commit**

```bash
git add src/sync/sync-service.ts src/startup.ts src/app.ts test/sync/sync-service.test.ts
git commit -m "feat: connect sync pipeline to Supabase Postgres persistence"
```

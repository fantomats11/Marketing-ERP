import { describe, expect, test, vi, beforeEach } from 'vitest';
import { IntegrationRegistry } from '../../src/integrations/registry.js';
import type { IntegrationConnector, SyncCursor } from '../../src/integrations/types.js';
import { PostgresCheckpointStore } from '../../src/sync/postgres-checkpoint-store.js';
import { CrmRepository } from '../../src/sync/crm-repository.js';
import { MemoryCheckpointStore } from '../../src/sync/memory-checkpoint-store.js';
import type { DatabaseClient } from '../../src/config/database.js';
import type { AirtableSyncBatch } from '../../src/integrations/airtable/connector.js';
import {
  IntegrationSyncAlreadyRunningError,
  SyncService,
} from '../../src/sync/sync-service.js';

const initialCursor: SyncCursor = {
  updatedAt: '2026-07-10T00:00:00.000Z',
  sourceRecordId: 'rec-10',
};

const nextCursor: SyncCursor = {
  updatedAt: '2026-07-11T00:00:00.000Z',
  sourceRecordId: 'rec-11',
};

const mockBatch: AirtableSyncBatch = {
  records: [
    {
      sourceKey: { baseId: 'base1', table: 'table1', recordId: 'rec1' },
      upsertKey: 'key1',
      transaction: {
        sourceId: 'rec1',
        sourceBaseId: 'base1',
        orderGroupId: 'base1/table1/rec1',
        brandId: 'go-mall',
        branchId: 'gomall-rama9',
        documentNumber: 'CA-1002',
        documentKind: 'sale',
        documentDate: '2026-07-12T16:00:00Z',
        currency: 'THB',
        amounts: {
          grossAmount: 5000,
          discountAmount: 0,
          netBeforeVat: 5000,
          vatAmount: 350,
          documentTotal: 5350,
          cashCollected: 0,
          depositAmount: 0,
          refundAmount: 0,
        },
        sourceUpdatedAt: '2026-07-12T16:05:00Z',
        ingestedAt: '2026-07-12T16:10:00Z',
      },
    },
  ],
  recordIssues: [
    {
      sourceKey: { baseId: 'base1', table: 'table1', recordId: 'rec2' },
      severity: 'warning',
      code: 'UNKNOWN_BRANCH',
    },
  ],
  orderGroups: [],
  detailReferences: [],
  sourceCounts: {
    transactionRecordsFetched: 5,
    transactionRecordsSelected: 1,
    transactionDetailRecordsFetched: 0,
  },
  checkpointBlocked: false,
  cursor: nextCursor,
};

describe('MemoryCheckpointStore', () => {
  test('defensively copies cursors on put and get', async () => {
    const store = new MemoryCheckpointStore();
    const mutable = { ...initialCursor };

    await store.put('airtable', mutable);
    mutable.sourceRecordId = 'mutated-after-put';
    const first = await store.get('airtable');
    if (first === undefined) throw new Error('expected checkpoint');
    (first as { sourceRecordId: string }).sourceRecordId = 'mutated-after-get';

    await expect(store.get('airtable')).resolves.toEqual(initialCursor);
  });
});

describe('SyncService Integration', () => {
  let mockDb: any;
  let checkpointStore: PostgresCheckpointStore;
  let crmRepository: CrmRepository;

  beforeEach(() => {
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    checkpointStore = new PostgresCheckpointStore(mockDb as unknown as DatabaseClient);
    crmRepository = new CrmRepository(mockDb as unknown as DatabaseClient);
  });

  test('runIncremental triggers CrmRepository and saves checkpoint in PostgresCheckpointStore', async () => {
    // 1. Mock checkpointStore get to return initialCursor
    mockDb.query.mockResolvedValueOnce({
      rows: [{ cursor: initialCursor }],
    });

    const connector = createConnector(async (request: any) => {
      expect(request).toEqual({ cursor: initialCursor });
      return mockBatch;
    });

    const times = [new Date('2026-07-12T01:00:00.000Z'), new Date('2026-07-12T01:05:00.000Z')];
    const service = new SyncService(new IntegrationRegistry([connector]), {
      checkpointStore,
      crmRepository,
      now: () => times.shift() ?? new Date('2026-07-12T01:05:00.000Z'),
      generateRunId: () => 'run-fixed',
    });

    const handle = service.runIncremental('airtable');

    expect(handle.run).toEqual({
      integrationId: 'airtable',
      runId: 'run-fixed',
      status: 'running',
      startedAt: '2026-07-12T01:00:00.000Z',
    });

    const completed = await handle.completion;

    expect(completed).toEqual({
      integrationId: 'airtable',
      runId: 'run-fixed',
      status: 'completed',
      startedAt: '2026-07-12T01:00:00.000Z',
      completedAt: '2026-07-12T01:05:00.000Z',
      counts: { fetched: 5, created: 1, updated: 0, skipped: 4 },
      warnings: [{ code: 'UNKNOWN_BRANCH', count: 1 }],
    });

    // Check that CrmRepository query was executed (upsertTransactions + upsertLeadsAndSizing queries)
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.leads'),
      expect.any(Array),
    );

    // Check that PostgresCheckpointStore put was executed (INSERT INTO public.sync_runs)
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.sync_runs'),
      ['airtable', JSON.stringify(nextCursor)],
    );
  });
});

describe('SyncService Unit Tests', () => {
  test('returns CHECKPOINT_READ_FAILED if checkpoint store get rejects', async () => {
    const checkpointStore = {
      get: async () => { throw new Error('checkpoint read failed'); },
      put: async () => {},
    };
    const crmRepository = {
      upsertTransactions: async () => {},
      upsertLeadsAndSizing: async () => {},
    } as unknown as CrmRepository;

    const service = createService({
      checkpointStore,
      crmRepository,
      connector: createConnector(async () => mockBatch),
    });

    const result = await service.runIncremental('airtable').completion;
    expect(result).toMatchObject({ status: 'failed', errorCode: 'CHECKPOINT_READ_FAILED' });
  });

  test('returns CONNECTOR_SYNC_FAILED if connector readIncrementalBatch throws', async () => {
    const checkpointStore = new MemoryCheckpointStore();
    const crmRepository = {
      upsertTransactions: async () => {},
      upsertLeadsAndSizing: async () => {},
    } as unknown as CrmRepository;

    const service = createService({
      checkpointStore,
      crmRepository,
      connector: createConnector(async () => { throw new Error('connector failed'); }),
    });

    const result = await service.runIncremental('airtable').completion;
    expect(result).toMatchObject({ status: 'failed', errorCode: 'CONNECTOR_SYNC_FAILED' });
  });

  test('returns SYNC_COMMIT_FAILED if CRM upsert fails', async () => {
    const checkpointStore = new MemoryCheckpointStore();
    const crmRepository = {
      upsertTransactions: async () => { throw new Error('db failure'); },
      upsertLeadsAndSizing: async () => {},
    } as unknown as CrmRepository;

    const service = createService({
      checkpointStore,
      crmRepository,
      connector: createConnector(async () => mockBatch),
    });

    const result = await service.runIncremental('airtable').completion;
    expect(result).toMatchObject({ status: 'failed', errorCode: 'SYNC_COMMIT_FAILED' });
  });

  test('returns SYNC_COMMIT_FAILED if checkpoint store put fails', async () => {
    const checkpointStore = {
      get: async () => undefined,
      put: async () => { throw new Error('checkpoint write failed'); },
    };
    const crmRepository = {
      upsertTransactions: async () => {},
      upsertLeadsAndSizing: async () => {},
    } as unknown as CrmRepository;

    const service = createService({
      checkpointStore,
      crmRepository,
      connector: createConnector(async () => mockBatch),
    });

    const result = await service.runIncremental('airtable').completion;
    expect(result).toMatchObject({ status: 'failed', errorCode: 'SYNC_COMMIT_FAILED' });
  });

  test('returns CLOCK_FAILED if terminal time is invalid', async () => {
    const checkpointStore = new MemoryCheckpointStore();
    const crmRepository = {
      upsertTransactions: async () => {},
      upsertLeadsAndSizing: async () => {},
    } as unknown as CrmRepository;

    const service = createService({
      checkpointStore,
      crmRepository,
      connector: createConnector(async () => mockBatch),
      now: vi.fn<() => Date>()
        .mockReturnValueOnce(new Date('2026-07-12T01:00:00.000Z'))
        .mockImplementation(() => new Date(Number.NaN)),
    });

    const result = await service.runIncremental('airtable').completion;
    expect(result).toMatchObject({ status: 'failed', errorCode: 'CLOCK_FAILED' });
  });

  test('reserves active run synchronously and rejects a duplicate before any await', async () => {
    let release: ((result: AirtableSyncBatch) => void) | undefined;
    const pending = new Promise<AirtableSyncBatch>((resolve) => { release = resolve; });
    const checkpointStore = new MemoryCheckpointStore();
    const crmRepository = {
      upsertTransactions: async () => {},
      upsertLeadsAndSizing: async () => {},
    } as unknown as CrmRepository;

    const service = createService({
      checkpointStore,
      crmRepository,
      connector: createConnector(async () => pending),
    });

    const first = service.runIncremental('airtable');

    expect(() => service.runIncremental('airtable')).toThrow(IntegrationSyncAlreadyRunningError);
    release?.(mockBatch);
    await first.completion;
  });
});

function createService(overrides: {
  connector: IntegrationConnector;
  checkpointStore: any;
  crmRepository: CrmRepository;
  now?: () => Date;
  generateRunId?: () => string;
}): SyncService {
  const times = [
    new Date('2026-07-12T01:00:00.000Z'),
    new Date('2026-07-12T01:05:00.000Z'),
  ];
  return new SyncService(new IntegrationRegistry([overrides.connector]), {
    checkpointStore: overrides.checkpointStore,
    crmRepository: overrides.crmRepository,
    now: overrides.now ?? (() => times.shift() ?? new Date('2026-07-12T01:05:00.000Z')),
    generateRunId: overrides.generateRunId ?? (() => 'run-fixed'),
  });
}

function createConnector(readIncrementalBatch: any): IntegrationConnector {
  return {
    id: 'airtable',
    healthCheck: async () => ({ status: 'healthy' }),
    syncIncremental: async () => { throw new Error('not used'); },
    syncBackfill: async () => { throw new Error('not used'); },
    readIncrementalBatch,
  };
}

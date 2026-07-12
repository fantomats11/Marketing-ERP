import { describe, expect, test, vi } from 'vitest';

import type { IntegrationConnector, SyncCursor, SyncResult } from '../../src/integrations/types.js';
import { IntegrationRegistry } from '../../src/integrations/registry.js';
import { MemoryCheckpointStore } from '../../src/sync/memory-checkpoint-store.js';
import {
  IntegrationSyncAlreadyRunningError,
  SyncService,
  type AtomicSyncCommit,
  type SyncCommitOutcome,
  type SyncCommitStore,
} from '../../src/sync/sync-service.js';

const initialCursor: SyncCursor = {
  updatedAt: '2026-07-10T00:00:00.000Z',
  sourceRecordId: 'rec-10',
};

const nextCursor: SyncCursor = {
  updatedAt: '2026-07-11T00:00:00.000Z',
  sourceRecordId: 'rec-11',
};

const successfulResult: SyncResult = {
  cursor: nextCursor,
  counts: { fetched: 8, created: 3, updated: 2, skipped: 3 },
  warnings: [{ code: 'UNKNOWN_BRANCH', count: 2 }],
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

describe('SyncService', () => {
  test('atomically commits the safe result, terminal run, and cursor transition', async () => {
    const store = new FakeSyncCommitStore(initialCursor);
    const connector = createConnector(async (request) => {
      expect(request).toEqual({ cursor: initialCursor });
      return successfulResult;
    });
    const service = createService({ connector, syncCommitStore: store });

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
      counts: successfulResult.counts,
      warnings: successfulResult.warnings,
    });
    expect(store.commits).toHaveLength(1);
    expect(store.commits[0]).toEqual({
      integrationId: 'airtable',
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      expectedCursor: initialCursor,
      nextCursor,
      result: {
        integrationId: 'airtable',
        runId: 'run-fixed',
        startedAt: '2026-07-12T01:00:00.000Z',
        counts: successfulResult.counts,
        warnings: successfulResult.warnings,
      },
      completedRun: completed,
    });
    await expect(store.getCheckpoint('airtable')).resolves.toEqual(nextCursor);
  });

  test('returns SYNC_COMMIT_FAILED without changing durable state when atomic commit rejects', async () => {
    const secret = 'database password and provider payload';
    const store = new FakeSyncCommitStore(initialCursor, secret);
    const service = createService({
      connector: createConnector(async () => successfulResult),
      syncCommitStore: store,
    });

    const failed = await service.runIncremental('airtable').completion;

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'SYNC_COMMIT_FAILED' });
    expect(JSON.stringify(failed)).not.toContain(secret);
    await expect(store.getCheckpoint('airtable')).resolves.toEqual(initialCursor);
  });

  test('leaves the cursor unchanged when the connector fails and never exposes provider errors', async () => {
    const secret = 'raw provider token and response';
    const store = new FakeSyncCommitStore(initialCursor);
    const service = createService({
      connector: createConnector(async () => { throw new Error(secret); }),
      syncCommitStore: store,
    });

    const failed = await service.runIncremental('airtable').completion;

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'CONNECTOR_SYNC_FAILED' });
    expect(JSON.stringify(failed)).not.toContain(secret);
    expect(store.commits).toHaveLength(0);
    await expect(store.getCheckpoint('airtable')).resolves.toEqual(initialCursor);
  });

  test('does not commit when the terminal clock throws and releases the active lock', async () => {
    const store = new FakeSyncCommitStore(initialCursor);
    const now = vi.fn<() => Date>()
      .mockReturnValueOnce(new Date('2026-07-12T01:00:00.000Z'))
      .mockImplementation(() => { throw new Error('clock backend secret'); });
    const service = createService({
      connector: createConnector(async () => successfulResult),
      syncCommitStore: store,
      now,
    });

    const failed = await service.runIncremental('airtable').completion;

    expect(failed).toEqual({
      integrationId: 'airtable',
      runId: 'run-fixed',
      status: 'failed',
      startedAt: '2026-07-12T01:00:00.000Z',
      completedAt: '2026-07-12T01:00:00.000Z',
      errorCode: 'CLOCK_FAILED',
    });
    expect(store.commits).toHaveLength(0);
    expect(service.getStatus('airtable')).toEqual(failed);
    now.mockReturnValue(new Date('2026-07-12T01:10:00.000Z'));
    const retry = service.runIncremental('airtable');
    await expect(retry.completion).resolves.toMatchObject({ status: 'completed' });
  });

  test('does not commit when the terminal clock returns an invalid date', async () => {
    const store = new FakeSyncCommitStore(initialCursor);
    const times = [new Date('2026-07-12T01:00:00.000Z'), new Date(Number.NaN)];
    const service = createService({
      connector: createConnector(async () => successfulResult),
      syncCommitStore: store,
      now: () => times.shift() ?? new Date(Number.NaN),
    });

    await expect(service.runIncremental('airtable').completion).resolves.toMatchObject({
      status: 'failed', errorCode: 'CLOCK_FAILED', completedAt: '2026-07-12T01:00:00.000Z',
    });
    expect(store.commits).toHaveLength(0);
  });

  test('derives the same idempotency key across run IDs for the same logical commit', async () => {
    const firstStore = new FakeSyncCommitStore(initialCursor);
    const secondStore = new FakeSyncCommitStore(initialCursor);
    await createService({
      connector: createConnector(async () => successfulResult),
      syncCommitStore: firstStore,
      generateRunId: () => 'run-one',
    }).runIncremental('airtable').completion;
    await createService({
      connector: createConnector(async () => successfulResult),
      syncCommitStore: secondStore,
      generateRunId: () => 'run-two',
      now: vi.fn<() => Date>()
        .mockReturnValueOnce(new Date('2026-07-12T02:00:00.000Z'))
        .mockReturnValue(new Date('2026-07-12T02:05:00.000Z')),
    }).runIncremental('airtable').completion;

    expect(firstStore.commits[0]!.idempotencyKey).toBe(secondStore.commits[0]!.idempotencyKey);
  });

  test('returns the canonical persisted run when the same key was committed by another run', async () => {
    const store = new FakeSyncCommitStore(initialCursor);
    const firstService = createService({
      connector: createConnector(async () => successfulResult),
      syncCommitStore: store,
      generateRunId: () => 'run-canonical',
    });
    const duplicateService = createService({
      connector: createConnector(async () => successfulResult),
      syncCommitStore: store,
      generateRunId: () => 'run-duplicate',
    });

    const first = firstService.runIncremental('airtable');
    const duplicate = duplicateService.runIncremental('airtable');
    const [canonical, duplicateResult] = await Promise.all([first.completion, duplicate.completion]);

    expect(store.attempts).toHaveLength(2);
    expect(store.attempts[0]!.idempotencyKey).toBe(store.attempts[1]!.idempotencyKey);
    expect(store.outcomeStatuses).toEqual(['committed', 'already_committed']);
    expect(duplicateResult).toEqual(canonical);
    expect(duplicateResult.runId).toBe('run-canonical');
    expect(duplicateService.getStatus('airtable')).toEqual(canonical);

    if (canonical.status !== 'completed') throw new Error('expected completed status');
    if (duplicateResult.status !== 'completed') throw new Error('expected completed duplicate');
    (store.canonicalRuns[0]!.counts as { fetched: number }).fetched = 999;
    expect(duplicateResult.counts.fetched).toBe(8);
    expect(duplicateService.getStatus('airtable')).toEqual(canonical);
  });

  test('maps a malformed commit outcome to a safe terminal failure', async () => {
    const secret = 'raw-adapter-outcome-secret';
    const store = {
      getCheckpoint: async () => initialCursor,
      commit: async () => ({
        status: 'committed',
        completedRun: { status: 'completed', integrationId: secret },
      }),
    } as unknown as SyncCommitStore;
    const service = createService({
      connector: createConnector(async () => successfulResult),
      syncCommitStore: store,
    });

    const failed = await service.runIncremental('airtable').completion;

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'SYNC_COMMIT_FAILED' });
    expect(JSON.stringify(failed)).not.toContain(secret);
    expect(service.getStatus('airtable')).toEqual(failed);
  });

  test('changes the idempotency key when the expected cursor changes', async () => {
    const firstStore = new FakeSyncCommitStore(initialCursor);
    const changedStore = new FakeSyncCommitStore({ ...initialCursor, sourceRecordId: 'rec-other' });
    await createService({
      connector: createConnector(async () => successfulResult), syncCommitStore: firstStore,
    }).runIncremental('airtable').completion;
    await createService({
      connector: createConnector(async () => successfulResult), syncCommitStore: changedStore,
    }).runIncremental('airtable').completion;

    expect(firstStore.commits[0]!.idempotencyKey).not.toBe(changedStore.commits[0]!.idempotencyKey);
  });

  test('canonicalizes cursor property order and normalized warning order in the idempotency key', async () => {
    const firstStore = new FakeSyncCommitStore(initialCursor);
    const reorderedStore = new FakeSyncCommitStore({
      sourceRecordId: initialCursor.sourceRecordId,
      updatedAt: initialCursor.updatedAt,
    });
    const firstResult: SyncResult = {
      ...successfulResult,
      warnings: [
        { code: 'UNKNOWN_BRANCH', count: 2 },
        { code: 'MISSING_BRANCH', count: 3 },
        { code: 'UNKNOWN_BRANCH', count: 4 },
      ],
    };
    const reorderedResult: SyncResult = {
      cursor: { sourceRecordId: nextCursor.sourceRecordId, updatedAt: nextCursor.updatedAt },
      counts: { skipped: 3, updated: 2, created: 3, fetched: 8 },
      warnings: [
        { code: 'UNKNOWN_BRANCH', count: 4 },
        { code: 'UNKNOWN_BRANCH', count: 2 },
        { code: 'MISSING_BRANCH', count: 3 },
      ],
    };

    await createService({
      connector: createConnector(async () => firstResult), syncCommitStore: firstStore,
    }).runIncremental('airtable').completion;
    await createService({
      connector: createConnector(async () => reorderedResult), syncCommitStore: reorderedStore,
    }).runIncremental('airtable').completion;

    expect(firstStore.commits[0]!.result.warnings).toEqual([
      { code: 'MISSING_BRANCH', count: 3 },
      { code: 'UNKNOWN_BRANCH', count: 6 },
    ]);
    expect(reorderedStore.commits[0]!.result.warnings).toEqual(firstStore.commits[0]!.result.warnings);
    expect(reorderedStore.commits[0]!.idempotencyKey).toBe(firstStore.commits[0]!.idempotencyKey);
  });

  test('normalizes provider-controlled warning codes and malformed counts before commit and status', async () => {
    const store = new FakeSyncCommitStore(initialCursor);
    const unsafeResult: SyncResult = {
      ...successfulResult,
      warnings: [
        { code: 'provider-secret-token=abc123', count: 7 },
        { code: 'UNKNOWN_BRANCH', count: Number.NaN },
        { code: 'UNKNOWN_BRANCH', count: 2 },
        { code: 'UNKNOWN_BRANCH', count: 3 },
        {} as SyncResult['warnings'][number],
      ],
    };
    const service = createService({
      connector: createConnector(async () => unsafeResult), syncCommitStore: store,
    });

    const completed = await service.runIncremental('airtable').completion;

    const safeWarnings = [
      { code: 'INTEGRATION_WARNING', count: 9 },
      { code: 'UNKNOWN_BRANCH', count: 5 },
    ];
    expect(completed).toMatchObject({ status: 'completed', warnings: safeWarnings });
    expect(store.commits[0]!.result.warnings).toEqual(safeWarnings);
    expect(JSON.stringify(store.commits[0])).not.toContain('provider-secret-token');
  });

  test('snapshots hostile connector count getters once before hashing, committing, and publishing status', async () => {
    const safeStore = new FakeSyncCommitStore(initialCursor);
    await createService({
      connector: createConnector(async () => successfulResult), syncCommitStore: safeStore,
    }).runIncremental('airtable').completion;

    const secret = 'connector-count-second-read-secret';
    const reads = { counts: 0, fetched: 0, created: 0, updated: 0, skipped: 0 };
    const hostileResult = Object.defineProperties({}, {
      counts: hostileGetter(reads, 'counts', Object.defineProperties({}, {
        fetched: hostileGetter(reads, 'fetched', 8, Number.NaN),
        created: hostileGetter(reads, 'created', 3, Number.NaN),
        updated: hostileGetter(reads, 'updated', 2, Number.NaN),
        skipped: hostileGetter(reads, 'skipped', 3, Number.NaN),
      }), { secret }),
      cursor: { value: nextCursor, enumerable: true },
      warnings: { value: successfulResult.warnings, enumerable: true },
    });
    const store = new FakeSyncCommitStore(initialCursor);
    const service = createService({
      connector: createConnector(async () => hostileResult as SyncResult), syncCommitStore: store,
    });

    const completed = await service.runIncremental('airtable').completion;

    expect(reads).toEqual({ counts: 1, fetched: 1, created: 1, updated: 1, skipped: 1 });
    expect(completed).toMatchObject({ status: 'completed', counts: successfulResult.counts });
    expect(store.commits[0]!.result.counts).toEqual(successfulResult.counts);
    expect(store.commits[0]!.idempotencyKey).toBe(safeStore.commits[0]!.idempotencyKey);
    expect(JSON.stringify([store.attempts, completed, service.getStatus('airtable')])).not.toContain(secret);
  });

  test('snapshots hostile connector cursor getters once before hashing, committing, and publishing status', async () => {
    const safeStore = new FakeSyncCommitStore(initialCursor);
    await createService({
      connector: createConnector(async () => successfulResult), syncCommitStore: safeStore,
    }).runIncremental('airtable').completion;

    const secret = 'connector-cursor-second-read-secret';
    const reads = { cursor: 0, updatedAt: 0, sourceRecordId: 0 };
    const hostileResult = Object.defineProperties({}, {
      counts: { value: successfulResult.counts, enumerable: true },
      cursor: hostileGetter(reads, 'cursor', Object.defineProperties({}, {
        updatedAt: hostileGetter(reads, 'updatedAt', nextCursor.updatedAt, 'malformed-second-read'),
        sourceRecordId: hostileGetter(reads, 'sourceRecordId', nextCursor.sourceRecordId, secret),
      }), { secret }),
      warnings: { value: successfulResult.warnings, enumerable: true },
    });
    const store = new FakeSyncCommitStore(initialCursor);
    const service = createService({
      connector: createConnector(async () => hostileResult as SyncResult), syncCommitStore: store,
    });

    const completed = await service.runIncremental('airtable').completion;

    expect(reads).toEqual({ cursor: 1, updatedAt: 1, sourceRecordId: 1 });
    expect(completed).toMatchObject({ status: 'completed', counts: successfulResult.counts });
    expect(store.commits[0]!.nextCursor).toEqual(nextCursor);
    expect(store.commits[0]!.idempotencyKey).toBe(safeStore.commits[0]!.idempotencyKey);
    expect(JSON.stringify([store.attempts, completed, service.getStatus('airtable')])).not.toContain(secret);
  });

  test('snapshots hostile connector warning getters once before hashing, committing, and publishing status', async () => {
    const safeStore = new FakeSyncCommitStore(initialCursor);
    await createService({
      connector: createConnector(async () => successfulResult), syncCommitStore: safeStore,
    }).runIncremental('airtable').completion;

    const secret = 'connector-warning-second-read-secret';
    const reads = { warnings: 0, code: 0, count: 0 };
    const hostileResult = Object.defineProperties({}, {
      counts: { value: successfulResult.counts, enumerable: true },
      cursor: { value: nextCursor, enumerable: true },
      warnings: hostileGetter(reads, 'warnings', [Object.defineProperties({}, {
        code: hostileGetter(reads, 'code', 'UNKNOWN_BRANCH', secret),
        count: hostileGetter(reads, 'count', 2, Number.NaN),
      })], { secret }),
    });
    const store = new FakeSyncCommitStore(initialCursor);
    const service = createService({
      connector: createConnector(async () => hostileResult as SyncResult), syncCommitStore: store,
    });

    const completed = await service.runIncremental('airtable').completion;

    expect(reads).toEqual({ warnings: 1, code: 1, count: 1 });
    expect(completed).toMatchObject({ status: 'completed', warnings: successfulResult.warnings });
    expect(store.commits[0]!.result.warnings).toEqual(successfulResult.warnings);
    expect(store.commits[0]!.idempotencyKey).toBe(safeStore.commits[0]!.idempotencyKey);
    expect(JSON.stringify([store.attempts, completed, service.getStatus('airtable')])).not.toContain(secret);
  });

  test('snapshots a hostile canonical commit outcome once before returning and publishing it', async () => {
    const secret = 'canonical-outcome-second-read-secret';
    const reads = {
      outcomeStatus: 0, terminalRun: 0, status: 0, integrationId: 0, runId: 0,
      startedAt: 0, completedAt: 0, counts: 0, fetched: 0, created: 0, updated: 0,
      skipped: 0, warnings: 0, code: 0, count: 0,
    };
    const terminalRun = Object.defineProperties({}, {
      status: hostileGetter(reads, 'status', 'completed', secret),
      integrationId: hostileGetter(reads, 'integrationId', 'airtable', secret),
      runId: hostileGetter(reads, 'runId', 'canonical-run', secret),
      startedAt: hostileGetter(reads, 'startedAt', '2026-07-12T01:00:00.000Z', secret),
      completedAt: hostileGetter(reads, 'completedAt', '2026-07-12T01:05:00.000Z', secret),
      counts: hostileGetter(reads, 'counts', Object.defineProperties({}, {
        fetched: hostileGetter(reads, 'fetched', 8, Number.NaN),
        created: hostileGetter(reads, 'created', 3, Number.NaN),
        updated: hostileGetter(reads, 'updated', 2, Number.NaN),
        skipped: hostileGetter(reads, 'skipped', 3, Number.NaN),
      }), { secret }),
      warnings: hostileGetter(reads, 'warnings', [Object.defineProperties({}, {
        code: hostileGetter(reads, 'code', 'UNKNOWN_BRANCH', secret),
        count: hostileGetter(reads, 'count', 2, Number.NaN),
      })], { secret }),
    });
    const store = {
      getCheckpoint: async () => initialCursor,
      commit: async () => Object.defineProperties({}, {
        status: hostileGetter(reads, 'outcomeStatus', 'committed', secret),
        completedRun: hostileGetter(reads, 'terminalRun', terminalRun, { secret }),
      }),
    } as unknown as SyncCommitStore;
    const service = createService({
      connector: createConnector(async () => successfulResult), syncCommitStore: store,
    });

    const completed = await service.runIncremental('airtable').completion;

    expect(reads).toEqual({
      outcomeStatus: 1, terminalRun: 1, status: 1, integrationId: 1, runId: 1,
      startedAt: 1, completedAt: 1, counts: 1, fetched: 1, created: 1, updated: 1,
      skipped: 1, warnings: 1, code: 1, count: 1,
    });
    expect(completed).toEqual({
      integrationId: 'airtable',
      runId: 'canonical-run',
      status: 'completed',
      startedAt: '2026-07-12T01:00:00.000Z',
      completedAt: '2026-07-12T01:05:00.000Z',
      counts: successfulResult.counts,
      warnings: successfulResult.warnings,
    });
    expect(service.getStatus('airtable')).toEqual(completed);
    expect(JSON.stringify([completed, service.getStatus('airtable')])).not.toContain(secret);
  });

  test('does not trust a canonical warnings array own map method', async () => {
    const secret = 'canonical-array-map-secret';
    let callbackInvoked = false;
    const hostileWarnings = [{ code: 'UNKNOWN_BRANCH', count: 2 }];
    Object.defineProperty(hostileWarnings, 'map', {
      configurable: true,
      get: () => (_callback: unknown) => {
        callbackInvoked = true;
        return [{ code: secret, count: Number.NaN }];
      },
    });
    const store = {
      getCheckpoint: async () => initialCursor,
      commit: async () => ({
        status: 'committed',
        completedRun: {
          integrationId: 'airtable',
          runId: 'canonical-run',
          status: 'completed',
          startedAt: '2026-07-12T01:00:00.000Z',
          completedAt: '2026-07-12T01:05:00.000Z',
          counts: successfulResult.counts,
          warnings: hostileWarnings,
        },
      }),
    } as unknown as SyncCommitStore;
    const service = createService({
      connector: createConnector(async () => successfulResult), syncCommitStore: store,
    });

    const completed = await service.runIncremental('airtable').completion;

    expect(completed).toMatchObject({ status: 'completed', warnings: successfulResult.warnings });
    expect(service.getStatus('airtable')).toMatchObject({
      status: 'completed', warnings: successfulResult.warnings,
    });
    expect(callbackInvoked).toBe(false);
    expect(JSON.stringify([completed, service.getStatus('airtable')])).not.toContain(secret);
    expect(JSON.stringify([completed, service.getStatus('airtable')])).not.toContain('NaN');
  });

  test('maps an invalid first snapshot of a commit outcome to a safe terminal failure', async () => {
    const secret = 'invalid-first-outcome-secret';
    const store = {
      getCheckpoint: async () => initialCursor,
      commit: async () => Object.defineProperties({}, {
        status: { get: () => secret, enumerable: true },
        completedRun: { get: () => successfulResult, enumerable: true },
      }),
    } as unknown as SyncCommitStore;
    const service = createService({
      connector: createConnector(async () => successfulResult), syncCommitStore: store,
    });

    const failed = await service.runIncremental('airtable').completion;

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'SYNC_COMMIT_FAILED' });
    expect(service.getStatus('airtable')).toEqual(failed);
    expect(JSON.stringify([failed, service.getStatus('airtable')])).not.toContain(secret);
  });

  test.each([
    ['NaN count', { ...successfulResult, counts: { ...successfulResult.counts, fetched: Number.NaN } }],
    ['infinite count', {
      ...successfulResult, counts: { ...successfulResult.counts, created: Number.POSITIVE_INFINITY },
    }],
    ['negative count', { ...successfulResult, counts: { ...successfulResult.counts, updated: -1 } }],
    ['unsafe count', {
      ...successfulResult, counts: { ...successfulResult.counts, skipped: Number.MAX_SAFE_INTEGER + 1 },
    }],
    ['missing counts', { cursor: nextCursor, warnings: [] }],
    ['non-array warnings', { ...successfulResult, warnings: { code: 'UNKNOWN_BRANCH', count: 1 } }],
    ['null warning', { ...successfulResult, warnings: [null] }],
    ['empty cursor field', { ...successfulResult, cursor: { ...nextCursor, sourceRecordId: '' } }],
    ['invalid cursor timestamp', { ...successfulResult, cursor: { ...nextCursor, updatedAt: 'invalid' } }],
    ['throwing warning getter', {
      ...successfulResult,
      warnings: [Object.defineProperty({}, 'code', {
        get: () => { throw new Error('provider getter secret'); },
      })],
    }],
  ])('safely rejects an invalid connector result with %s', async (_label, invalidResult) => {
    const store = new FakeSyncCommitStore(initialCursor);
    const service = createService({
      connector: createConnector(async () => invalidResult as unknown as SyncResult),
      syncCommitStore: store,
    });

    const failed = await service.runIncremental('airtable').completion;

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'INVALID_CONNECTOR_RESULT' });
    expect(JSON.stringify(failed)).not.toContain('provider getter secret');
    expect(store.attempts).toHaveLength(0);
    expect(service.getStatus('airtable')).toEqual(failed);
    await expect(service.runIncremental('airtable').completion).resolves.toMatchObject({
      status: 'failed', errorCode: 'INVALID_CONNECTOR_RESULT',
    });
  });

  test('reserves the active run synchronously and rejects a duplicate before any await', async () => {
    let release: ((result: SyncResult) => void) | undefined;
    const pending = new Promise<SyncResult>((resolve) => { release = resolve; });
    const service = createService({ connector: createConnector(async () => pending) });

    const first = service.runIncremental('airtable');

    expect(() => service.runIncremental('airtable')).toThrow(IntegrationSyncAlreadyRunningError);
    release?.(successfulResult);
    await first.completion;
  });

  test('returns idle before a run and defensive copies of the latest status afterwards', async () => {
    const service = createService({ connector: createConnector(async () => successfulResult) });

    expect(service.getStatus('airtable')).toEqual({ integrationId: 'airtable', status: 'idle' });
    await service.runIncremental('airtable').completion;
    const status = service.getStatus('airtable');
    if (status.status !== 'completed') throw new Error('expected completed status');
    (status.counts as { fetched: number }).fetched = 999;
    (status.warnings as Array<{ code: string; count: number }>)[0]!.code = 'MUTATED';

    expect(service.getStatus('airtable')).toMatchObject({
      runId: 'run-fixed',
      startedAt: '2026-07-12T01:00:00.000Z',
      completedAt: '2026-07-12T01:05:00.000Z',
      counts: { fetched: 8, created: 3, updated: 2, skipped: 3 },
      warnings: [{ code: 'UNKNOWN_BRANCH', count: 2 }],
    });
  });
});

class FakeSyncCommitStore implements SyncCommitStore {
  public readonly commits: AtomicSyncCommit[] = [];
  public readonly attempts: AtomicSyncCommit[] = [];
  public readonly canonicalRuns: AtomicSyncCommit['completedRun'][] = [];
  public readonly outcomeStatuses: Array<'committed' | 'already_committed'> = [];
  private readonly outcomes = new Map<string, AtomicSyncCommit['completedRun']>();
  private cursor: SyncCursor | undefined;

  public constructor(initial: SyncCursor | undefined, private readonly rejection?: string) {
    this.cursor = initial === undefined ? undefined : { ...initial };
  }

  public async getCheckpoint(_integrationId: string): Promise<SyncCursor | undefined> {
    return this.cursor === undefined ? undefined : { ...this.cursor };
  }

  public async commit(command: AtomicSyncCommit): Promise<SyncCommitOutcome> {
    if (this.rejection !== undefined) throw new Error(this.rejection);
    this.attempts.push(command);
    const existing = this.outcomes.get(command.idempotencyKey);
    if (existing !== undefined) {
      this.outcomeStatuses.push('already_committed');
      return { status: 'already_committed', completedRun: existing };
    }
    this.commits.push(command);
    this.cursor = command.nextCursor === undefined ? this.cursor : { ...command.nextCursor };
    this.outcomes.set(command.idempotencyKey, command.completedRun);
    this.canonicalRuns.push(command.completedRun);
    this.outcomeStatuses.push('committed');
    return { status: 'committed', completedRun: command.completedRun };
  }
}

function createService(overrides: {
  connector: IntegrationConnector;
  syncCommitStore?: SyncCommitStore;
  now?: () => Date;
  generateRunId?: () => string;
}): SyncService {
  const times = [
    new Date('2026-07-12T01:00:00.000Z'),
    new Date('2026-07-12T01:05:00.000Z'),
  ];
  return new SyncService(new IntegrationRegistry([overrides.connector]), {
    syncCommitStore: overrides.syncCommitStore ?? new FakeSyncCommitStore(undefined),
    now: overrides.now ?? (() => times.shift() ?? new Date('2026-07-12T01:05:00.000Z')),
    generateRunId: overrides.generateRunId ?? (() => 'run-fixed'),
  });
}

function createConnector(syncIncremental: IntegrationConnector['syncIncremental']): IntegrationConnector {
  return {
    id: 'airtable',
    healthCheck: async () => ({ status: 'healthy' }),
    syncIncremental,
    syncBackfill: async () => successfulResult,
  };
}

function hostileGetter(
  reads: Record<string, number>,
  key: string,
  first: unknown,
  second: unknown,
): PropertyDescriptor {
  return {
    enumerable: true,
    get: () => {
      reads[key] = (reads[key] ?? 0) + 1;
      return reads[key] === 1 ? first : second;
    },
  };
}

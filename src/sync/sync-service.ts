import { IntegrationRegistry } from '../integrations/registry.js';
import type {
  IntegrationConnector,
  SyncCounts,
  SyncCursor,
  SyncWarning,
} from '../integrations/types.js';
import type { AirtableSyncBatch } from '../integrations/airtable/connector.js';
import type { CheckpointStore } from './checkpoint-store.js';
import type { CrmRepository } from './crm-repository.js';

export const SafePublicWarningCodes = [
  'AMBIGUOUS_DOCUMENT_NUMBERS',
  'INVALID_DOCUMENT_DATE',
  'INVALID_REQUIRED_AMOUNT',
  'INVALID_SOURCE_UPDATED',
  'INVALID_TRANSACTION',
  'MISSING_BRANCH',
  'MISSING_DOCUMENT_NUMBER',
  'UNKNOWN_DOCUMENT_NUMBER',
  'UNKNOWN_BRANCH',
  'INTEGRATION_WARNING',
] as const;

export type SafePublicWarningCode = (typeof SafePublicWarningCodes)[number];

export const SyncFailureCodes = [
  'CHECKPOINT_READ_FAILED',
  'CONNECTOR_SYNC_FAILED',
  'INVALID_CONNECTOR_RESULT',
  'CLOCK_FAILED',
  'SYNC_COMMIT_FAILED',
] as const;

export type SyncFailureCode = (typeof SyncFailureCodes)[number];

interface SyncRunBase {
  readonly integrationId: string;
  readonly runId: string;
  readonly startedAt: string;
}

export interface RunningSyncRun extends SyncRunBase {
  readonly status: 'running';
}

export interface CompletedSyncRun extends SyncRunBase {
  readonly status: 'completed';
  readonly completedAt: string;
  readonly counts: SyncCounts;
  readonly warnings: readonly SyncWarning[];
}

export interface FailedSyncRun extends SyncRunBase {
  readonly status: 'failed';
  readonly completedAt: string;
  readonly errorCode: SyncFailureCode;
}

export interface IdleSyncStatus {
  readonly integrationId: string;
  readonly status: 'idle';
}

export type SyncRun = RunningSyncRun | CompletedSyncRun | FailedSyncRun;
export type IntegrationSyncStatus = IdleSyncStatus | SyncRun;

export interface SyncRunHandle {
  readonly run: RunningSyncRun;
  readonly completion: Promise<CompletedSyncRun | FailedSyncRun>;
}

export interface SyncServiceDependencies {
  readonly checkpointStore: CheckpointStore;
  readonly crmRepository: CrmRepository;
  readonly now: () => Date;
  readonly generateRunId: () => string;
}

export class IntegrationSyncAlreadyRunningError extends Error {
  public readonly integrationId: string;

  public constructor(integrationId: string) {
    super(`Integration sync already running: ${integrationId}`);
    this.name = 'IntegrationSyncAlreadyRunningError';
    this.integrationId = integrationId;
  }
}

export class SyncService {
  private readonly activeIntegrationIds = new Set<string>();
  private readonly latestRuns = new Map<string, SyncRun>();

  public constructor(
    private readonly registry: IntegrationRegistry,
    private readonly dependencies: SyncServiceDependencies,
  ) {}

  public runIncremental(integrationId: string): SyncRunHandle {
    const connector = this.registry.get(integrationId);
    if (this.activeIntegrationIds.has(integrationId)) {
      throw new IntegrationSyncAlreadyRunningError(integrationId);
    }

    const run: RunningSyncRun = {
      integrationId,
      runId: this.dependencies.generateRunId(),
      status: 'running',
      startedAt: this.dependencies.now().toISOString(),
    };
    this.activeIntegrationIds.add(integrationId);
    this.latestRuns.set(integrationId, copyRun(run));

    return {
      run: copyRun(run),
      completion: this.execute(connector, run),
    };
  }

  public getStatus(integrationId: string): IntegrationSyncStatus {
    this.registry.get(integrationId);
    const latest = this.latestRuns.get(integrationId);
    return latest === undefined
      ? { integrationId, status: 'idle' }
      : copyRun(latest);
  }

  private async execute(
    connector: IntegrationConnector,
    run: RunningSyncRun,
  ): Promise<CompletedSyncRun | FailedSyncRun> {
    try {
      let expectedCursor: SyncCursor | undefined;
      try {
        expectedCursor = await this.dependencies.checkpointStore.get(run.integrationId);
      } catch {
        return this.fail(run, 'CHECKPOINT_READ_FAILED');
      }

      if (connector.readIncrementalBatch === undefined) {
        return this.fail(run, 'CONNECTOR_SYNC_FAILED');
      }

      let batch: AirtableSyncBatch;
      try {
        batch = await connector.readIncrementalBatch(
          expectedCursor === undefined ? {} : { cursor: copyCursor(expectedCursor) },
        );
      } catch {
        return this.fail(run, 'CONNECTOR_SYNC_FAILED');
      }

      if (batch === null || typeof batch !== 'object' || !batch.sourceCounts) {
        return this.fail(run, 'INVALID_CONNECTOR_RESULT');
      }

      try {
        await this.dependencies.crmRepository.upsertTransactions(batch);
        await this.dependencies.crmRepository.upsertLeadsAndSizing(batch);
      } catch {
        return this.fail(run, 'SYNC_COMMIT_FAILED');
      }

      if (batch.cursor !== undefined) {
        try {
          await this.dependencies.checkpointStore.put(run.integrationId, batch.cursor);
        } catch {
          return this.fail(run, 'SYNC_COMMIT_FAILED');
        }
      }

      const completedAt = this.readTerminalTime();
      if (completedAt === undefined) {
        return this.fail(run, 'CLOCK_FAILED');
      }

      const { counts, warnings } = getSyncCountsAndWarnings(batch);

      const completed: CompletedSyncRun = {
        integrationId: run.integrationId,
        runId: run.runId,
        status: 'completed',
        startedAt: run.startedAt,
        completedAt,
        counts,
        warnings,
      };

      this.latestRuns.set(run.integrationId, copyRun(completed));
      return copyRun(completed);
    } finally {
      this.activeIntegrationIds.delete(run.integrationId);
    }
  }

  private readTerminalTime(): string | undefined {
    try {
      const value = this.dependencies.now();
      return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    } catch {
      return undefined;
    }
  }

  private fail(run: RunningSyncRun, errorCode: SyncFailureCode): FailedSyncRun {
    const failed: FailedSyncRun = {
      integrationId: run.integrationId,
      runId: run.runId,
      status: 'failed',
      startedAt: run.startedAt,
      completedAt: this.readTerminalTime() ?? run.startedAt,
      errorCode,
    };
    this.latestRuns.set(run.integrationId, failed);
    return copyRun(failed);
  }
}

function getSyncCountsAndWarnings(batch: AirtableSyncBatch): {
  counts: SyncCounts;
  warnings: readonly SyncWarning[];
} {
  const fetched = batch.sourceCounts.transactionRecordsFetched;
  const created = batch.sourceCounts.transactionRecordsSelected;
  const updated = 0;
  const skipped = Math.max(0, fetched - created);

  const countsByCode = new Map<SafePublicWarningCode, number>();
  for (const issue of batch.recordIssues || []) {
    const rawCode = issue.code;
    const code = typeof rawCode === 'string' && isSafePublicWarningCode(rawCode)
      ? rawCode
      : 'INTEGRATION_WARNING';
    countsByCode.set(code, (countsByCode.get(code) ?? 0) + 1);
  }

  const warnings = [...countsByCode]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([code, count]) => ({ code, count }));

  return {
    counts: { fetched, created, updated, skipped },
    warnings,
  };
}

function isSafePublicWarningCode(code: string): code is SafePublicWarningCode {
  return (SafePublicWarningCodes as readonly string[]).includes(code);
}

function copyRun<T extends SyncRun>(run: T): T {
  if (run.status === 'completed') {
    return {
      ...run,
      counts: copyCounts(run.counts),
      warnings: copyWarnings(run.warnings),
    } as T;
  }
  return { ...run };
}

function copyCursor(cursor: SyncCursor): SyncCursor {
  return { updatedAt: cursor.updatedAt, sourceRecordId: cursor.sourceRecordId };
}

function copyCounts(counts: SyncCounts): SyncCounts {
  return {
    fetched: counts.fetched,
    created: counts.created,
    updated: counts.updated,
    skipped: counts.skipped,
  };
}

function copyWarnings(warnings: readonly SyncWarning[]): readonly SyncWarning[] {
  return warnings.map((warning) => ({ code: warning.code, count: warning.count }));
}

import { createHash } from 'node:crypto';

import { IntegrationRegistry } from '../integrations/registry.js';
import type {
  IntegrationConnector,
  SyncCounts,
  SyncCursor,
  SyncResult,
  SyncWarning,
} from '../integrations/types.js';

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

export interface PersistedSyncResult {
  readonly integrationId: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly counts: SyncCounts;
  readonly warnings: readonly SyncWarning[];
}

export interface AtomicSyncCommit {
  readonly integrationId: string;
  readonly idempotencyKey: string;
  readonly expectedCursor?: SyncCursor;
  readonly nextCursor?: SyncCursor;
  readonly result: PersistedSyncResult;
  readonly completedRun: CompletedSyncRun;
}

export interface SyncCommitOutcome {
  readonly status: 'committed' | 'already_committed';
  readonly completedRun: CompletedSyncRun;
}

/**
 * Durable sync boundary. `commit` must first look up `idempotencyKey`; when it
 * exists, it returns the existing canonical terminal outcome without evaluating
 * CAS. Otherwise it compare-and-sets `expectedCursor`, atomically persists the
 * safe result, terminal run, and `nextCursor`, and returns the committed
 * canonical outcome. A rejection must expose no visible commit; an adapter with
 * an uncertain outcome must reconcile that same key before rejecting. Outcomes
 * outside the declared runtime shape violate the adapter contract and are
 * treated by the service as `SYNC_COMMIT_FAILED`.
 */
export interface SyncCommitStore {
  getCheckpoint(integrationId: string): Promise<SyncCursor | undefined>;
  commit(command: AtomicSyncCommit): Promise<SyncCommitOutcome>;
}

export interface SyncServiceDependencies {
  readonly syncCommitStore: SyncCommitStore;
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
        expectedCursor = await this.dependencies.syncCommitStore.getCheckpoint(run.integrationId);
      } catch {
        return this.fail(run, 'CHECKPOINT_READ_FAILED');
      }

      let connectorResult: SyncResult;
      try {
        connectorResult = await connector.syncIncremental(
          expectedCursor === undefined ? {} : { cursor: copyCursor(expectedCursor) },
        );
      } catch {
        return this.fail(run, 'CONNECTOR_SYNC_FAILED');
      }

      let safeConnectorResult: SafeConnectorResult;
      try {
        safeConnectorResult = normalizeConnectorResult(connectorResult);
      } catch {
        return this.fail(run, 'INVALID_CONNECTOR_RESULT');
      }

      const safeResult = projectPersistedResult(run, safeConnectorResult);
      const completedAt = this.readTerminalTime();
      if (completedAt === undefined) {
        return this.fail(run, 'CLOCK_FAILED');
      }

      const completed: CompletedSyncRun = {
        integrationId: run.integrationId,
        runId: run.runId,
        status: 'completed',
        startedAt: run.startedAt,
        completedAt,
        counts: copyCounts(safeResult.counts),
        warnings: copyWarnings(safeResult.warnings),
      };
      const command = createAtomicCommit(run.integrationId, expectedCursor, safeConnectorResult.cursor,
        safeResult, completed);

      let canonical: CompletedSyncRun;
      try {
        const outcome = await this.dependencies.syncCommitStore.commit(copyAtomicCommit(command));
        canonical = copyCommitOutcomeRun(outcome, run.integrationId);
      } catch {
        return this.fail(run, 'SYNC_COMMIT_FAILED');
      }

      this.latestRuns.set(run.integrationId, copyRun(canonical));
      return copyRun(canonical);
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

interface SafeConnectorResult {
  readonly cursor?: SyncCursor;
  readonly counts: SyncCounts;
  readonly warnings: readonly SyncWarning[];
}

function normalizeConnectorResult(result: unknown): SafeConnectorResult {
  if (result === null || typeof result !== 'object') {
    throw new TypeError('Invalid connector result');
  }
  const rawResult = result as {
    readonly counts?: unknown;
    readonly warnings?: unknown;
    readonly cursor?: unknown;
  };
  const rawCounts = rawResult.counts;
  const rawWarnings = rawResult.warnings;
  const rawCursor = rawResult.cursor;

  return {
    ...(rawCursor === undefined ? {} : { cursor: normalizeCursor(rawCursor) }),
    counts: normalizeCounts(rawCounts),
    warnings: normalizeConnectorWarnings(rawWarnings),
  };
}

function projectPersistedResult(
  run: RunningSyncRun,
  result: SafeConnectorResult,
): PersistedSyncResult {
  return {
    integrationId: run.integrationId,
    runId: run.runId,
    startedAt: run.startedAt,
    counts: copyCounts(result.counts),
    warnings: copyWarnings(result.warnings),
  };
}

function createAtomicCommit(
  integrationId: string,
  expectedCursor: SyncCursor | undefined,
  nextCursor: SyncCursor | undefined,
  result: PersistedSyncResult,
  completedRun: CompletedSyncRun,
): AtomicSyncCommit {
  const base = {
    integrationId,
    idempotencyKey: deriveIdempotencyKey(integrationId, expectedCursor, nextCursor, result),
    result: copyPersistedResult(result),
    completedRun: copyRun(completedRun),
  };
  return {
    ...base,
    ...(expectedCursor === undefined ? {} : { expectedCursor: copyCursor(expectedCursor) }),
    ...(nextCursor === undefined ? {} : { nextCursor: copyCursor(nextCursor) }),
  };
}

function deriveIdempotencyKey(
  integrationId: string,
  expectedCursor: SyncCursor | undefined,
  nextCursor: SyncCursor | undefined,
  result: PersistedSyncResult,
): string {
  const logicalCommit = [
    integrationId,
    cursorHashInput(expectedCursor),
    cursorHashInput(nextCursor),
    [result.counts.fetched, result.counts.created, result.counts.updated, result.counts.skipped],
    result.warnings.map((warning) => [warning.code, warning.count]),
  ];
  return createHash('sha256').update(JSON.stringify(logicalCommit)).digest('hex');
}

function normalizeConnectorWarnings(value: unknown): readonly SyncWarning[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid connector warnings');
  const countsByCode = new Map<SafePublicWarningCode, number>();
  for (const warning of value) {
    if (warning === null || typeof warning !== 'object') {
      throw new TypeError('Invalid connector warning');
    }
    const rawWarning = warning as { readonly code?: unknown; readonly count?: unknown };
    const rawCode = rawWarning.code;
    const rawCount = rawWarning.count;
    const hasSafeCount = isSafeCount(rawCount);
    const hasSafeCode = typeof rawCode === 'string' && isSafePublicWarningCode(rawCode);
    const code = hasSafeCode && hasSafeCount ? rawCode : 'INTEGRATION_WARNING';
    const count = hasSafeCount ? rawCount : 1;
    countsByCode.set(code, safeAdd(countsByCode.get(code) ?? 0, count));
  }
  return [...countsByCode]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([code, count]) => ({ code, count }));
}

function safeAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function cursorHashInput(cursor: SyncCursor | undefined): readonly [string, string] | null {
  return cursor === undefined ? null : [cursor.updatedAt, cursor.sourceRecordId];
}

function isSafePublicWarningCode(code: string): code is SafePublicWarningCode {
  return (SafePublicWarningCodes as readonly string[]).includes(code);
}

function copyCommitOutcomeRun(
  outcome: unknown,
  integrationId: string,
): CompletedSyncRun {
  if (outcome === null || typeof outcome !== 'object') {
    throw new TypeError('Invalid sync commit outcome');
  }
  const rawOutcome = outcome as { readonly status?: unknown; readonly completedRun?: unknown };
  const rawStatus = rawOutcome.status;
  const rawRun = rawOutcome.completedRun;
  if (rawStatus !== 'committed' && rawStatus !== 'already_committed') {
    throw new TypeError('Invalid sync commit outcome');
  }
  if (rawRun === null || typeof rawRun !== 'object') {
    throw new TypeError('Invalid canonical completed sync run');
  }
  const run = rawRun as {
    readonly status?: unknown;
    readonly integrationId?: unknown;
    readonly runId?: unknown;
    readonly startedAt?: unknown;
    readonly completedAt?: unknown;
    readonly counts?: unknown;
    readonly warnings?: unknown;
  };
  const status = run.status;
  const canonicalIntegrationId = run.integrationId;
  const runId = run.runId;
  const startedAt = run.startedAt;
  const completedAt = run.completedAt;
  const rawCounts = run.counts;
  const rawWarnings = run.warnings;

  if (status !== 'completed'
    || canonicalIntegrationId !== integrationId
    || !isNonemptyString(runId)
    || !isValidTimestamp(startedAt)
    || !isValidTimestamp(completedAt)) {
    throw new TypeError('Invalid canonical completed sync run');
  }
  return {
    integrationId: canonicalIntegrationId,
    runId,
    status,
    startedAt,
    completedAt,
    counts: normalizeCounts(rawCounts),
    warnings: normalizeCanonicalWarnings(rawWarnings),
  };
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidTimestamp(value: unknown): value is string {
  return isNonemptyString(value) && Number.isFinite(Date.parse(value));
}

function normalizeCounts(value: unknown): SyncCounts {
  if (value === null || typeof value !== 'object') throw new TypeError('Invalid sync counts');
  const counts = value as Partial<Record<keyof SyncCounts, unknown>>;
  const fetched = counts.fetched;
  const created = counts.created;
  const updated = counts.updated;
  const skipped = counts.skipped;
  if (!isSafeCount(fetched) || !isSafeCount(created)
    || !isSafeCount(updated) || !isSafeCount(skipped)) {
    throw new TypeError('Invalid sync counts');
  }
  return { fetched, created, updated, skipped };
}

function normalizeCursor(value: unknown): SyncCursor {
  if (value === null || typeof value !== 'object') throw new TypeError('Invalid connector cursor');
  const cursor = value as { readonly updatedAt?: unknown; readonly sourceRecordId?: unknown };
  const updatedAt = cursor.updatedAt;
  const sourceRecordId = cursor.sourceRecordId;
  if (!isValidTimestamp(updatedAt) || !isNonemptyString(sourceRecordId)) {
    throw new TypeError('Invalid connector cursor');
  }
  return { updatedAt, sourceRecordId };
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function normalizeCanonicalWarnings(value: unknown): readonly SyncWarning[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid canonical completed sync run');
  const warnings: SyncWarning[] = [];
  const length = value.length;
  for (let index = 0; index < length; index += 1) {
    const warning = value[index];
    if (warning === null || typeof warning !== 'object') {
      throw new TypeError('Invalid canonical completed sync run');
    }
    const rawWarning = warning as { readonly code?: unknown; readonly count?: unknown };
    const code = rawWarning.code;
    const count = rawWarning.count;
    if (typeof code !== 'string' || !isSafePublicWarningCode(code) || !isSafeCount(count)) {
      throw new TypeError('Invalid canonical completed sync run');
    }
    warnings.push({ code, count });
  }
  return warnings;
}

function copyAtomicCommit(command: AtomicSyncCommit): AtomicSyncCommit {
  return {
    integrationId: command.integrationId,
    idempotencyKey: command.idempotencyKey,
    ...(command.expectedCursor === undefined
      ? {} : { expectedCursor: copyCursor(command.expectedCursor) }),
    ...(command.nextCursor === undefined ? {} : { nextCursor: copyCursor(command.nextCursor) }),
    result: copyPersistedResult(command.result),
    completedRun: copyRun(command.completedRun),
  };
}

function copyPersistedResult(result: PersistedSyncResult): PersistedSyncResult {
  return {
    integrationId: result.integrationId,
    runId: result.runId,
    startedAt: result.startedAt,
    counts: copyCounts(result.counts),
    warnings: copyWarnings(result.warnings),
  };
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

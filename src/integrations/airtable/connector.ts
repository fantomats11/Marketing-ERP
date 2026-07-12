import type { BrandId, BranchId } from '../../domain/identity.js';
import { UtcTimestampSchema, type NormalizedTransaction } from '../../domain/transaction.js';
import type {
  BackfillSyncRequest,
  ConnectorHealthResult,
  IncrementalSyncRequest,
  IntegrationConnector,
  SyncCursor,
  SyncResult,
  SyncWindow,
} from '../types.js';
import type {
  AirtableRecord,
  AirtableRecordPage,
  ListRecordsRequest,
} from './client.js';
import {
  normalizeAirtableTransaction,
  type AirtableDocumentDescriptor,
  type AirtableRecordIssueCode,
  type AirtableRecordIssueSeverity,
  type AirtableTransactionFieldMap,
} from './mapping.js';

export interface AirtableReadClient {
  listRecords(request: ListRecordsRequest): Promise<AirtableRecordPage>;
}

export interface AirtableBaseConfig {
  readonly baseId: string;
  readonly brandId: BrandId;
  readonly transactionsTable: string;
  readonly transactionDetailsTable: string;
  readonly transactionDetailsSourceUpdatedAt: string;
  readonly transactionDetailTransactionLink: string;
  readonly fieldMap: AirtableTransactionFieldMap;
  readonly branches: Readonly<Record<string, BranchId>>;
}

export interface AirtableSourceKey {
  readonly baseId: string;
  readonly table: string;
  readonly recordId: string;
}

export interface AirtableNormalizedRecord {
  readonly sourceKey: AirtableSourceKey;
  readonly upsertKey: string;
  readonly transaction: NormalizedTransaction;
}

export interface AirtableSafeRecordIssue {
  readonly sourceKey: AirtableSourceKey;
  readonly severity: AirtableRecordIssueSeverity;
  readonly code: AirtableRecordIssueCode;
}

export interface AirtableOrderGroup {
  readonly orderGroupId: string;
  readonly sourceKey: AirtableSourceKey;
  readonly documents: readonly AirtableDocumentDescriptor[];
}

export interface AirtableDetailReference {
  readonly sourceKey: AirtableSourceKey;
  readonly linkedTransactionRecordIds: readonly string[];
}

export interface AirtableSyncBatch {
  readonly records: readonly AirtableNormalizedRecord[];
  readonly recordIssues: readonly AirtableSafeRecordIssue[];
  readonly orderGroups: readonly AirtableOrderGroup[];
  readonly detailReferences: readonly AirtableDetailReference[];
  readonly sourceCounts: {
    readonly transactionRecordsFetched: number;
    readonly transactionRecordsSelected: number;
    readonly transactionDetailRecordsFetched: number;
  };
  readonly checkpointBlocked: boolean;
  readonly cursor?: SyncCursor;
}

export interface AirtableConnectorOptions {
  readonly id: string;
  readonly client: AirtableReadClient;
  readonly bases: readonly AirtableBaseConfig[];
  readonly now?: () => Date;
  readonly hashCustomerReference?: (reference: string) => string;
}

export class AirtablePersistenceRequiredError extends Error {
  public readonly code = 'AIRTABLE_PERSISTENCE_REQUIRED';

  public constructor() {
    super('Airtable sync requires a durable record sink.');
    this.name = 'AirtablePersistenceRequiredError';
  }
}

export class AirtableRequestValidationError extends Error {
  public readonly code = 'AIRTABLE_INVALID_SYNC_REQUEST';

  public constructor() {
    super('Airtable sync request is invalid.');
    this.name = 'AirtableRequestValidationError';
  }
}

interface Candidate {
  readonly sourceKey: AirtableSourceKey;
  readonly upsertKey: string;
  readonly sourceUpdatedAt?: string;
  readonly documentDate?: string;
  readonly transaction?: NormalizedTransaction;
  readonly issue?: {
    readonly severity: AirtableRecordIssueSeverity;
    readonly code: AirtableRecordIssueCode;
  };
  readonly recognizedDocuments: readonly AirtableDocumentDescriptor[];
}

interface DetailCandidate {
  readonly reference: AirtableDetailReference;
  readonly sourceUpdatedAt?: string;
  readonly issue?: {
    readonly severity: AirtableRecordIssueSeverity;
    readonly code: AirtableRecordIssueCode;
  };
}

export class AirtableConnector implements IntegrationConnector {
  public readonly id: string;
  private readonly client: AirtableReadClient;
  private readonly bases: readonly AirtableBaseConfig[];
  private readonly now: () => Date;
  private readonly hashCustomerReference: ((reference: string) => string) | undefined;

  public constructor(options: AirtableConnectorOptions) {
    this.id = options.id;
    this.client = options.client;
    this.bases = options.bases;
    this.now = options.now ?? (() => new Date());
    this.hashCustomerReference = options.hashCustomerReference;
  }

  public async healthCheck(): Promise<ConnectorHealthResult> {
    if (this.bases.length === 0) {
      return { status: 'unconfigured' };
    }

    try {
      for (const base of this.bases) {
        await this.client.listRecords({
          baseId: base.baseId,
          table: base.transactionsTable,
          maxRecords: 1,
        });
        await this.client.listRecords({
          baseId: base.baseId,
          table: base.transactionDetailsTable,
          maxRecords: 1,
        });
      }
      return { status: 'healthy' };
    } catch {
      return { status: 'unavailable' };
    }
  }

  public async readIncrementalBatch(
    request: IncrementalSyncRequest,
  ): Promise<AirtableSyncBatch> {
    const cursor = validateCursor(request.cursor);
    return (await this.readBatch(cursor === undefined ? {} : { cursor })).batch;
  }

  public async syncIncremental(request: IncrementalSyncRequest): Promise<SyncResult> {
    void request;
    throw new AirtablePersistenceRequiredError();
  }

  public async syncBackfill(request: BackfillSyncRequest): Promise<SyncResult> {
    void request;
    throw new AirtablePersistenceRequiredError();
  }

  public async readBackfillBatch(request: BackfillSyncRequest): Promise<AirtableSyncBatch> {
    const window = validateWindow(request.window);
    return (await this.readBatch({}, window)).batch;
  }

  private async readBatch(request: IncrementalSyncRequest, window?: SyncWindow): Promise<{
    readonly batch: AirtableSyncBatch;
    readonly candidates: readonly Candidate[];
    readonly transactionDetails: number;
    readonly detailCandidates: readonly DetailCandidate[];
  }> {
    const ingestedAt = this.now().toISOString();
    const candidates: Candidate[] = [];
    const detailCandidates: DetailCandidate[] = [];
    let transactionDetails = 0;

    for (const base of this.bases) {
      const transactionFilter = window === undefined
        ? incrementalFormula(base.fieldMap.sourceUpdatedAt, request.cursor?.updatedAt)
        : windowFormula(base.fieldMap.documentDate, window);
      const detailFilter = window === undefined
        ? incrementalFormula(base.transactionDetailsSourceUpdatedAt, request.cursor?.updatedAt)
        : undefined;
      const transactionRecords = await this.readAllPages(
        base.baseId,
        base.transactionsTable,
        transactionFilter,
      );
      for (const record of transactionRecords) {
        candidates.push(createCandidate(
          record,
          base,
          ingestedAt,
          this.hashCustomerReference,
        ));
      }

      const detailRecords = await this.readAllPages(
        base.baseId,
        base.transactionDetailsTable,
        detailFilter,
      );
      transactionDetails += detailRecords.length;
      detailCandidates.push(...detailRecords.map((record) => createDetailCandidate(record, base)));
    }

    const selected = candidates
      .filter((candidate) => (
        window === undefined
          ? isAfterCursor(candidate, request.cursor)
          : isInBackfillWindow(candidate, window)
      ))
      .sort(compareCandidates);
    const selectedDetails = detailCandidates.filter((candidate) => (
      window === undefined
        ? isDetailAfterCursor(candidate, request.cursor)
        : isDetailLinkedToSelectedTransaction(candidate, selected)
    ));
    const checkpointBlocked = window === undefined && (
      selected.some((candidate) => candidate.issue?.code === 'INVALID_SOURCE_UPDATED')
      || selectedDetails.some((candidate) => (
        candidate.issue?.code === 'INVALID_DETAIL_SOURCE_UPDATED'
      ))
    );
    const cursor = window === undefined
      ? (checkpointBlocked ? request.cursor : latestCursor(selected))
      : undefined;
    const batch = batchFromCandidates(selected, selectedDetails, candidates.length, transactionDetails, {
      checkpointBlocked,
      ...(cursor === undefined ? {} : { cursor }),
    });

    return {
      batch,
      candidates,
      transactionDetails,
      detailCandidates,
    };
  }

  private async readAllPages(
    baseId: string,
    table: string,
    filterByFormula?: string,
  ): Promise<readonly AirtableRecord[]> {
    const records: AirtableRecord[] = [];
    const seenOffsets = new Set<string>();
    let offset: string | undefined;

    do {
      const page = await this.client.listRecords({
        baseId,
        table,
        ...(filterByFormula === undefined ? {} : { filterByFormula }),
        ...(offset === undefined ? {} : { offset }),
      });
      records.push(...page.records);
      offset = page.offset;
      if (offset !== undefined) {
        if (seenOffsets.has(offset)) {
          throw new Error('Airtable pagination returned a repeated offset');
        }
        seenOffsets.add(offset);
      }
    } while (offset !== undefined);

    return records;
  }
}

function createCandidate(
  record: AirtableRecord,
  base: AirtableBaseConfig,
  ingestedAt: string,
  hashCustomerReference?: (reference: string) => string,
): Candidate {
  const sourceKey = {
    baseId: base.baseId,
    table: base.transactionsTable,
    recordId: record.id,
  };
  const upsertKey = createUpsertKey(sourceKey);
  const result = normalizeAirtableTransaction(
    record,
    { ...base, ...(hashCustomerReference === undefined ? {} : { hashCustomerReference }) },
    ingestedAt,
  );
  return {
    sourceKey,
    upsertKey,
    ...(result.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: result.sourceUpdatedAt }),
    ...(result.documentDate === undefined ? {} : { documentDate: result.documentDate }),
    ...(result.transaction === undefined ? {} : { transaction: result.transaction }),
    ...(result.issue === undefined ? {} : { issue: result.issue }),
    recognizedDocuments: result.recognizedDocuments,
  };
}

function createDetailCandidate(
  record: AirtableRecord,
  base: AirtableBaseConfig,
): DetailCandidate {
  const linkedValue = record.fields[base.transactionDetailTransactionLink];
  const linkedTransactionRecordIds = (Array.isArray(linkedValue) ? linkedValue : [linkedValue])
    .flatMap((value) => {
      if (typeof value !== 'string' || value.trim() === '') {
        return [];
      }
      return [value.trim()];
    });
  const rawUpdatedAt = record.fields[base.transactionDetailsSourceUpdatedAt];
  const sourceUpdatedAt = normalizeSourceTimestamp(rawUpdatedAt);
  return {
    reference: {
      sourceKey: {
        baseId: base.baseId,
        table: base.transactionDetailsTable,
        recordId: record.id,
      },
      linkedTransactionRecordIds: [...new Set(linkedTransactionRecordIds)].sort(),
    },
    ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
    ...(sourceUpdatedAt === undefined ? {
      issue: {
        severity: 'error' as const,
        code: 'INVALID_DETAIL_SOURCE_UPDATED' as const,
      },
    } : {}),
  };
}

function createUpsertKey(sourceKey: AirtableSourceKey): string {
  return [sourceKey.baseId, sourceKey.table, sourceKey.recordId]
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function isAfterCursor(candidate: Candidate, cursor: SyncCursor | undefined): boolean {
  if (cursor === undefined || candidate.sourceUpdatedAt === undefined) {
    return true;
  }
  return candidate.sourceUpdatedAt >= cursor.updatedAt;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  const timeOrder = (left.sourceUpdatedAt ?? '').localeCompare(right.sourceUpdatedAt ?? '');
  return timeOrder === 0 ? left.upsertKey.localeCompare(right.upsertKey) : timeOrder;
}

function latestCursor(candidates: readonly Candidate[]): SyncCursor | undefined {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]!;
    if (candidate.sourceUpdatedAt !== undefined) {
      return {
        updatedAt: candidate.sourceUpdatedAt,
        sourceRecordId: candidate.upsertKey,
      };
    }
  }
  return undefined;
}

function batchFromCandidates(
  candidates: readonly Candidate[],
  detailCandidates: readonly DetailCandidate[],
  transactionRecordsFetched: number,
  transactionDetailRecordsFetched: number,
  options: Pick<AirtableSyncBatch, 'checkpointBlocked' | 'cursor'> = { checkpointBlocked: false },
): AirtableSyncBatch {
  const records = candidates.flatMap((candidate): AirtableNormalizedRecord[] => (
    candidate.transaction === undefined
      ? []
      : [{
          sourceKey: candidate.sourceKey,
          upsertKey: candidate.upsertKey,
          transaction: candidate.transaction,
        }]
  ));
  const recordIssues = [
    ...candidates.flatMap((candidate): AirtableSafeRecordIssue[] => (
    candidate.issue === undefined
      ? []
      : [{ sourceKey: candidate.sourceKey, ...candidate.issue }]
    )),
    ...detailCandidates.flatMap((candidate): AirtableSafeRecordIssue[] => (
      candidate.issue === undefined
        ? []
        : [{ sourceKey: candidate.reference.sourceKey, ...candidate.issue }]
    )),
  ];
  const orderGroups = candidates.flatMap((candidate): AirtableOrderGroup[] => (
    candidate.recognizedDocuments.length === 0
      ? []
      : [{
          orderGroupId: candidate.upsertKey,
          sourceKey: candidate.sourceKey,
          documents: candidate.recognizedDocuments,
        }]
  ));
  return {
    records,
    recordIssues,
    orderGroups,
    detailReferences: detailCandidates
      .filter(({ reference }) => reference.linkedTransactionRecordIds.length > 0)
      .map(({ reference }) => reference),
    sourceCounts: {
      transactionRecordsFetched,
      transactionRecordsSelected: candidates.length,
      transactionDetailRecordsFetched,
    },
    checkpointBlocked: options.checkpointBlocked,
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
  };
}

function normalizeSourceTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

function isDetailAfterCursor(candidate: DetailCandidate, cursor: SyncCursor | undefined): boolean {
  return cursor === undefined
    || candidate.sourceUpdatedAt === undefined
    || candidate.sourceUpdatedAt >= cursor.updatedAt;
}

function isDetailLinkedToSelectedTransaction(
  detail: DetailCandidate,
  selectedTransactions: readonly Candidate[],
): boolean {
  return detail.reference.linkedTransactionRecordIds.some((transactionRecordId) => (
    selectedTransactions.some((transaction) => (
      transaction.sourceKey.baseId === detail.reference.sourceKey.baseId
      && transaction.sourceKey.recordId === transactionRecordId
    ))
  ));
}

function isInBackfillWindow(candidate: Candidate, window: SyncWindow): boolean {
  return candidate.documentDate !== undefined
    && candidate.documentDate >= window.startsAt
    && candidate.documentDate <= window.endsAt;
}

function validateCursor(cursor: SyncCursor | undefined): SyncCursor | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  return {
    updatedAt: validateTimestamp(cursor.updatedAt),
    sourceRecordId: cursor.sourceRecordId,
  };
}

function validateWindow(window: SyncWindow): SyncWindow {
  const startsAt = validateTimestamp(window.startsAt);
  const endsAt = validateTimestamp(window.endsAt);
  if (startsAt > endsAt) {
    throw new AirtableRequestValidationError();
  }
  return { startsAt, endsAt };
}

function validateTimestamp(value: string): string {
  if (!UtcTimestampSchema.safeParse(value).success) {
    throw new AirtableRequestValidationError();
  }
  return new Date(value).toISOString();
}

function incrementalFormula(fieldName: string, timestamp: string | undefined): string | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  const field = formulaField(fieldName);
  const boundary = `DATETIME_PARSE('${timestamp}')`;
  return `OR(${field}=BLANK(),IFERROR(OR(IS_AFTER(${field},${boundary}),IS_SAME(${field},${boundary})),TRUE()))`;
}

function windowFormula(fieldName: string, window: SyncWindow): string {
  const field = formulaField(fieldName);
  return `AND(${field}>=DATETIME_PARSE('${window.startsAt}'),${field}<=DATETIME_PARSE('${window.endsAt}'))`;
}

function formulaField(fieldName: string): string {
  if (fieldName.trim() !== fieldName
    || fieldName === ''
    || /[{}\u0000-\u001f\u007f]/u.test(fieldName)) {
    throw new AirtableRequestValidationError();
  }
  return `{${fieldName}}`;
}

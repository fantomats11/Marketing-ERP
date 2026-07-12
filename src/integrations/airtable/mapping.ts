import type { BrandId, BranchId, DocumentKind } from '../../domain/identity.js';
import { classifyDocumentNumber } from '../../domain/identity.js';
import {
  NormalizedTransactionSchema,
  type NormalizedTransaction,
  type TransactionAmounts,
} from '../../domain/transaction.js';
import type { AirtableRecord } from './client.js';

export interface AirtableTransactionFieldMap {
  readonly documentNumbers: readonly string[];
  readonly documentDate: string;
  readonly branchId: string;
  readonly amounts: Readonly<Record<keyof TransactionAmounts, string>>;
  readonly sourceUpdatedAt: string;
  readonly destination: string;
  readonly paidAt?: string;
  readonly customerReference?: string;
}

export interface AirtableTransactionMappingConfig {
  readonly baseId: string;
  readonly brandId: BrandId;
  readonly transactionsTable: string;
  readonly fieldMap: AirtableTransactionFieldMap;
  readonly branches: Readonly<Record<string, BranchId>>;
  readonly hashCustomerReference?: (reference: string) => string;
}

export type AirtableRecordIssueCode =
  | 'CUSTOMER_REFERENCE_HASH_FAILED'
  | 'INVALID_DOCUMENT_DATE'
  | 'INVALID_DETAIL_SOURCE_UPDATED'
  | 'INVALID_REQUIRED_AMOUNT'
  | 'INVALID_SOURCE_UPDATED'
  | 'INVALID_TRANSACTION'
  | 'MISSING_BRANCH'
  | 'MISSING_DOCUMENT_NUMBER'
  | 'MIXED_DOCUMENT_AMOUNTS_UNALLOCATED'
  | 'UNKNOWN_DOCUMENT_NUMBER'
  | 'UNKNOWN_BRANCH';

export type AirtableRecordIssueSeverity = 'warning' | 'error';

export interface AirtableMappingIssue {
  readonly code: AirtableRecordIssueCode;
  readonly severity: AirtableRecordIssueSeverity;
}

export interface AirtableMappingResult {
  readonly sourceUpdatedAt?: string;
  readonly documentDate?: string;
  readonly transaction?: NormalizedTransaction;
  readonly issue?: AirtableMappingIssue;
  readonly recognizedDocuments: readonly AirtableDocumentDescriptor[];
}

export interface AirtableDocumentDescriptor {
  readonly documentNumber: string;
  readonly documentKind: Exclude<DocumentKind, 'unknown'>;
}

const amountNames = [
  'grossAmount',
  'discountAmount',
  'netBeforeVat',
  'vatAmount',
  'documentTotal',
  'cashCollected',
  'depositAmount',
  'refundAmount',
] as const satisfies readonly (keyof TransactionAmounts)[];

// At 2 ** 43 baht, JSON numbers can already collapse a third decimal into a
// different two-decimal value. Require strings at and above this boundary.
const MAX_SAFE_NUMERIC_BAHT = 2 ** 43;

export function convertBahtToSatang(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Invalid baht amount');
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)
      || value < 0
      || value >= MAX_SAFE_NUMERIC_BAHT
      || Number(value.toFixed(2)) !== value) {
      throw new Error('Invalid baht amount');
    }
    return decimalStringToSatang(value.toFixed(2));
  }

  return decimalStringToSatang(value);
}

function decimalStringToSatang(decimal: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal);
  if (match === null) {
    throw new Error('Invalid baht amount');
  }

  const whole = BigInt(match[1]!);
  const fractional = BigInt((match[2] ?? '').padEnd(2, '0'));
  const satang = whole * 100n + fractional;
  if (satang > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid baht amount');
  }

  return Number(satang);
}

export function normalizeAirtableTransaction(
  record: AirtableRecord,
  config: AirtableTransactionMappingConfig,
  ingestedAt: string,
): AirtableMappingResult {
  const snapshot = new PrivateSourceSnapshot(record.fields);
  const sourceUpdatedAt = utcTimestamp(snapshot.read(config.fieldMap.sourceUpdatedAt));
  const documentDate = utcTimestamp(snapshot.read(config.fieldMap.documentDate));
  if (sourceUpdatedAt === undefined) {
    return issue('INVALID_SOURCE_UPDATED', undefined, 'error', documentDate);
  }
  if (documentDate === undefined) {
    return issue('INVALID_DOCUMENT_DATE', sourceUpdatedAt);
  }

  const documentNumber = selectRecognizedDocumentNumber(
    config.fieldMap.documentNumbers.map((field) => snapshot.read(field)),
  );
  if (documentNumber.issue !== undefined) {
    return issue(
      documentNumber.issue,
      sourceUpdatedAt,
      'error',
      documentDate,
      documentNumber.documents,
    );
  }

  const rawBranch = nonEmptyString(snapshot.read(config.fieldMap.branchId));
  if (rawBranch === undefined) {
    return issue('MISSING_BRANCH', sourceUpdatedAt, 'error', documentDate);
  }

  const branchId = config.branches[rawBranch];
  if (branchId === undefined) {
    return issue('UNKNOWN_BRANCH', sourceUpdatedAt, 'warning', documentDate);
  }

  const amounts = mapAmounts(snapshot, config.fieldMap);
  if (amounts === undefined) {
    return issue('INVALID_REQUIRED_AMOUNT', sourceUpdatedAt, 'error', documentDate);
  }

  const paidAt = config.fieldMap.paidAt === undefined
    ? undefined
    : utcTimestamp(snapshot.read(config.fieldMap.paidAt));
  const destination = nonEmptyString(snapshot.read(config.fieldMap.destination));
  const customerReferenceHash = mapCustomerReference(snapshot, config);
  if (customerReferenceHash === null) {
    return issue(
      'CUSTOMER_REFERENCE_HASH_FAILED',
      sourceUpdatedAt,
      'error',
      documentDate,
      documentNumber.documents,
    );
  }

  const parsed = NormalizedTransactionSchema.safeParse({
    sourceId: record.id,
    sourceBaseId: config.baseId,
    orderGroupId: createAirtableOrderGroupId(config.baseId, config.transactionsTable, record.id),
    brandId: config.brandId,
    branchId,
    documentNumber: documentNumber.value,
    documentKind: classifyDocumentNumber(documentNumber.value),
    documentDate,
    ...(paidAt === undefined ? {} : { paidAt }),
    currency: 'THB',
    ...(customerReferenceHash === undefined ? {} : { customerReferenceHash }),
    amounts,
    ...(destination === undefined ? {} : { destination }),
    sourceUpdatedAt,
    ingestedAt,
  });

  return parsed.success
    ? {
        sourceUpdatedAt,
        documentDate,
        transaction: parsed.data,
        recognizedDocuments: documentNumber.documents,
      }
    : issue(
        'INVALID_TRANSACTION',
        sourceUpdatedAt,
        'error',
        documentDate,
        documentNumber.documents,
      );
}

export function createAirtableOrderGroupId(
  baseId: string,
  table: string,
  recordId: string,
): string {
  return [baseId, table, recordId].map((part) => encodeURIComponent(part)).join('/');
}

class PrivateSourceSnapshot {
  readonly #fields: Readonly<Record<string, unknown>>;

  public constructor(fields: Readonly<Record<string, unknown>>) {
    this.#fields = fields;
  }

  public read(name: string): unknown {
    return this.#fields[name];
  }
}

function mapAmounts(
  snapshot: PrivateSourceSnapshot,
  fieldMap: AirtableTransactionFieldMap,
): TransactionAmounts | undefined {
  const amounts: Partial<Record<keyof TransactionAmounts, number>> = {};
  try {
    for (const name of amountNames) {
      amounts[name] = convertBahtToSatang(snapshot.read(fieldMap.amounts[name]));
    }
  } catch {
    return undefined;
  }

  return amounts as TransactionAmounts;
}

function utcTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

function selectRecognizedDocumentNumber(
  values: readonly unknown[],
): {
  readonly value: string;
  readonly documents: readonly AirtableDocumentDescriptor[];
  readonly issue?: never;
} | {
  readonly value?: never;
  readonly documents: readonly AirtableDocumentDescriptor[];
  readonly issue: Extract<AirtableRecordIssueCode,
    | 'MISSING_DOCUMENT_NUMBER'
    | 'MIXED_DOCUMENT_AMOUNTS_UNALLOCATED'
    | 'UNKNOWN_DOCUMENT_NUMBER'>;
} {
  const candidates = values.flatMap((value) => {
    const candidate = nonEmptyString(value);
    return candidate === undefined ? [] : [candidate];
  });
  if (candidates.length === 0) {
    return { issue: 'MISSING_DOCUMENT_NUMBER', documents: [] };
  }

  const recognized = [...new Set(candidates)].flatMap((documentNumber) => {
    const documentKind = classifyDocumentNumber(documentNumber);
    return documentKind === 'unknown'
      ? []
      : [{ documentNumber, documentKind } satisfies AirtableDocumentDescriptor];
  }).sort((left, right) => left.documentNumber.localeCompare(right.documentNumber));
  if (recognized.length === 0) {
    return { issue: 'UNKNOWN_DOCUMENT_NUMBER', documents: [] };
  }
  if (recognized.length > 1) {
    return { issue: 'MIXED_DOCUMENT_AMOUNTS_UNALLOCATED', documents: recognized };
  }
  return { value: recognized[0]!.documentNumber, documents: recognized };
}

function mapCustomerReference(
  snapshot: PrivateSourceSnapshot,
  config: AirtableTransactionMappingConfig,
): string | undefined | null {
  const fieldName = config.fieldMap.customerReference;
  if (fieldName === undefined) {
    return undefined;
  }
  const reference = stableCustomerReference(snapshot.read(fieldName));
  if (reference === undefined) {
    return undefined;
  }
  if (config.hashCustomerReference === undefined) {
    return null;
  }
  try {
    const hash = config.hashCustomerReference(reference);
    return typeof hash !== 'string'
      || !/^[a-f0-9]{64}$/u.test(hash)
      || hash === reference
      ? null
      : hash;
  } catch {
    return null;
  }
}

function stableCustomerReference(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return nonEmptyString(value);
  }
  if (!Array.isArray(value) || value.length !== 1) {
    return undefined;
  }
  return nonEmptyString(value[0]);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function issue(
  code: AirtableRecordIssueCode,
  sourceUpdatedAt?: string,
  severity: AirtableRecordIssueSeverity = 'error',
  documentDate?: string,
  recognizedDocuments: readonly AirtableDocumentDescriptor[] = [],
): AirtableMappingResult {
  return {
    ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
    ...(documentDate === undefined ? {} : { documentDate }),
    issue: { code, severity },
    recognizedDocuments,
  };
}

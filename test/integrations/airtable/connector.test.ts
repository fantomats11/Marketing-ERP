import { readFileSync } from 'node:fs';

import { describe, expect, test, vi } from 'vitest';

import type {
  AirtableRecord,
  AirtableRecordPage,
  ListRecordsRequest,
} from '../../../src/integrations/airtable/client.js';
import {
  AirtableConnector,
  AirtablePersistenceRequiredError,
  AirtableRequestValidationError,
  type AirtableBaseConfig,
  type AirtableReadClient,
} from '../../../src/integrations/airtable/connector.js';
import { convertBahtToSatang } from '../../../src/integrations/airtable/mapping.js';
import type { IntegrationConnector } from '../../../src/integrations/types.js';

interface FixturePage extends AirtableRecordPage {
  readonly baseId: string;
  readonly table: string;
  readonly nextOffset?: string;
}

interface Fixture {
  readonly bases: readonly AirtableBaseConfig[];
  readonly pages: readonly FixturePage[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/airtable-transactions.json', import.meta.url), 'utf8'),
) as Fixture;

function fixtureClient(): AirtableReadClient & { listRecords: ReturnType<typeof vi.fn> } {
  const listRecords = vi.fn(async (request: ListRecordsRequest): Promise<AirtableRecordPage> => {
    const page = fixture.pages.find((candidate) => candidate.baseId === request.baseId
      && candidate.table === request.table
      && candidate.offset === request.offset);
    if (page === undefined) {
      throw new Error(`Missing sanitized fixture page for ${request.baseId}/${request.table}`);
    }

    return {
      records: recordsMatchingFormula(page.records, request.filterByFormula),
      ...(page.nextOffset === undefined ? {} : { offset: page.nextOffset }),
    };
  });
  return { listRecords };
}

const rentBase = fixture.bases[0]!;

const validRentFields: Readonly<Record<string, unknown>> = {
  rental_doc: 'RE-9001',
  sale_doc: '',
  document_date: '2026-07-10T03:00:00Z',
  branch_code: 'R9',
  gross_baht: '500',
  discount_baht: '0',
  before_vat_baht: '500',
  vat_baht: '35',
  total_baht: '535',
  cash_baht: '535',
  deposit_baht: '0',
  refund_baht: '0',
  source_modified: '2026-07-10T06:00:00Z',
  destination_text: 'Rama 9',
};

function record(
  id: string,
  overrides: Readonly<Record<string, unknown>> = {},
): AirtableRecord {
  return { id, fields: { ...validRentFields, ...overrides } };
}

function recordsClient(
  transactionRecords: readonly AirtableRecord[],
  detailRecords: readonly AirtableRecord[] = [],
): AirtableReadClient & { listRecords: ReturnType<typeof vi.fn> } {
  const listRecords = vi.fn(async (request: ListRecordsRequest): Promise<AirtableRecordPage> => {
    const records = request.table === rentBase.transactionsTable
      ? transactionRecords
      : detailRecords;
    return { records: recordsMatchingFormula(records, request.filterByFormula) };
  });
  return { listRecords };
}

function recordsMatchingFormula(
  records: readonly AirtableRecord[],
  filterByFormula: string | undefined,
): readonly AirtableRecord[] {
  if (filterByFormula === undefined) {
    return records;
  }
  const fieldName = /\{([^}]+)\}/u.exec(filterByFormula)?.[1];
  const timestamps = [...filterByFormula.matchAll(/DATETIME_PARSE\('([^']+)'\)/gu)]
    .map(([, timestamp]) => Date.parse(timestamp!));
  if (fieldName === undefined || timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
    throw new Error(`Unsupported Airtable filter formula: ${filterByFormula}`);
  }
  const acceptsBlankAndErrors = filterByFormula.includes('=BLANK()')
    && filterByFormula.includes('IFERROR(');
  return records.filter((record) => {
    const rawTimestamp = record.fields[fieldName];
    const timestamp = typeof rawTimestamp === 'string' ? Date.parse(rawTimestamp) : Number.NaN;
    if (!Number.isFinite(timestamp)) {
      return acceptsBlankAndErrors;
    }
    return filterByFormula.startsWith('AND(')
      ? timestamp >= timestamps[0]! && timestamp <= timestamps[1]!
      : timestamp >= timestamps[0]!;
  });
}

function rentConnector(client: AirtableReadClient): AirtableConnector {
  return new AirtableConnector({
    id: 'airtable',
    client,
    bases: [rentBase],
    now: () => new Date('2026-07-12T00:00:00Z'),
  });
}

describe('convertBahtToSatang', () => {
  test.each([
    ['0', 0],
    ['1234.50', 123_450],
    [800.25, 80_025],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])('converts validated baht decimal %p to integer satang', (input, expected) => {
    expect(convertBahtToSatang(input)).toBe(expected);
  });

  test('rejects JSON numeric amounts at the conservative 2**43 baht cutoff', () => {
    const parsed = JSON.parse('{"amount":8796093022208.009}').amount as number;

    expect(parsed).toBe(8796093022208.01);
    expect(() => convertBahtToSatang(parsed)).toThrowError('Invalid baht amount');
    expect(() => convertBahtToSatang(2 ** 43)).toThrowError('Invalid baht amount');
  });

  test.each([
    '1.001',
    '-1',
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '90071992547409.92',
    JSON.parse('{"amount":90071992547409.91}').amount,
    JSON.parse('{"amount":35184372088731.001}').amount,
    '',
  ])('rejects invalid, negative, non-finite, or unsafe input %p', (input) => {
    expect(() => convertBahtToSatang(input)).toThrowError('Invalid baht amount');
  });
});

describe('AirtableConnector', () => {
  test('paginates both tables and returns explicitly mapped normalized transactions', async () => {
    const client = fixtureClient();
    const connector = new AirtableConnector({
      id: 'airtable',
      client,
      bases: fixture.bases,
      now: () => new Date('2026-07-12T00:00:00Z'),
    });

    const batch = await connector.readIncrementalBatch({});

    expect(client.listRecords).toHaveBeenCalledTimes(6);
    expect(client.listRecords).toHaveBeenCalledWith(expect.objectContaining({
      baseId: 'appFixtureRent', table: 'Transactions', offset: 'rent-page-2',
    }));
    expect(client.listRecords).toHaveBeenCalledWith(expect.objectContaining({
      baseId: 'appFixtureMall', table: 'Transaction Detail', offset: 'mall-detail-page-2',
    }));
    expect(batch.sourceCounts).toEqual({
      transactionRecordsFetched: 4,
      transactionRecordsSelected: 4,
      transactionDetailRecordsFetched: 3,
    });
    expect(batch.records).toHaveLength(2);
    expect(batch.records[0]).toMatchObject({
      sourceKey: {
        baseId: 'appFixtureRent', table: 'Transactions', recordId: 'rec-rent-sale',
      },
      upsertKey: 'appFixtureRent/Transactions/rec-rent-sale',
      transaction: {
        sourceId: 'rec-rent-sale',
        sourceBaseId: 'appFixtureRent',
        orderGroupId: 'appFixtureRent/Transactions/rec-rent-sale',
        brandId: 'rent-a-coat',
        branchId: 'rac-rama9',
        documentNumber: 'CA-1001',
        documentKind: 'sale',
        documentDate: '2026-07-09T19:00:00.000Z',
        paidAt: '2026-07-09T20:00:00.000Z',
        destination: 'Hokkaido',
        amounts: {
          grossAmount: 123_450,
          discountAmount: 3_450,
          netBeforeVat: 120_000,
          vatAmount: 8_400,
          documentTotal: 128_400,
          cashCollected: 128_400,
          depositAmount: 20_000,
          refundAmount: 0,
        },
      },
    });
    expect(batch.records[1]).toMatchObject({
      transaction: {
        brandId: 'go-mall',
        branchId: 'gomall-rama9',
        documentKind: 'rental',
        destination: 'Seoul',
        amounts: { grossAmount: 80_025, documentTotal: 80_277 },
      },
    });
    expect(batch.orderGroups).toContainEqual({
      orderGroupId: 'appFixtureRent/Transactions/rec-rent-sale',
      sourceKey: {
        baseId: 'appFixtureRent', table: 'Transactions', recordId: 'rec-rent-sale',
      },
      documents: [{ documentNumber: 'CA-1001', documentKind: 'sale' }],
    });
  });

  test('quarantines unknown branches and invalid required amounts without inferring or zeroing', async () => {
    const connector = new AirtableConnector({
      id: 'airtable', client: fixtureClient(), bases: fixture.bases,
      now: () => new Date('2026-07-12T00:00:00Z'),
    });

    const batch = await connector.readIncrementalBatch({});

    expect(batch.recordIssues).toEqual([
      {
        sourceKey: {
          baseId: 'appFixtureRent', table: 'Transactions', recordId: 'rec-unknown-branch',
        },
        severity: 'warning',
        code: 'UNKNOWN_BRANCH',
      },
      {
        sourceKey: {
          baseId: 'appFixtureRent', table: 'Transactions', recordId: 'rec-invalid-amount',
        },
        severity: 'error',
        code: 'INVALID_REQUIRED_AMOUNT',
      },
    ]);
    expect(batch.records.map(({ transaction }) => transaction.sourceId)).not.toContain(
      'rec-unknown-branch',
    );
  });

  test('keeps batch reads as the only handoff and fails generic sync closed before reading', async () => {
    const client = fixtureClient();
    const connector = new AirtableConnector({
      id: 'airtable', client, bases: fixture.bases,
      now: () => new Date('2026-07-12T00:00:00Z'),
    });

    const batch = await connector.readIncrementalBatch({});

    expect(batch.cursor).toEqual({
      updatedAt: '2026-07-11T02:00:00.000Z',
      sourceRecordId: 'appFixtureMall/Transactions/rec-mall-rental',
    });
    if (batch.cursor === undefined) {
      throw new Error('Expected a batch cursor');
    }
    client.listRecords.mockClear();
    const accidentallyRegistered: IntegrationConnector = connector;

    await expect(accidentallyRegistered.syncIncremental({ cursor: batch.cursor }))
      .rejects.toBeInstanceOf(AirtablePersistenceRequiredError);
    await expect(connector.syncBackfill({
      window: {
        startsAt: '2026-07-10T00:00:00.000Z',
        endsAt: '2026-07-10T23:59:59.999Z',
      },
    })).rejects.toMatchObject({
      name: 'AirtablePersistenceRequiredError',
      code: 'AIRTABLE_PERSISTENCE_REQUIRED',
    });
    expect(client.listRecords).not.toHaveBeenCalled();
  });

  test('omits raw snapshots and configured source field names from public/loggable batches', async () => {
    const connector = new AirtableConnector({
      id: 'airtable', client: fixtureClient(), bases: fixture.bases,
      now: () => new Date('2026-07-12T00:00:00Z'),
    });

    const serialized = JSON.stringify(await connector.readIncrementalBatch({}));

    expect(serialized).not.toContain('gross_baht');
    expect(serialized).not.toContain('branch_code');
    expect(serialized).not.toContain('transaction_link');
    expect(serialized).not.toContain('"UNKNOWN"');
    expect(serialized).not.toContain('100.001');
    expect(serialized).not.toContain('arbitrary-private-pii-value');
  });

  test('exposes only the exact safe public batch structure', async () => {
    const batch = await new AirtableConnector({
      id: 'airtable', client: fixtureClient(), bases: fixture.bases,
      now: () => new Date('2026-07-12T00:00:00Z'),
    }).readIncrementalBatch({});

    expect(Object.keys(batch).sort()).toEqual([
      'checkpointBlocked', 'cursor', 'detailReferences', 'orderGroups', 'recordIssues',
      'records', 'sourceCounts',
    ]);
    expect(Object.keys(batch.sourceCounts).sort()).toEqual([
      'transactionDetailRecordsFetched',
      'transactionRecordsFetched',
      'transactionRecordsSelected',
    ]);
    expect(Object.keys(batch.records[0]!).sort()).toEqual([
      'sourceKey', 'transaction', 'upsertKey',
    ]);
    expect(Object.keys(batch.records[0]!.sourceKey).sort()).toEqual([
      'baseId', 'recordId', 'table',
    ]);
    expect(Object.keys(batch.recordIssues[0]!).sort()).toEqual([
      'code', 'severity', 'sourceKey',
    ]);
    expect(Object.keys(batch.records[0]!.transaction).sort()).toEqual([
      'amounts', 'bagCapacity', 'bootsHeight', 'branchId', 'brandId', 'color', 'currency', 'customerName', 'destination', 'documentDate',
      'documentKind', 'documentNumber', 'ingestedAt', 'orderGroupId', 'paidAt', 'pantsLength', 'shirtLength', 'size', 'sourceBaseId',
      'sourceId', 'sourceUpdatedAt',
    ]);
  });

  test.each([undefined, ''])('quarantines a missing or empty branch value %p', async (branch) => {
    const batch = await rentConnector(recordsClient([
      record('rec-missing-branch', { branch_code: branch }),
    ])).readIncrementalBatch({});

    expect(batch.records).toEqual([]);
    expect(batch.recordIssues).toEqual([expect.objectContaining({ code: 'MISSING_BRANCH' })]);
  });

  test('prefers a recognized document number over an earlier unknown stale value', async () => {
    const batch = await rentConnector(recordsClient([
      record('rec-recognized-doc', { rental_doc: 'legacy-123', sale_doc: 'CA-9002' }),
    ])).readIncrementalBatch({});

    expect(batch.records[0]!.transaction).toMatchObject({
      documentNumber: 'CA-9002',
      documentKind: 'sale',
    });
  });

  test('quarantines a record when no document number candidate is recognized', async () => {
    const batch = await rentConnector(recordsClient([
      record('rec-unknown-doc', { rental_doc: 'legacy-123', sale_doc: 'stale-456' }),
    ])).readIncrementalBatch({});

    expect(batch.records).toEqual([]);
    expect(batch.recordIssues).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_DOCUMENT_NUMBER' }),
    ]);
  });

  test('preserves a mixed RE/CA order group while quarantining unallocated document totals', async () => {
    const batch = await rentConnector(recordsClient([
      record('rec-ambiguous-docs', { rental_doc: 'RE-9001', sale_doc: 'CA-9002' }),
    ])).readIncrementalBatch({});

    expect(batch.records).toEqual([]);
    expect(batch.recordIssues).toEqual([
      expect.objectContaining({ code: 'MIXED_DOCUMENT_AMOUNTS_UNALLOCATED' }),
    ]);
    expect(batch.orderGroups).toEqual([{
      orderGroupId: 'appFixtureRent/Transactions/rec-ambiguous-docs',
      sourceKey: {
        baseId: 'appFixtureRent', table: 'Transactions', recordId: 'rec-ambiguous-docs',
      },
      documents: [
        { documentNumber: 'CA-9002', documentKind: 'sale' },
        { documentNumber: 'RE-9001', documentKind: 'rental' },
      ],
    }]);
    expect(JSON.stringify(batch.orderGroups)).not.toContain('535');
  });

  test('returns sanitized detail linkage without raw fields or fabricated revenue lines', async () => {
    const batch = await new AirtableConnector({
      id: 'airtable', client: fixtureClient(), bases: fixture.bases,
      now: () => new Date('2026-07-12T00:00:00Z'),
    }).readIncrementalBatch({});

    expect(batch.detailReferences).toEqual([
      {
        sourceKey: {
          baseId: 'appFixtureRent', table: 'Transaction Detail', recordId: 'rec-rent-detail',
        },
        linkedTransactionRecordIds: ['rec-rent-sale'],
      },
      {
        sourceKey: {
          baseId: 'appFixtureMall', table: 'Transaction Detail', recordId: 'rec-mall-detail-1',
        },
        linkedTransactionRecordIds: ['rec-mall-rental'],
      },
      {
        sourceKey: {
          baseId: 'appFixtureMall', table: 'Transaction Detail', recordId: 'rec-mall-detail-2',
        },
        linkedTransactionRecordIds: ['rec-mall-rental'],
      },
    ]);
    expect(Object.keys(batch.detailReferences[0]!).sort()).toEqual([
      'linkedTransactionRecordIds', 'sourceKey',
    ]);
    expect(JSON.stringify(batch.detailReferences)).not.toContain('detail_modified');
    expect(JSON.stringify(batch.detailReferences)).not.toContain('revenue');
  });

  test('sanitizes detail links to unique non-empty transaction record IDs only', async () => {
    const batch = await rentConnector(recordsClient([], [{
      id: 'detail-safe',
      fields: {
        transaction_link: ['rec-z', '', 42, 'rec-a', 'rec-z'],
        detail_modified: '2026-07-10T06:30:00Z',
        private_note: 'do-not-expose',
      },
    }])).readIncrementalBatch({});

    expect(batch.detailReferences).toEqual([{
      sourceKey: {
        baseId: 'appFixtureRent', table: 'Transaction Detail', recordId: 'detail-safe',
      },
      linkedTransactionRecordIds: ['rec-a', 'rec-z'],
    }]);
    expect(JSON.stringify(batch)).not.toContain('do-not-expose');
  });

  test('hashes a configured stable customer link and never exposes its raw identity', async () => {
    const client = recordsClient([record('rec-customer', {
      customer_link: ['cus-private-123'],
    })]);
    const hashCustomerReference = vi.fn((reference: string) => (
      reference === 'cus-private-123' ? 'b'.repeat(64) : 'unexpected'
    ));
    const connector = new AirtableConnector({
      id: 'airtable',
      client,
      bases: [{
        ...rentBase,
        fieldMap: { ...rentBase.fieldMap, customerReference: 'customer_link' },
      }],
      hashCustomerReference,
      now: () => new Date('2026-07-12T00:00:00Z'),
    });

    const batch = await connector.readIncrementalBatch({});

    expect(hashCustomerReference).toHaveBeenCalledWith('cus-private-123');
    expect(batch.records[0]!.transaction.customerReferenceHash)
      .toBe('b'.repeat(64));
    expect(JSON.stringify(batch)).not.toContain('cus-private-123');
    expect(JSON.stringify(batch)).not.toContain('customer_link');
  });

  test.each([undefined, ''])(
    'omits an absent configured customer reference %p without requiring a hash callback',
    async (customerReference) => {
      const batch = await new AirtableConnector({
        id: 'airtable',
        client: recordsClient([record('rec-no-customer', { customer_link: customerReference })]),
        bases: [{
          ...rentBase,
          fieldMap: { ...rentBase.fieldMap, customerReference: 'customer_link' },
        }],
      }).readIncrementalBatch({});

      expect(batch.records).toHaveLength(1);
      expect(batch.records[0]!.transaction).not.toHaveProperty('customerReferenceHash');
    },
  );

  test.each(['missing', 'throws', 'returns-raw'] as const)(
    'quarantines configured customer identity when hash callback %s safely',
    async (callbackMode) => {
      const rawReference = 'cus-never-public';
      const secretFailure = 'private-hash-failure';
      const connector = new AirtableConnector({
        id: 'airtable',
        client: recordsClient([record('rec-customer-failure', {
          customer_link: rawReference,
        })]),
        bases: [{
          ...rentBase,
          fieldMap: { ...rentBase.fieldMap, customerReference: 'customer_link' },
        }],
        ...(callbackMode === 'missing' ? {} : {
          hashCustomerReference: callbackMode === 'throws'
            ? () => { throw new Error(secretFailure); }
            : (reference: string) => reference,
        }),
      });

      const batch = await connector.readIncrementalBatch({});
      expect(batch.records).toEqual([]);
      expect(batch.recordIssues).toEqual([
        expect.objectContaining({ code: 'CUSTOMER_REFERENCE_HASH_FAILED' }),
      ]);
      expect(JSON.stringify(batch)).not.toContain(rawReference);
      expect(JSON.stringify(batch)).not.toContain(secretFailure);
    },
  );

  test.each([
    '',
    'hmac:cus-never-public',
    'C'.repeat(64),
    'c'.repeat(63),
  ])('quarantines a callback result that is not a lowercase SHA-256 digest %p', async (output) => {
    const rawReference = 'cus-never-public';
    const connector = new AirtableConnector({
      id: 'airtable',
      client: recordsClient([record('rec-customer-malformed', { customer_link: rawReference })]),
      bases: [{
        ...rentBase,
        fieldMap: { ...rentBase.fieldMap, customerReference: 'customer_link' },
      }],
      hashCustomerReference: () => output,
    });

    const batch = await connector.readIncrementalBatch({});

    expect(batch.records).toEqual([]);
    expect(batch.recordIssues).toEqual([
      expect.objectContaining({ code: 'CUSTOMER_REFERENCE_HASH_FAILED' }),
    ]);
    expect(JSON.stringify(batch)).not.toContain(rawReference);
  });

  test('blocks checkpoint advancement and preserves the incoming cursor for invalid source timestamps', async () => {
    const cursor = {
      updatedAt: '2026-07-10T05:00:00.000Z',
      sourceRecordId: 'appFixtureRent/Transactions/rec-before',
    };
    const batch = await rentConnector(recordsClient([
      record('rec-valid', { source_modified: '2026-07-10T07:00:00Z' }),
      record('rec-invalid-source', { source_modified: 'not-a-date' }),
      record('rec-missing-source', { source_modified: undefined }),
    ])).readIncrementalBatch({ cursor });

    expect(batch.checkpointBlocked).toBe(true);
    expect(batch.cursor).toEqual(cursor);
    expect(batch.recordIssues.map(({ code }) => code)).toEqual([
      'INVALID_SOURCE_UPDATED',
      'INVALID_SOURCE_UPDATED',
    ]);
  });

  test('blocks checkpoint advancement for missing or malformed detail timestamps', async () => {
    const cursor = {
      updatedAt: '2026-07-10T05:00:00.000Z',
      sourceRecordId: 'appFixtureRent/Transactions/rec-before',
    };
    const batch = await rentConnector(recordsClient([
      record('rec-valid', { source_modified: '2026-07-10T07:00:00Z' }),
    ], [
      { id: 'detail-missing-source', fields: { transaction_link: ['rec-valid'] } },
      {
        id: 'detail-malformed-source',
        fields: { transaction_link: ['rec-valid'], detail_modified: 'not-a-date' },
      },
    ])).readIncrementalBatch({ cursor });

    expect(batch.checkpointBlocked).toBe(true);
    expect(batch.cursor).toEqual(cursor);
    expect(batch.recordIssues).toEqual([
      expect.objectContaining({
        sourceKey: expect.objectContaining({ table: 'Transaction Detail' }),
        code: 'INVALID_DETAIL_SOURCE_UPDATED',
      }),
      expect.objectContaining({
        sourceKey: expect.objectContaining({ table: 'Transaction Detail' }),
        code: 'INVALID_DETAIL_SOURCE_UPDATED',
      }),
    ]);
  });

  test('reprocesses every candidate at the cursor timestamp including a lexically smaller key', async () => {
    const timestamp = '2026-07-10T06:00:00.000Z';
    const batch = await rentConnector(recordsClient([
      record('rec-a', { source_modified: timestamp }),
      record('rec-z', { source_modified: timestamp }),
    ])).readIncrementalBatch({
      cursor: {
        updatedAt: timestamp,
        sourceRecordId: 'appFixtureRent/Transactions/rec-z',
      },
    });

    expect(batch.records.map(({ transaction }) => transaction.sourceId)).toEqual([
      'rec-a',
      'rec-z',
    ]);
  });

  test('forwards failure-safe inclusive source-updated filters to every incremental transaction and detail page', async () => {
    const client = fixtureClient();
    const cursor = {
      updatedAt: '2026-07-10T05:00:00.000Z',
      sourceRecordId: 'appFixtureRent/Transactions/rec-rent-sale',
    };

    await new AirtableConnector({
      id: 'airtable', client, bases: fixture.bases,
      now: () => new Date('2026-07-12T00:00:00Z'),
    }).readIncrementalBatch({ cursor });

    const requests = client.listRecords.mock.calls.map(([request]) => request);
    expect(requests).not.toHaveLength(0);
    expect(requests.every(({ filterByFormula }) => filterByFormula !== undefined)).toBe(true);
    expect(requests.filter(({ baseId, table }) => (
      baseId === 'appFixtureRent' && table === 'Transactions'
    )).every(({ filterByFormula }) => filterByFormula === (
      "OR({source_modified}=BLANK(),IFERROR(OR(IS_AFTER({source_modified},DATETIME_PARSE('2026-07-10T05:00:00.000Z')),IS_SAME({source_modified},DATETIME_PARSE('2026-07-10T05:00:00.000Z'))),TRUE()))"
    ))).toBe(true);
    expect(requests.filter(({ baseId, table }) => (
      baseId === 'appFixtureMall' && table === 'Transaction Detail'
    )).every(({ filterByFormula }) => filterByFormula === (
      "OR({detail_changed}=BLANK(),IFERROR(OR(IS_AFTER({detail_changed},DATETIME_PARSE('2026-07-10T05:00:00.000Z')),IS_SAME({detail_changed},DATETIME_PARSE('2026-07-10T05:00:00.000Z'))),TRUE()))"
    ))).toBe(true);
  });

  test.each([
    'not-a-timestamp',
    '2026-07-10T12:00:00.000+07:00',
  ])('rejects unsafe incremental cursor timestamp %j before Airtable I/O', async (updatedAt) => {
    const client = recordsClient([]);

    await expect(rentConnector(client).readIncrementalBatch({
      cursor: { updatedAt, sourceRecordId: 'rec-private' },
    })).rejects.toBeInstanceOf(AirtableRequestValidationError);
    expect(client.listRecords).not.toHaveBeenCalled();
  });

  test('backfill counts and warnings include only candidates with valid in-window document dates', async () => {
    const connector = rentConnector(recordsClient([
      record('rec-in-window', { document_date: '2026-07-10T03:00:00Z' }),
      record('rec-out-window', { document_date: '2026-07-12T03:00:00Z' }),
      record('rec-in-window-issue', {
        document_date: '2026-07-10T04:00:00Z', branch_code: 'UNKNOWN',
      }),
      record('rec-out-window-issue', {
        document_date: '2026-07-12T04:00:00Z', gross_baht: '1.001',
      }),
      record('rec-undated-issue', { document_date: 'not-a-date' }),
    ], [{ id: 'detail-private', fields: {} }]));

    const batch = await connector.readBackfillBatch({
      window: {
        startsAt: '2026-07-10T00:00:00.000Z',
        endsAt: '2026-07-10T23:59:59.999Z',
      },
    });

    expect(batch.sourceCounts.transactionRecordsSelected).toBe(2);
    expect(batch.recordIssues).toEqual([expect.objectContaining({ code: 'UNKNOWN_BRANCH' })]);
  });

  test('backfill preserves details modified outside the window when linked to selected transactions', async () => {
    const client = recordsClient([
      record('rec-selected', { document_date: '2026-07-10T03:00:00Z' }),
      record('rec-outside', { document_date: '2026-07-12T03:00:00Z' }),
    ], [
      {
        id: 'detail-linked-outside-window',
        fields: {
          transaction_link: ['rec-selected'],
          detail_modified: '2026-07-12T03:00:00Z',
        },
      },
      {
        id: 'detail-unrelated-inside-window',
        fields: {
          transaction_link: ['rec-outside'],
          detail_modified: '2026-07-10T03:00:00Z',
        },
      },
    ]);

    const batch = await rentConnector(client).readBackfillBatch({
      window: {
        startsAt: '2026-07-10T00:00:00.000Z',
        endsAt: '2026-07-10T23:59:59.999Z',
      },
    });

    expect(batch.sourceCounts.transactionDetailRecordsFetched).toBe(2);
    expect(batch.detailReferences).toEqual([{
      sourceKey: {
        baseId: 'appFixtureRent',
        table: 'Transaction Detail',
        recordId: 'detail-linked-outside-window',
      },
      linkedTransactionRecordIds: ['rec-selected'],
    }]);
    expect(client.listRecords.mock.calls.map(([request]) => request).filter(({ table }) => (
      table === 'Transaction Detail'
    ))).toEqual([{
      baseId: 'appFixtureRent',
      table: 'Transaction Detail',
    }]);
  });

  test('forwards document-date windows and leaves backfill details unfiltered', async () => {
    const client = fixtureClient();
    await new AirtableConnector({
      id: 'airtable', client, bases: fixture.bases,
      now: () => new Date('2026-07-12T00:00:00Z'),
    }).readBackfillBatch({
      window: {
        startsAt: '2026-07-10T00:00:00.000Z',
        endsAt: '2026-07-11T23:59:59.999Z',
      },
    });

    const requests = client.listRecords.mock.calls.map(([request]) => request);
    expect(requests.filter(({ table }) => table === 'Transactions')
      .every(({ filterByFormula }) => filterByFormula === (
        "AND({document_date}>=DATETIME_PARSE('2026-07-10T00:00:00.000Z'),{document_date}<=DATETIME_PARSE('2026-07-11T23:59:59.999Z'))"
      ) || filterByFormula === (
        "AND({issued_at}>=DATETIME_PARSE('2026-07-10T00:00:00.000Z'),{issued_at}<=DATETIME_PARSE('2026-07-11T23:59:59.999Z'))"
      ))).toBe(true);
    expect(requests.filter(({ table }) => table === 'Transaction Detail')
      .every(({ filterByFormula }) => filterByFormula === undefined)).toBe(true);
  });

  test.each([
    ['not-a-timestamp', '2026-07-11T23:59:59.999Z'],
    ['2026-07-10T00:00:00.000Z', '2026-07-11T23:59:59.999+00:00'],
    ['2026-07-12T00:00:00.000Z', '2026-07-11T23:59:59.999Z'],
  ])('rejects unsafe backfill window %j..%j before Airtable I/O', async (startsAt, endsAt) => {
    const client = recordsClient([]);
    await expect(rentConnector(client).readBackfillBatch({ window: { startsAt, endsAt } }))
      .rejects.toBeInstanceOf(AirtableRequestValidationError);
    expect(client.listRecords).not.toHaveBeenCalled();
  });

  test('rejects unsafe configured formula field names before Airtable I/O', async () => {
    const client = recordsClient([]);
    const unsafeBase: AirtableBaseConfig = {
      ...rentBase,
      fieldMap: { ...rentBase.fieldMap, sourceUpdatedAt: "changed}='x'" },
    };
    const connector = new AirtableConnector({ id: 'airtable', client, bases: [unsafeBase] });

    await expect(connector.readIncrementalBatch({
      cursor: { updatedAt: '2026-07-10T00:00:00.000Z', sourceRecordId: 'rec' },
    })).rejects.toBeInstanceOf(AirtableRequestValidationError);
    expect(client.listRecords).not.toHaveBeenCalled();
  });

  test('rejects a repeated pagination offset cycle', async () => {
    const listRecords = vi.fn(async (request: ListRecordsRequest): Promise<AirtableRecordPage> => {
      if (request.table === rentBase.transactionDetailsTable) {
        return { records: [] };
      }
      return { records: [], offset: 'same-offset' };
    });

    await expect(rentConnector({ listRecords }).readIncrementalBatch({}))
      .rejects.toThrowError('Airtable pagination returned a repeated offset');
  });

  test('health-checks both tables for every base sequentially with one-record probes', async () => {
    let active = 0;
    let maximumActive = 0;
    const listRecords = vi.fn(async (_request: ListRecordsRequest): Promise<AirtableRecordPage> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return { records: [] };
    });
    const connector = new AirtableConnector({
      id: 'airtable', client: { listRecords }, bases: fixture.bases,
    });

    await expect(connector.healthCheck()).resolves.toEqual({ status: 'healthy' });
    expect(maximumActive).toBe(1);
    expect(listRecords.mock.calls.map(([request]) => request)).toEqual([
      { baseId: 'appFixtureRent', table: 'Transactions', maxRecords: 1 },
      { baseId: 'appFixtureRent', table: 'Transaction Detail', maxRecords: 1 },
      { baseId: 'appFixtureMall', table: 'Transactions', maxRecords: 1 },
      { baseId: 'appFixtureMall', table: 'Transaction Detail', maxRecords: 1 },
    ]);
  });

  test('reports unavailable when a transaction detail health probe fails', async () => {
    const listRecords = vi.fn(async (request: ListRecordsRequest): Promise<AirtableRecordPage> => {
      if (request.table === rentBase.transactionDetailsTable) {
        throw new Error('private detail failure');
      }
      return { records: [] };
    });

    await expect(rentConnector({ listRecords }).healthCheck())
      .resolves.toEqual({ status: 'unavailable' });
  });
});

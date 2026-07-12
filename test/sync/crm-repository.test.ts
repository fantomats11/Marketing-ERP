import { describe, expect, test, vi, beforeEach } from 'vitest';
import { CrmRepository, getDeterministicUuid } from '../../src/sync/crm-repository.js';
import type { DatabaseClient } from '../../src/config/database.js';
import type { AirtableSyncBatch } from '../../src/integrations/airtable/connector.js';

describe('CrmRepository', () => {
  let mockDb: any;
  let repository: CrmRepository;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    repository = new CrmRepository(mockDb as unknown as DatabaseClient);
  });

  test('upsertTransactions maps and inserts transactions to leads and pipeline items', async () => {
    const batch: AirtableSyncBatch = {
      records: [
        {
          sourceKey: { baseId: 'base1', table: 'table1', recordId: 'rec1' },
          upsertKey: 'key1',
          transaction: {
            sourceId: 'rec1',
            sourceBaseId: 'base1',
            orderGroupId: 'order1',
            brandId: 'rent-a-coat',
            branchId: 'rac-rama9',
            documentNumber: 'RE-1001',
            documentKind: 'rental',
            documentDate: '2026-07-12T15:00:00Z',
            paidAt: '2026-07-12T15:30:00Z',
            currency: 'THB',
            customerReferenceHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            amounts: {
              grossAmount: 10000,
              discountAmount: 1000,
              netBeforeVat: 9000,
              vatAmount: 630,
              documentTotal: 9630,
              cashCollected: 9630,
              depositAmount: 2000,
              refundAmount: 0,
            },
            destination: 'Japan',
            sourceUpdatedAt: '2026-07-12T15:35:00Z',
            ingestedAt: '2026-07-12T15:40:00Z',
          },
        },
        {
          sourceKey: { baseId: 'base1', table: 'table1', recordId: 'rec2' },
          upsertKey: 'key2',
          transaction: {
            sourceId: 'rec2',
            sourceBaseId: 'base1',
            orderGroupId: 'order2',
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
      recordIssues: [],
      orderGroups: [],
      detailReferences: [],
      sourceCounts: {
        transactionRecordsFetched: 2,
        transactionRecordsSelected: 2,
        transactionDetailRecordsFetched: 0,
      },
      checkpointBlocked: false,
    };

    mockDb.query.mockResolvedValue({ rows: [] });

    await repository.upsertTransactions(batch);

    // Two records in batch, each triggers 2 queries (leads and pipeline_items), total 4 queries
    expect(mockDb.query).toHaveBeenCalledTimes(4);

    // Verify first transaction: paid rental, brand 'rent-a-coat' -> 'rent_a_coat' stage -> 'paid'
    const lead1Id = getDeterministicUuid('rec1');
    const orgId = '00000000-0000-4000-8000-000000000001';
    expect(mockDb.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO public.leads'),
      [
        lead1Id,
        orgId,
        'RE-1001',
        'Japan',
        '2026-07-12',
        9630, // docTotal in integer satang
      ],
    );

    const pipeline1Id = getDeterministicUuid('rec1-pipeline');
    expect(mockDb.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO public.pipeline_items'),
      [
        pipeline1Id,
        orgId,
        lead1Id,
        'paid',
        'rent_a_coat',
      ],
    );

    // Verify second transaction: unpaid sale, brand 'go-mall' -> 'go_mall' stage -> 'reserved_or_added_to_cart'
    const lead2Id = getDeterministicUuid('rec2');
    expect(mockDb.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO public.leads'),
      [
        lead2Id,
        orgId,
        'CA-1002',
        null,
        '2026-07-12',
        5350,
      ],
    );

    const pipeline2Id = getDeterministicUuid('rec2-pipeline');
    expect(mockDb.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('INSERT INTO public.pipeline_items'),
      [
        pipeline2Id,
        orgId,
        lead2Id,
        'reserved_or_added_to_cart',
        'go_mall',
      ],
    );
  });

  test('upsertLeadsAndSizing upserts lead profiles and sizing maps when customerReferenceHash is present', async () => {
    const batch: AirtableSyncBatch = {
      records: [
        {
          sourceKey: { baseId: 'base1', table: 'table1', recordId: 'rec1' },
          upsertKey: 'key1',
          transaction: {
            sourceId: 'rec1',
            sourceBaseId: 'base1',
            orderGroupId: 'order1',
            brandId: 'rent-a-coat',
            branchId: 'rac-rama9',
            documentNumber: 'RE-1001',
            documentKind: 'rental',
            documentDate: '2026-07-12T15:00:00Z',
            currency: 'THB',
            customerReferenceHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            amounts: {
              grossAmount: 10000,
              discountAmount: 1000,
              netBeforeVat: 9000,
              vatAmount: 630,
              documentTotal: 9630,
              cashCollected: 9630,
              depositAmount: 2000,
              refundAmount: 0,
            },
            sourceUpdatedAt: '2026-07-12T15:35:00Z',
            ingestedAt: '2026-07-12T15:40:00Z',
          },
        },
        {
          sourceKey: { baseId: 'base1', table: 'table1', recordId: 'rec2' },
          upsertKey: 'key2',
          transaction: {
            sourceId: 'rec2',
            sourceBaseId: 'base1',
            orderGroupId: 'order2',
            brandId: 'go-mall',
            branchId: 'gomall-rama9',
            documentNumber: 'CA-1002',
            documentKind: 'sale',
            documentDate: '2026-07-12T16:00:00Z',
            currency: 'THB',
            // customerReferenceHash is missing here
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
      recordIssues: [],
      orderGroups: [],
      detailReferences: [],
      sourceCounts: {
        transactionRecordsFetched: 2,
        transactionRecordsSelected: 2,
        transactionDetailRecordsFetched: 0,
      },
      checkpointBlocked: false,
    };

    mockDb.query.mockResolvedValue({ rows: [] });

    await repository.upsertLeadsAndSizing(batch);

    // Only one record has customerReferenceHash, so only 1 query
    expect(mockDb.query).toHaveBeenCalledTimes(1);

    const targetCustomerLeadId = getDeterministicUuid('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const orgId = '00000000-0000-4000-8000-000000000001';

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.leads'),
      [
        targetCustomerLeadId,
        orgId,
        'RE-1001',
        9630,
        '29',
        '20',
        '32',
        '28',
        'black',
        'M',
      ],
    );
  });
});

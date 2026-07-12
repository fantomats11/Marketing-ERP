import { describe, expect, test } from 'vitest';

import { NormalizedTransactionSchema } from '../../src/domain/transaction.js';

const validTransaction = {
  sourceId: 'rec123',
  sourceBaseId: 'app123',
  orderGroupId: 'app123/Transactions/rec123',
  brandId: 'rent-a-coat',
  branchId: 'rac-rama9',
  documentNumber: 'RE-001',
  documentKind: 'rental',
  documentDate: '2026-07-12T03:00:00.000Z',
  paidAt: '2026-07-12T04:00:00.000Z',
  currency: 'THB',
  customerReferenceHash: 'a'.repeat(64),
  amounts: {
    grossAmount: 120000,
    discountAmount: 5000,
    netBeforeVat: 115000,
    vatAmount: 8050,
    documentTotal: 123050,
    cashCollected: 123050,
    depositAmount: 20000,
    refundAmount: 0,
  },
  destination: 'Hokkaido',
  sourceUpdatedAt: '2026-07-12T05:00:00.000Z',
  ingestedAt: '2026-07-12T05:01:00.000Z',
};

describe('NormalizedTransactionSchema', () => {
  test('requires a deterministic order group identifier', () => {
    const { orderGroupId: _orderGroupId, ...withoutOrderGroupId } = validTransaction;

    expect(NormalizedTransactionSchema.safeParse(withoutOrderGroupId).success).toBe(false);
  });

  test.each([
    ['RE-001', 'sale'],
    ['CA-001', 'rental'],
    ['legacy-001', 'sale'],
  ])('rejects recognized document %s with mismatched kind %s', (documentNumber, documentKind) => {
    expect(NormalizedTransactionSchema.safeParse({
      ...validTransaction,
      documentNumber,
      documentKind,
    }).success).toBe(false);
  });

  test('requires unknown document kind for an unrecognized document number', () => {
    expect(NormalizedTransactionSchema.safeParse({
      ...validTransaction,
      documentNumber: 'legacy-001',
      documentKind: 'unknown',
    }).success).toBe(true);
  });

  test.each([
    '',
    'sha256:customer-reference',
    'A'.repeat(64),
    'a'.repeat(63),
  ])('rejects a non-canonical customer reference hash %p', (customerReferenceHash) => {
    expect(NormalizedTransactionSchema.safeParse({
      ...validTransaction,
      customerReferenceHash,
    }).success).toBe(false);
  });

  test('accepts an independently optional destination', () => {
    const { destination: _destination, ...withoutDestination } = validTransaction;

    expect(NormalizedTransactionSchema.parse(withoutDestination)).not.toHaveProperty('destination');
  });

  test('requires branchId even when a destination is supplied', () => {
    const { branchId: _branchId, ...withoutBranch } = validTransaction;

    const result = NormalizedTransactionSchema.safeParse(withoutBranch);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['branchId'] })]),
      );
    }
  });

  test.each([
    'grossAmount',
    'discountAmount',
    'netBeforeVat',
    'vatAmount',
    'documentTotal',
    'cashCollected',
    'depositAmount',
    'refundAmount',
  ] as const)('rejects %s values above Number.MAX_SAFE_INTEGER', (amountField) => {
    const result = NormalizedTransactionSchema.safeParse({
      ...validTransaction,
      amounts: {
        ...validTransaction.amounts,
        [amountField]: Number.MAX_SAFE_INTEGER + 1,
      },
    });

    expect(result.success).toBe(false);
  });
});

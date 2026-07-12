import { describe, expect, test } from 'vitest';

import {
  BrandIdSchema,
  BranchIdSchema,
  classifyDocumentNumber,
} from '../../src/domain/identity.js';

describe('canonical identities', () => {
  test('accepts the four supported brand IDs', () => {
    expect(BrandIdSchema.options).toEqual([
      'rent-a-coat',
      'go-mall',
      'winterra',
      'cocoat',
    ]);
  });

  test('accepts the four supported branch IDs', () => {
    expect(BranchIdSchema.options).toEqual([
      'rac-rama9',
      'gomall-rama9',
      'rac-vibhavadi',
      'phetkasem-future',
    ]);
  });
});

describe('classifyDocumentNumber', () => {
  test('classifies RE documents as rentals', () => {
    expect(classifyDocumentNumber('RE-001')).toBe('rental');
  });

  test('classifies CA documents case-insensitively as sales', () => {
    expect(classifyDocumentNumber('ca0001')).toBe('sale');
  });

  test.each(['', 'XX-001', 'RENT-001', 'catalog-001'])('returns unknown for %j', (value) => {
    expect(classifyDocumentNumber(value)).toBe('unknown');
  });
});

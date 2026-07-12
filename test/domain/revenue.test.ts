import { describe, expect, test } from 'vitest';

import {
  calculateRecognizedRevenue,
  type RevenueLine,
} from '../../src/domain/revenue.js';

const line = (
  category: RevenueLine['category'],
  amountSatang: number,
  settlementDirection: RevenueLine['settlementDirection'] = 'inflow',
): RevenueLine => ({ category, amountSatang, settlementDirection });

describe('calculateRecognizedRevenue', () => {
  test('recognizes rental, sale, and fee lines', () => {
    expect(
      calculateRecognizedRevenue([
        line('rental', 10001),
        line('sale', 2505),
        line('late_fee', 299),
      ]),
    ).toEqual({
      grossRecognizedRevenue: 12805,
      depositAmount: 0,
      refundAmount: 0,
      netCashMovement: 12805,
    });
  });

  test('keeps deposits outside recognized revenue', () => {
    expect(calculateRecognizedRevenue([line('deposit', 5000)])).toEqual({
      grossRecognizedRevenue: 0,
      depositAmount: 5000,
      refundAmount: 0,
      netCashMovement: 5000,
    });
  });

  test('counts deposit inflows as deposits and net cash, not recognized revenue', () => {
    expect(calculateRecognizedRevenue([line('deposit', 5000, 'inflow')])).toEqual({
      grossRecognizedRevenue: 0,
      depositAmount: 5000,
      refundAmount: 0,
      netCashMovement: 5000,
    });
  });

  test('counts recognized outflows as revenue and reduces net cash', () => {
    expect(calculateRecognizedRevenue([line('rental', 1200, 'outflow')])).toEqual({
      grossRecognizedRevenue: 1200,
      depositAmount: 0,
      refundAmount: 0,
      netCashMovement: -1200,
    });
  });

  test('reports refunds separately and subtracts their cash movement', () => {
    expect(calculateRecognizedRevenue([line('refund', 1200, 'outflow')])).toEqual({
      grossRecognizedRevenue: 0,
      depositAmount: 0,
      refundAmount: 1200,
      netCashMovement: -1200,
    });
  });

  test('preserves exact integer-satang arithmetic', () => {
    const result = calculateRecognizedRevenue([
      line('rental', 1999),
      line('sale', 1),
    ]);

    expect(result.grossRecognizedRevenue).toBe(2000);
    expect(result.netCashMovement).toBe(2000);
  });

  test('rejects line amounts above Number.MAX_SAFE_INTEGER', () => {
    expect(() =>
      calculateRecognizedRevenue([
        line('rental', Number.MAX_SAFE_INTEGER + 1),
      ]),
    ).toThrow();
  });

  test('rejects recognized revenue aggregates above Number.MAX_SAFE_INTEGER', () => {
    expect(() =>
      calculateRecognizedRevenue([
        line('rental', Number.MAX_SAFE_INTEGER),
        line('sale', 1),
      ]),
    ).toThrow();
  });

  test('rejects deposit aggregates above Number.MAX_SAFE_INTEGER before updating net cash', () => {
    expect(() =>
      calculateRecognizedRevenue([
        line('deposit', Number.MAX_SAFE_INTEGER, 'inflow'),
        line('deposit', 1, 'inflow'),
      ]),
    ).toThrow();
  });

  test('rejects refund aggregates above Number.MAX_SAFE_INTEGER before updating net cash', () => {
    expect(() =>
      calculateRecognizedRevenue([
        line('refund', Number.MAX_SAFE_INTEGER, 'outflow'),
        line('refund', 1, 'outflow'),
      ]),
    ).toThrow();
  });

  test('rejects net cash movement above Number.MAX_SAFE_INTEGER when category aggregates remain safe', () => {
    expect(() =>
      calculateRecognizedRevenue([
        line('rental', Number.MAX_SAFE_INTEGER),
        line('deposit', 1),
      ]),
    ).toThrow();
  });

  test('rejects net cash movement below the safe integer range when category aggregates remain safe', () => {
    expect(() =>
      calculateRecognizedRevenue([
        line('rental', Number.MAX_SAFE_INTEGER, 'outflow'),
        line('deposit', 1, 'outflow'),
      ]),
    ).toThrow();
  });

  test.each([
    { category: 'rental', amountSatang: -1, settlementDirection: 'inflow' },
    { category: 'unknown', amountSatang: 100, settlementDirection: 'inflow' },
    { category: 'refund', amountSatang: 100, settlementDirection: 'inflow' },
  ])('rejects invalid revenue line: %j', (invalidLine) => {
    expect(() =>
      calculateRecognizedRevenue([invalidLine] as unknown as RevenueLine[]),
    ).toThrow();
  });
});

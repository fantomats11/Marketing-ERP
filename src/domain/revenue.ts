import { z } from 'zod';

import { SatangAmountSchema } from './transaction.js';

export const RevenueCategorySchema = z.enum([
  'rental',
  'sale',
  'wash',
  'asset_sale',
  'b2b',
  'barter',
  'damage_fee',
  'late_fee',
  'deposit',
  'refund',
]);

export type RevenueCategory = z.infer<typeof RevenueCategorySchema>;

export const SettlementDirectionSchema = z.enum(['inflow', 'outflow']);

export type SettlementDirection = z.infer<typeof SettlementDirectionSchema>;

export const RevenueLineSchema = z
  .object({
    category: RevenueCategorySchema,
    amountSatang: SatangAmountSchema,
    settlementDirection: SettlementDirectionSchema,
  })
  .refine(
    (line) => line.category !== 'refund' || line.settlementDirection === 'outflow',
    {
      message: 'Refunds must use an outflow settlement direction.',
      path: ['settlementDirection'],
    },
  )
  .strict();

export type RevenueLine = z.infer<typeof RevenueLineSchema>;

export interface RevenueSummary {
  grossRecognizedRevenue: number;
  depositAmount: number;
  refundAmount: number;
  netCashMovement: number;
}

const RECOGNIZED_REVENUE_CATEGORIES = new Set<RevenueCategory>([
  'rental',
  'sale',
  'wash',
  'asset_sale',
  'b2b',
  'barter',
  'damage_fee',
  'late_fee',
]);

function addSafely(left: number, right: number): number {
  const total = left + right;

  if (!Number.isSafeInteger(total)) {
    throw new RangeError('Satang total exceeds Number.MAX_SAFE_INTEGER.');
  }

  return total;
}

export function calculateRecognizedRevenue(lines: RevenueLine[]): RevenueSummary {
  return lines.reduce<RevenueSummary>(
    (summary, line) => {
      const validatedLine = RevenueLineSchema.parse(line);
      const { amountSatang, category, settlementDirection } = validatedLine;

      if (RECOGNIZED_REVENUE_CATEGORIES.has(category)) {
        summary.grossRecognizedRevenue = addSafely(
          summary.grossRecognizedRevenue,
          amountSatang,
        );
      } else if (category === 'deposit') {
        summary.depositAmount = addSafely(summary.depositAmount, amountSatang);
      } else {
        summary.refundAmount = addSafely(summary.refundAmount, amountSatang);
      }

      summary.netCashMovement = addSafely(
        summary.netCashMovement,
        settlementDirection === 'inflow' ? amountSatang : -amountSatang,
      );
      return summary;
    },
    {
      grossRecognizedRevenue: 0,
      depositAmount: 0,
      refundAmount: 0,
      netCashMovement: 0,
    },
  );
}

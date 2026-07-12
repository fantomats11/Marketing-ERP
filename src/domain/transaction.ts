import { z } from 'zod';

import {
  BrandIdSchema,
  BranchIdSchema,
  DocumentKindSchema,
  classifyDocumentNumber,
} from './identity.js';

export const SatangAmountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export type SatangAmount = z.infer<typeof SatangAmountSchema>;

export const UtcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith('Z'), 'Timestamp must use UTC (Z) offset.');

export const CustomerReferenceHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, 'Customer reference hash must be a lowercase SHA-256 hex digest.');

export const TransactionAmountsSchema = z
  .object({
    grossAmount: SatangAmountSchema,
    discountAmount: SatangAmountSchema,
    netBeforeVat: SatangAmountSchema,
    vatAmount: SatangAmountSchema,
    documentTotal: SatangAmountSchema,
    cashCollected: SatangAmountSchema,
    depositAmount: SatangAmountSchema,
    refundAmount: SatangAmountSchema,
  })
  .strict();

export type TransactionAmounts = z.infer<typeof TransactionAmountsSchema>;

export const NormalizedTransactionSchema = z
  .object({
    sourceId: z.string().min(1),
    sourceBaseId: z.string().min(1),
    orderGroupId: z.string().min(1),
    brandId: BrandIdSchema,
    branchId: BranchIdSchema,
    documentNumber: z.string().min(1),
    documentKind: DocumentKindSchema,
    documentDate: UtcTimestampSchema,
    paidAt: UtcTimestampSchema.optional(),
    currency: z.literal('THB'),
    customerReferenceHash: CustomerReferenceHashSchema.optional(),
    amounts: TransactionAmountsSchema,
    destination: z.string().min(1).optional(),
    sourceUpdatedAt: UtcTimestampSchema,
    ingestedAt: UtcTimestampSchema,
    bootsHeight: z.string().optional(),
    bagCapacity: z.string().optional(),
    pantsLength: z.string().optional(),
    shirtLength: z.string().optional(),
    color: z.string().optional(),
    size: z.string().optional(),
    customerName: z.string().optional(),
  })
  .refine(
    (transaction) => {
      const classifiedKind = classifyDocumentNumber(transaction.documentNumber);
      return classifiedKind === transaction.documentKind;
    },
    {
      message: 'Document kind must match the recognized document-number prefix.',
      path: ['documentKind'],
    },
  )
  .strict();

export type NormalizedTransaction = z.infer<typeof NormalizedTransactionSchema>;

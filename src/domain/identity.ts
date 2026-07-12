import { z } from 'zod';

export const BrandIdSchema = z.enum([
  'rent-a-coat',
  'go-mall',
  'winterra',
  'cocoat',
]);

export type BrandId = z.infer<typeof BrandIdSchema>;

export const BranchIdSchema = z.enum([
  'rac-rama9',
  'gomall-rama9',
  'rac-vibhavadi',
  'phetkasem-future',
]);

export type BranchId = z.infer<typeof BranchIdSchema>;

export const DocumentKindSchema = z.enum(['rental', 'sale', 'unknown']);

export type DocumentKind = z.infer<typeof DocumentKindSchema>;

const DOCUMENT_NUMBER_PREFIXES: ReadonlyArray<readonly [RegExp, DocumentKind]> = [
  [/^RE(?:[-_ ]?\d)/i, 'rental'],
  [/^CA(?:[-_ ]?\d)/i, 'sale'],
];

export function classifyDocumentNumber(value: string): DocumentKind {
  return DOCUMENT_NUMBER_PREFIXES.find(([prefix]) => prefix.test(value))?.[1] ?? 'unknown';
}

import { createHash } from 'node:crypto';
import type { DatabaseClient } from '../config/database.js';
import type { AirtableSyncBatch } from '../integrations/airtable/connector.js';

export function getDeterministicUuid(input: string): string {
  const hash = createHash('sha256').update(input).digest('hex');
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '4' + hash.substring(13, 16),
    '8' + hash.substring(17, 20),
    hash.substring(20, 32),
  ].join('-');
}

function mapBrandIdToRoute(brandId: string): string {
  switch (brandId) {
    case 'rent-a-coat':
      return 'rent_a_coat';
    case 'go-mall':
      return 'go_mall';
    case 'winterra':
      return 'winterra';
    default:
      return 'unassigned';
  }
}

export class CrmRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async upsertTransactions(batch: AirtableSyncBatch): Promise<void> {
    for (const record of batch.records) {
      const tx = record.transaction;
      const leadId = getDeterministicUuid(tx.sourceId);
      const orgId = '00000000-0000-4000-8000-000000000001';

      // 1. Upsert into public.leads
      await this.db.query(
        `INSERT INTO public.leads (
          id, organization_id, customer_name, source, destination, trip_date, lead_score, estimated_basket_value,
          boots_height, bag_capacity, pants_length, shirt_length, color, size
        ) VALUES ($1, $2, $3, 'airtable_sync', $4, $5, 10, $6, null, null, null, null, null, null)
        ON CONFLICT (id) DO UPDATE SET
          customer_name = EXCLUDED.customer_name,
          destination = EXCLUDED.destination,
          trip_date = EXCLUDED.trip_date,
          estimated_basket_value = EXCLUDED.estimated_basket_value`,
        [
          leadId,
          orgId,
          tx.documentNumber,
          tx.destination || null,
          tx.documentDate ? tx.documentDate.split('T')[0] : null,
          tx.amounts.documentTotal,
        ],
      );

      // 2. Insert/upsert into public.pipeline_items
      const pipelineItemId = getDeterministicUuid(`${tx.sourceId}-pipeline`);
      const stage = tx.paidAt !== undefined ? 'paid' : 'reserved_or_added_to_cart';
      const brandRoute = mapBrandIdToRoute(tx.brandId);

      await this.db.query(
        `INSERT INTO public.pipeline_items (
          id, organization_id, lead_id, stage, follow_up_date, notes, brand_route
        ) VALUES ($1, $2, $3, $4, null, null, $5)
        ON CONFLICT (id) DO UPDATE SET
          stage = EXCLUDED.stage,
          brand_route = EXCLUDED.brand_route`,
        [
          pipelineItemId,
          orgId,
          leadId,
          stage,
          brandRoute,
        ],
      );
    }
  }

  public async upsertLeadsAndSizing(batch: AirtableSyncBatch): Promise<void> {
    for (const record of batch.records) {
      const tx = record.transaction;
      if (tx.customerReferenceHash) {
        const leadId = getDeterministicUuid(tx.customerReferenceHash);
        const orgId = '00000000-0000-4000-8000-000000000001';

        await this.db.query(
          `INSERT INTO public.leads (
            id, organization_id, customer_name, source, lead_score, estimated_basket_value,
            boots_height, bag_capacity, pants_length, shirt_length, color, size
          ) VALUES ($1, $2, $3, 'airtable_sync', 10, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO UPDATE SET
            customer_name = EXCLUDED.customer_name,
            estimated_basket_value = EXCLUDED.estimated_basket_value,
            boots_height = EXCLUDED.boots_height,
            bag_capacity = EXCLUDED.bag_capacity,
            pants_length = EXCLUDED.pants_length,
            shirt_length = EXCLUDED.shirt_length,
            color = EXCLUDED.color,
            size = EXCLUDED.size`,
          [
            leadId,
            orgId,
            tx.documentNumber,
            tx.amounts.documentTotal,
            '29', // default boots_height
            '20', // default bag_capacity
            '32', // default pants_length
            '28', // default shirt_length
            'black', // default color
            'M', // default size
          ],
        );
      }
    }
  }
}

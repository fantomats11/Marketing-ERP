import { createHash } from 'node:crypto';
import type { DatabaseClient } from '../config/database.js';
import type { AirtableSyncBatch } from '../integrations/airtable/connector.js';
import type { NormalizedTransaction } from '../domain/transaction.js';

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

  private async upsertLeadRecord(tx: NormalizedTransaction, leadId: string, orgId: string): Promise<void> {
    const customerName = tx.customerName || (tx.customerReferenceHash ? 'Customer ' + tx.customerReferenceHash.substring(0, 8) : 'Guest ' + tx.documentNumber);
    const destination = tx.destination || null;
    const tripDate = tx.documentDate ? tx.documentDate.split('T')[0] : null;
    const estimatedBasketValue = tx.amounts.documentTotal;

    const bootsHeight = tx.bootsHeight || null;
    const bagCapacity = tx.bagCapacity || null;
    const pantsLength = tx.pantsLength || null;
    const shirtLength = tx.shirtLength || null;
    const color = tx.color || null;
    const size = tx.size || null;

    await this.db.query(
      `INSERT INTO public.leads (
        id, organization_id, customer_name, source, destination, trip_date, lead_score, estimated_basket_value,
        boots_height, bag_capacity, pants_length, shirt_length, color, size
      ) VALUES ($1, $2, $3, 'airtable_sync', $4, $5, 10, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        customer_name = EXCLUDED.customer_name,
        destination = EXCLUDED.destination,
        trip_date = EXCLUDED.trip_date,
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
        customerName,
        destination,
        tripDate,
        estimatedBasketValue,
        bootsHeight,
        bagCapacity,
        pantsLength,
        shirtLength,
        color,
        size,
      ],
    );
  }

  public async upsertTransactions(batch: AirtableSyncBatch): Promise<void> {
    const orgId = '00000000-0000-4000-8000-000000000001';
    const promises = batch.records.map(async (record) => {
      const tx = record.transaction;
      const leadId = tx.customerReferenceHash ? getDeterministicUuid(tx.customerReferenceHash) : getDeterministicUuid(tx.sourceId);

      // 1. Upsert into public.leads
      await this.upsertLeadRecord(tx, leadId, orgId);

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
    });
    await Promise.all(promises);
  }

  public async upsertLeadsAndSizing(batch: AirtableSyncBatch): Promise<void> {
    const orgId = '00000000-0000-4000-8000-000000000001';
    const promises = batch.records
      .filter((record) => record.transaction.customerReferenceHash !== undefined)
      .map(async (record) => {
        const tx = record.transaction;
        const leadId = tx.customerReferenceHash ? getDeterministicUuid(tx.customerReferenceHash) : getDeterministicUuid(tx.sourceId);
        await this.upsertLeadRecord(tx, leadId, orgId);
      });
    await Promise.all(promises);
  }
}

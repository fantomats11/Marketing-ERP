import { createHash } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { DatabaseClient } from '../src/config/database.js';
import { PostgresCheckpointStore } from '../src/sync/postgres-checkpoint-store.js';
import { CrmRepository } from '../src/sync/crm-repository.js';
import { SyncService } from '../src/sync/sync-service.js';
import { IntegrationRegistry } from '../src/integrations/registry.js';
import { AirtableConnector } from '../src/integrations/airtable/connector.js';
import { AirtableClient } from '../src/integrations/airtable/client.js';

const config = loadConfig(process.env);

// 1. Initialize Database Client
const dbUrl = config.database?.url;
if (!dbUrl) {
  throw new Error('Database URL is required for startup');
}
const dbClient = new DatabaseClient(dbUrl);

// 2. Initialize Repositories and Stores
const checkpointStore = new PostgresCheckpointStore(dbClient);
const crmRepository = new CrmRepository(dbClient);

// 3. Initialize Airtable Client & Connector
const bases: any[] = [];
if (config.airtable?.pat) {
  if (config.airtable.rentacoatBaseId) {
    bases.push({
      baseId: config.airtable.rentacoatBaseId,
      brandId: 'rent-a-coat',
      transactionsTable: 'Transactions',
      transactionDetailsTable: 'Transaction Detail',
      transactionDetailsSourceUpdatedAt: 'detail_modified',
      transactionDetailTransactionLink: 'transaction_link',
      fieldMap: {
        documentNumbers: ['rental_doc', 'sale_doc'],
        documentDate: 'document_date',
        branchId: 'branch_code',
        amounts: {
          grossAmount: 'gross_baht',
          discountAmount: 'discount_baht',
          netBeforeVat: 'before_vat_baht',
          vatAmount: 'vat_baht',
          documentTotal: 'total_baht',
          cashCollected: 'cash_baht',
          depositAmount: 'deposit_baht',
          refundAmount: 'refund_baht',
        },
        sourceUpdatedAt: 'source_modified',
        destination: 'destination_text',
        paidAt: 'paid_at',
        customerReference: 'customer_ref',
        customerName: 'customer_name',
        bootsHeight: 'boots-height',
        bagCapacity: 'bag-capacity',
        pantsLength: 'pants-length',
        shirtLength: 'shirt-length',
        color: 'color',
        size: 'size',
      },
      branches: {
        R9: 'rac-rama9',
        VIB: 'rac-vibhavadi',
      },
    });
  }

  if (config.airtable.gomallBaseId) {
    bases.push({
      baseId: config.airtable.gomallBaseId,
      brandId: 'go-mall',
      transactionsTable: 'Transactions',
      transactionDetailsTable: 'Transaction Detail',
      transactionDetailsSourceUpdatedAt: 'detail_changed',
      transactionDetailTransactionLink: 'transaction_link',
      fieldMap: {
        documentNumbers: ['document_no'],
        documentDate: 'issued_at',
        branchId: 'store_code',
        amounts: {
          grossAmount: 'subtotal',
          discountAmount: 'promo',
          netBeforeVat: 'tax_base',
          vatAmount: 'tax',
          documentTotal: 'grand_total',
          cashCollected: 'received',
          depositAmount: 'held_deposit',
          refundAmount: 'returned',
        },
        sourceUpdatedAt: 'last_changed',
        destination: 'trip_destination',
        customerReference: 'customer_phone',
        customerName: 'customer_name',
        bootsHeight: 'boots-height',
        bagCapacity: 'bag-capacity',
        pantsLength: 'pants-length',
        shirtLength: 'shirt-length',
        color: 'color',
        size: 'size',
      },
      branches: {
        'GM-R9': 'gomall-rama9',
        PFS: 'phetkasem-future',
      },
    });
  }
}

const airtableClient = new AirtableClient({
  apiUrl: config.airtable?.apiUrl || 'https://api.airtable.com',
  token: config.airtable?.pat || '',
  fetch: globalThis.fetch,
});

const hashCustomerReference = (reference: string) =>
  createHash('sha256').update(reference).digest('hex');

const airtableConnector = new AirtableConnector({
  id: 'airtable',
  client: airtableClient,
  bases,
  hashCustomerReference,
});

// 4. Initialize Registry & Sync Service
const registry = new IntegrationRegistry([airtableConnector]);
const syncService = new SyncService(registry, {
  checkpointStore,
  crmRepository,
  now: () => new Date(),
  generateRunId: () => crypto.randomUUID(),
});

const authorization = async () => undefined;

const app = buildApp({
  integrationRoutes: {
    registry,
    syncService,
    authorization,
  },
});

export default async function handler(req: any, res: any) {
  await app.ready();
  app.server.emit('request', req, res);
}

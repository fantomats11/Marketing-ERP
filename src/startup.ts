import { z } from 'zod';
import { createHash } from 'node:crypto';
import { buildApp, type BuildAppOptions } from './app.js';
import type { AppConfig } from './config/env.js';
import { DatabaseClient } from './config/database.js';
import { PostgresCheckpointStore } from './sync/postgres-checkpoint-store.js';
import { CrmRepository } from './sync/crm-repository.js';
import { SyncService } from './sync/sync-service.js';
import { IntegrationRegistry } from './integrations/registry.js';
import { AirtableConnector } from './integrations/airtable/connector.js';
import { AirtableClient } from './integrations/airtable/client.js';

const portSchema = z.coerce.number().int().min(1).max(65_535);

export interface StartupApp {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface StartupDependencies {
  buildApp?: (options?: BuildAppOptions) => StartupApp;
  logError?: (message: string) => void;
  setExitCode?: (code: number) => void;
}

export async function startApplication(
  config: AppConfig,
  dependencies: StartupDependencies = {},
): Promise<void> {
  const createApp = dependencies.buildApp ?? buildApp;
  const logError = dependencies.logError ?? ((message: string) => console.error(message));
  const setExitCode = dependencies.setExitCode ?? ((code: number) => {
    process.exitCode = code;
  });
  let app: StartupApp | undefined;
  let dbClient: DatabaseClient | undefined;

  try {
    const port = portSchema.parse(config.port);

    const dbUrl = config.database?.url;
    if (!dbUrl) {
      throw new Error('Database URL is required for startup');
    }
    dbClient = new DatabaseClient(dbUrl);

    const checkpointStore = new PostgresCheckpointStore(dbClient);
    const crmRepository = new CrmRepository(dbClient);

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

    const registry = new IntegrationRegistry([airtableConnector]);
    const syncService = new SyncService(registry, {
      checkpointStore,
      crmRepository,
      now: () => new Date(),
      generateRunId: () => crypto.randomUUID(),
    });

    const authorization = async () => undefined;

    app = createApp({
      integrationRoutes: {
        registry,
        syncService,
        authorization,
      },
    });
    await app.listen({ host: '0.0.0.0', port });
  } catch {
    logError('Application startup failed');
    setExitCode(1);
    await dbClient?.close().catch(() => undefined);
    await app?.close().catch(() => undefined);
  }
}

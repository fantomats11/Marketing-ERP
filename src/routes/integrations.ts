import type { FastifyInstance, preHandlerHookHandler } from 'fastify';

import { DatabaseClient } from '../config/database.js';
import {
  IntegrationNotFoundError,
  IntegrationRegistry,
} from '../integrations/registry.js';
import {
  IntegrationSyncAlreadyRunningError,
  SafePublicWarningCodes,
  SyncFailureCodes,
  SyncService,
} from '../sync/sync-service.js';

export interface IntegrationRouteDependencies {
  readonly registry: IntegrationRegistry;
  readonly syncService: SyncService;
  readonly authorization: preHandlerHookHandler;
  readonly dbClient?: DatabaseClient;
}

export class IntegrationAuthorizationRequiredError extends Error {
  public constructor() {
    super('Integration route authorization is required');
    this.name = 'IntegrationAuthorizationRequiredError';
  }
}

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: { error: { type: 'string' } },
} as const;

const runningRunSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['integrationId', 'runId', 'status', 'startedAt'],
  properties: {
    integrationId: { type: 'string' },
    runId: { type: 'string' },
    status: { const: 'running' },
    startedAt: { type: 'string' },
  },
} as const;

const completedRunSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'integrationId', 'runId', 'status', 'startedAt', 'completedAt', 'counts', 'warnings',
  ],
  properties: {
    integrationId: { type: 'string' },
    runId: { type: 'string' },
    status: { const: 'completed' },
    startedAt: { type: 'string' },
    completedAt: { type: 'string' },
    counts: {
      type: 'object',
      additionalProperties: false,
      required: ['fetched', 'created', 'updated', 'skipped'],
      properties: {
        fetched: { type: 'integer' },
        created: { type: 'integer' },
        updated: { type: 'integer' },
        skipped: { type: 'integer' },
      },
    },
    warnings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'count'],
        properties: {
          code: { type: 'string', enum: SafePublicWarningCodes },
          count: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const;

const failedRunSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['integrationId', 'runId', 'status', 'startedAt', 'completedAt', 'errorCode'],
  properties: {
    integrationId: { type: 'string' },
    runId: { type: 'string' },
    status: { const: 'failed' },
    startedAt: { type: 'string' },
    completedAt: { type: 'string' },
    errorCode: { type: 'string', enum: SyncFailureCodes },
  },
} as const;

const statusSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['integrationId', 'status'],
      properties: {
        integrationId: { type: 'string' },
        status: { const: 'idle' },
      },
    },
    runningRunSchema,
    completedRunSchema,
    failedRunSchema,
  ],
} as const;

export function registerIntegrationRoutes(
  app: FastifyInstance,
  dependencies: IntegrationRouteDependencies,
): void {
  if (typeof dependencies.authorization !== 'function') {
    throw new IntegrationAuthorizationRequiredError();
  }

  app.get('/api/integrations', {
    preHandler: dependencies.authorization,
    schema: {
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'status'],
            properties: {
              id: { type: 'string' },
              status: {
                type: 'string',
                enum: ['healthy', 'degraded', 'unavailable', 'unconfigured'],
              },
            },
          },
        },
        500: errorSchema,
      },
    },
  }, async (_request, reply) => {
    try {
      return await dependencies.registry.listHealth();
    } catch {
      return reply.code(500).send({ error: 'INTEGRATION_HEALTH_UNAVAILABLE' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/integrations/:id/status', {
    preHandler: dependencies.authorization,
    schema: { response: { 200: statusSchema, 404: errorSchema, 500: errorSchema } },
  }, async (request, reply) => {
    try {
      return dependencies.syncService.getStatus(request.params.id);
    } catch (error) {
      if (error instanceof IntegrationNotFoundError) {
        return reply.code(404).send({ error: 'INTEGRATION_NOT_FOUND' });
      }
      return reply.code(500).send({ error: 'INTEGRATION_STATUS_UNAVAILABLE' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/integrations/:id/sync', {
    preHandler: dependencies.authorization,
    schema: {
      response: { 202: runningRunSchema, 404: errorSchema, 409: errorSchema, 500: errorSchema },
    },
  }, async (request, reply) => {
    try {
      const handle = dependencies.syncService.runIncremental(request.params.id);
      void handle.completion.catch(() => undefined);
      return reply.code(202).send(handle.run);
    } catch (error) {
      if (error instanceof IntegrationNotFoundError) {
        return reply.code(404).send({ error: 'INTEGRATION_NOT_FOUND' });
      }
      if (error instanceof IntegrationSyncAlreadyRunningError) {
        return reply.code(409).send({ error: 'INTEGRATION_SYNC_ALREADY_RUNNING' });
      }
      return reply.code(500).send({ error: 'INTEGRATION_SYNC_REJECTED' });
    }
  });

  app.get('/api/crm/summary', {
    preHandler: dependencies.authorization,
  }, async (_request, reply) => {
    const dbClient = dependencies.dbClient;
    if (!dbClient) {
      return {
        totalLeads: 0,
        totalValueBaht: 0,
        stageCounts: { new: 0, qualified: 0, reserved_or_added_to_cart: 0, paid: 0, completed: 0 },
        recentLeads: [],
      };
    }
    try {
      const leadsCountResult = await dbClient.query('SELECT COUNT(*) as count, COALESCE(SUM(estimated_basket_value), 0) as total_value FROM public.leads');
      const stageCountsResult = await dbClient.query('SELECT stage, COUNT(*) as count FROM public.pipeline_items GROUP BY stage');
      const recentLeadsResult = await dbClient.query(`
        SELECT l.customer_name, l.destination, l.trip_date, l.estimated_basket_value, p.stage, p.brand_route
        FROM public.leads l
        LEFT JOIN public.pipeline_items p ON p.lead_id = l.id
        ORDER BY l.trip_date DESC LIMIT 10
      `);

      const totalLeads = parseInt(leadsCountResult.rows[0]?.count || '0', 10);
      const totalValueSatang = parseInt(leadsCountResult.rows[0]?.total_value || '0', 10);

      const stageCounts: Record<string, number> = {
        new: 0,
        qualified: 0,
        reserved_or_added_to_cart: 0,
        paid: 0,
        completed: 0,
      };
      for (const row of stageCountsResult.rows) {
        if (row.stage) {
          stageCounts[row.stage] = parseInt(row.count, 10);
        }
      }

      const recentLeads = (recentLeadsResult.rows || []).map((row: any) => ({
        customerName: row.customer_name,
        destination: row.destination,
        tripDate: row.trip_date,
        estimatedBasketValue: parseInt(row.estimated_basket_value || '0', 10) / 100,
        stage: row.stage,
        brandRoute: row.brand_route,
      }));

      return {
        totalLeads,
        totalValueBaht: totalValueSatang / 100,
        stageCounts,
        recentLeads,
      };
    } catch {
      return {
        totalLeads: 0,
        totalValueBaht: 0,
        stageCounts: { new: 0, qualified: 0, reserved_or_added_to_cart: 0, paid: 0, completed: 0 },
        recentLeads: [],
      };
    }
  });
}

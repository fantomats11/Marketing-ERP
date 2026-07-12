import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { IntegrationRegistry } from '../../src/integrations/registry.js';
import type { IntegrationConnector, SyncResult } from '../../src/integrations/types.js';
import {
  IntegrationAuthorizationRequiredError,
  registerIntegrationRoutes,
} from '../../src/routes/integrations.js';
import { SyncService, type SyncCommitStore } from '../../src/sync/sync-service.js';

const result: SyncResult = {
  cursor: { updatedAt: '2026-07-12T02:00:00.000Z', sourceRecordId: 'rec-12' },
  counts: { fetched: 4, created: 2, updated: 1, skipped: 1 },
  warnings: [{ code: 'UNKNOWN_BRANCH', count: 1 }],
};

describe('integration routes', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('returns a normalized health list and invokes the authorization pre-handler', async () => {
    const authorization = vi.fn<preHandlerHookHandler>(async () => undefined);
    const dependencies = createDependencies([
      createConnector('z-provider', async () => result, 'degraded'),
      createConnector('a-provider', async () => result, 'healthy'),
    ]);
    app = buildApp({ integrationRoutes: { ...dependencies, authorization } });

    const response = await app.inject({ method: 'GET', url: '/api/integrations' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { id: 'a-provider', status: 'healthy' },
      { id: 'z-provider', status: 'degraded' },
    ]);
    expect(authorization).toHaveBeenCalledOnce();
  });

  test('returns 404 for unknown status and sync requests', async () => {
    const dependencies = createDependencies([createConnector('airtable', async () => result)]);
    app = buildApp({ integrationRoutes: { ...dependencies, authorization: async () => undefined } });

    const [status, sync] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/integrations/unknown/status' }),
      app.inject({ method: 'POST', url: '/api/integrations/unknown/sync' }),
    ]);

    expect(status.statusCode).toBe(404);
    expect(status.json()).toEqual({ error: 'INTEGRATION_NOT_FOUND' });
    expect(sync.statusCode).toBe(404);
    expect(sync.json()).toEqual({ error: 'INTEGRATION_NOT_FOUND' });
  });

  test('returns idle and latest safe status schemas without provider payloads', async () => {
    const secret = 'raw provider response with token';
    const connector = createConnector('airtable', async () => { throw new Error(secret); });
    const dependencies = createDependencies([connector]);
    app = buildApp({ integrationRoutes: { ...dependencies, authorization: async () => undefined } });

    const idle = await app.inject({ method: 'GET', url: '/api/integrations/airtable/status' });
    expect(idle.json()).toEqual({ integrationId: 'airtable', status: 'idle' });

    const accepted = await app.inject({ method: 'POST', url: '/api/integrations/airtable/sync' });
    expect(accepted.statusCode).toBe(202);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const failed = await app.inject({ method: 'GET', url: '/api/integrations/airtable/status' });

    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toEqual({
      integrationId: 'airtable',
      runId: 'route-run',
      status: 'failed',
      startedAt: '2026-07-12T01:00:00.000Z',
      completedAt: '2026-07-12T01:05:00.000Z',
      errorCode: 'CONNECTOR_SYNC_FAILED',
    });
    expect(failed.body).not.toContain(secret);
  });

  test('returns 202 immediately while provider completion remains pending and 409 for a duplicate', async () => {
    let release: ((value: SyncResult) => void) | undefined;
    const pending = new Promise<SyncResult>((resolve) => { release = resolve; });
    const dependencies = createDependencies([
      createConnector('airtable', async () => pending),
    ]);
    app = buildApp({ integrationRoutes: { ...dependencies, authorization: async () => undefined } });

    const accepted = await app.inject({ method: 'POST', url: '/api/integrations/airtable/sync' });

    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({
      integrationId: 'airtable',
      runId: 'route-run',
      status: 'running',
      startedAt: '2026-07-12T01:00:00.000Z',
    });
    const duplicate = await app.inject({ method: 'POST', url: '/api/integrations/airtable/sync' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({ error: 'INTEGRATION_SYNC_ALREADY_RUNNING' });

    release?.(result);
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  test('observes detached completion rejection and strips undeclared run fields', async () => {
    const rejectedCompletion = Promise.reject(new Error('secret detached rejection'));
    const catchSpy = vi.spyOn(rejectedCompletion, 'catch');
    const registry = new IntegrationRegistry([createConnector('airtable', async () => result)]);
    const unsafeService = {
      getStatus: () => ({
        integrationId: 'airtable', status: 'failed', runId: 'run',
        startedAt: 'start', completedAt: 'end', errorCode: 'CONNECTOR_SYNC_FAILED',
        rawProviderMessage: 'must not serialize', credentials: 'must not serialize',
      }),
      runIncremental: () => ({
        run: {
          integrationId: 'airtable', runId: 'run', status: 'running', startedAt: 'start',
          rawProviderMessage: 'must not serialize', credentials: 'must not serialize',
        },
        completion: rejectedCompletion,
      }),
    } as unknown as SyncService;
    app = buildApp({
      integrationRoutes: { registry, syncService: unsafeService, authorization: async () => undefined },
    });

    const response = await app.inject({ method: 'POST', url: '/api/integrations/airtable/sync' });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      integrationId: 'airtable', runId: 'run', status: 'running', startedAt: 'start',
    });
    expect(catchSpy).toHaveBeenCalledOnce();
    await expect(rejectedCompletion).rejects.toThrow('secret detached rejection');
  });

  test('does not register internal controls unless all route dependencies are explicitly supplied', async () => {
    app = buildApp({ now: () => new Date('2026-07-12T00:00:00.000Z') });

    const controls = await app.inject({ method: 'GET', url: '/api/integrations' });
    const health = await app.inject({ method: 'GET', url: '/healthz' });

    expect(controls.statusCode).toBe(404);
    expect(health.json()).toEqual({
      ok: true,
      service: 'brandname-marketing-erp',
      timestamp: '2026-07-12T00:00:00.000Z',
    });
  });

  test('can register routes directly with injected dependencies', async () => {
    const dependencies = createDependencies([createConnector('airtable', async () => result)]);
    app = buildApp();
    registerIntegrationRoutes(app, { ...dependencies, authorization: async () => undefined });

    const response = await app.inject({ method: 'GET', url: '/api/integrations' });

    expect(response.statusCode).toBe(200);
  });

  test('fails closed before direct route registration when authorization is undefined at runtime', () => {
    const dependencies = createDependencies([createConnector('airtable', async () => result)]);
    app = buildApp();

    expect(() => registerIntegrationRoutes(app!, {
      ...dependencies,
      authorization: undefined,
    } as unknown as Parameters<typeof registerIntegrationRoutes>[1]))
      .toThrow(IntegrationAuthorizationRequiredError);
    expect(app.hasRoute({ method: 'GET', url: '/api/integrations' })).toBe(false);
  });

  test('buildApp fails closed before integration routes register when authorization is undefined', () => {
    const dependencies = createDependencies([createConnector('airtable', async () => result)]);

    expect(() => buildApp({
      integrationRoutes: { ...dependencies, authorization: undefined },
    } as unknown as Parameters<typeof buildApp>[0]))
      .toThrow(IntegrationAuthorizationRequiredError);
  });
});

function createDependencies(connectors: readonly IntegrationConnector[]): {
  registry: IntegrationRegistry;
  syncService: SyncService;
} {
  const registry = new IntegrationRegistry(connectors);
  const times = [new Date('2026-07-12T01:00:00.000Z'), new Date('2026-07-12T01:05:00.000Z')];
  const syncCommitStore: SyncCommitStore = {
    getCheckpoint: async () => undefined,
    commit: async (command) => ({ status: 'committed', completedRun: command.completedRun }),
  };
  return {
    registry,
    syncService: new SyncService(registry, {
      syncCommitStore,
      now: () => times.shift() ?? new Date('2026-07-12T01:05:00.000Z'),
      generateRunId: () => 'route-run',
    }),
  };
}

function createConnector(
  id: string,
  syncIncremental: IntegrationConnector['syncIncremental'],
  healthStatus: 'healthy' | 'degraded' = 'healthy',
): IntegrationConnector {
  return {
    id,
    healthCheck: async () => ({ status: healthStatus }),
    syncIncremental,
    syncBackfill: async () => result,
  };
}

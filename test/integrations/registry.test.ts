import { describe, expect, test } from 'vitest';

import {
  DuplicateIntegrationIdError,
  IntegrationNotFoundError,
  IntegrationRegistry,
} from '../../src/integrations/registry.js';
import type {
  ConnectorHealthResult,
  IntegrationConnector,
  IntegrationHealthStatus,
  SyncResult,
} from '../../src/integrations/types.js';

const emptySyncResult: SyncResult = {
  counts: {
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
  },
  warnings: [],
};

describe('IntegrationRegistry', () => {
  test('rejects duplicate connector IDs with a typed error', () => {
    const connector = createConnector('airtable-rentacoat', 'healthy');

    expect(() => new IntegrationRegistry([connector, connector])).toThrow(
      DuplicateIntegrationIdError,
    );
  });

  test('throws a typed error for a missing connector ID', () => {
    const registry = new IntegrationRegistry([createConnector('airtable-rentacoat', 'healthy')]);

    expect(() => registry.get('unknown')).toThrow(IntegrationNotFoundError);
  });

  test('lists health in stable connector-ID order', async () => {
    const registry = new IntegrationRegistry([
      createConnector('gomall-airtable', 'degraded'),
      createConnector('rentacoat-airtable', 'healthy'),
    ]);

    await expect(registry.listHealth()).resolves.toEqual([
      { id: 'gomall-airtable', status: 'degraded' },
      { id: 'rentacoat-airtable', status: 'healthy' },
    ]);
  });

  test('keeps healthy results and returns a safe unavailable status when a provider fails', async () => {
    const registry = new IntegrationRegistry([
      createConnector('healthy-provider', 'healthy'),
      createConnector('unavailable-provider', 'healthy', async () => {
        throw new Error('provider response includes secret details');
      }),
    ]);

    const health = await registry.listHealth();

    expect(health).toEqual([
      { id: 'healthy-provider', status: 'healthy' },
      { id: 'unavailable-provider', status: 'unavailable' },
    ]);
    expect(JSON.stringify(health)).not.toContain('provider response includes secret details');
  });

  test('contains synchronous health-check throws while preserving healthy results and ID order', async () => {
    const registry = new IntegrationRegistry([
      createConnector('healthy-provider', 'healthy'),
      createConnector('unavailable-provider', 'healthy', () => {
        throw new Error('synchronous provider failure');
      }),
    ]);

    await expect(registry.listHealth()).resolves.toEqual([
      { id: 'healthy-provider', status: 'healthy' },
      { id: 'unavailable-provider', status: 'unavailable' },
    ]);
  });

  test('contains throwing status getters without exposing their errors', async () => {
    const secret = 'secret status failure';
    const malformedResult = {};
    Object.defineProperty(malformedResult, 'status', {
      get: () => {
        throw new Error(secret);
      },
    });
    const registry = new IntegrationRegistry([
      createConnector('healthy-provider', 'healthy'),
      createConnector('malformed-provider', 'healthy', async () =>
        malformedResult as ConnectorHealthResult,
      ),
    ]);

    const health = await registry.listHealth();

    expect(health).toEqual([
      { id: 'healthy-provider', status: 'healthy' },
      { id: 'malformed-provider', status: 'unavailable' },
    ]);
    expect(JSON.stringify(health)).not.toContain(secret);
  });
});

function createConnector(
  id: string,
  status: IntegrationHealthStatus,
  healthCheck: () => Promise<ConnectorHealthResult> = async () => ({ status }),
): IntegrationConnector {
  return {
    id,
    healthCheck,
    syncIncremental: async () => emptySyncResult,
    syncBackfill: async () => emptySyncResult,
  };
}

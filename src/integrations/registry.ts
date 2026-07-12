import {
  IntegrationHealthStatuses,
  type IntegrationConnector,
  type IntegrationHealth,
  type IntegrationHealthStatus,
} from './types.js';

export class DuplicateIntegrationIdError extends Error {
  public readonly integrationId: string;

  public constructor(integrationId: string) {
    super(`Duplicate integration ID: ${integrationId}`);
    this.name = 'DuplicateIntegrationIdError';
    this.integrationId = integrationId;
  }
}

export class IntegrationNotFoundError extends Error {
  public readonly integrationId: string;

  public constructor(integrationId: string) {
    super(`Integration not found: ${integrationId}`);
    this.name = 'IntegrationNotFoundError';
    this.integrationId = integrationId;
  }
}

export class IntegrationRegistry {
  private readonly connectors: ReadonlyMap<string, IntegrationConnector>;

  public constructor(connectors: readonly IntegrationConnector[]) {
    const connectorMap = new Map<string, IntegrationConnector>();

    for (const connector of connectors) {
      if (connectorMap.has(connector.id)) {
        throw new DuplicateIntegrationIdError(connector.id);
      }

      connectorMap.set(connector.id, connector);
    }

    this.connectors = connectorMap;
  }

  public get(id: string): IntegrationConnector {
    const connector = this.connectors.get(id);
    if (connector === undefined) {
      throw new IntegrationNotFoundError(id);
    }

    return connector;
  }

  public async listHealth(): Promise<readonly IntegrationHealth[]> {
    const connectors = [...this.connectors.values()].sort(compareConnectorsById);
    const results = await Promise.allSettled(
      connectors.map((connector) => Promise.resolve().then(() => connector.healthCheck())),
    );

    return results.map((result, index) => normalizeHealth(connectors[index]!.id, result));
  }
}

function compareConnectorsById(left: IntegrationConnector, right: IntegrationConnector): number {
  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

function normalizeHealth(
  id: string,
  result: PromiseSettledResult<unknown>,
): IntegrationHealth {
  try {
    if (result.status === 'rejected') {
      return { id, status: 'unavailable' };
    }

    return {
      id,
      status: healthStatusFrom(result.value),
    };
  } catch {
    return { id, status: 'unavailable' };
  }
}

function healthStatusFrom(value: unknown): IntegrationHealthStatus {
  if (typeof value !== 'object' || value === null || !('status' in value)) {
    return 'unavailable';
  }

  return IntegrationHealthStatuses.includes(value.status as IntegrationHealthStatus)
    ? (value.status as IntegrationHealthStatus)
    : 'unavailable';
}

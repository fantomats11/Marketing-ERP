export const IntegrationHealthStatuses = [
  'healthy',
  'degraded',
  'unavailable',
  'unconfigured',
] as const;

export type IntegrationHealthStatus = (typeof IntegrationHealthStatuses)[number];

/** A connector's internal health result before the registry normalizes it for public use. */
export interface ConnectorHealthResult {
  readonly status: IntegrationHealthStatus;
}

/** The only health shape exposed to callers outside an integration connector. */
export interface IntegrationHealth {
  readonly id: string;
  readonly status: IntegrationHealthStatus;
}

export interface SyncCursor {
  readonly updatedAt: string;
  readonly sourceRecordId: string;
}

export interface SyncWindow {
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface SyncCounts {
  readonly fetched: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
}

export interface SyncWarning {
  readonly code: string;
  readonly count: number;
}

export interface SyncResult {
  readonly cursor?: SyncCursor;
  readonly counts: SyncCounts;
  readonly warnings: readonly SyncWarning[];
}

export interface IncrementalSyncRequest {
  readonly cursor?: SyncCursor;
}

export interface BackfillSyncRequest {
  readonly window: SyncWindow;
}

export interface IntegrationConnector {
  readonly id: string;
  healthCheck(): Promise<ConnectorHealthResult>;
  syncIncremental(request: IncrementalSyncRequest): Promise<SyncResult>;
  syncBackfill(request: BackfillSyncRequest): Promise<SyncResult>;
}

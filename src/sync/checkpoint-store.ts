import type { SyncCursor } from '../integrations/types.js';

export interface CheckpointStore {
  get(integrationId: string): Promise<SyncCursor | undefined>;
  put(integrationId: string, cursor: SyncCursor): Promise<void>;
}

import type { SyncCursor } from '../integrations/types.js';
import type { CheckpointStore } from './checkpoint-store.js';

export class MemoryCheckpointStore implements CheckpointStore {
  private readonly checkpoints = new Map<string, SyncCursor>();

  public async get(integrationId: string): Promise<SyncCursor | undefined> {
    const cursor = this.checkpoints.get(integrationId);
    return cursor === undefined ? undefined : copyCursor(cursor);
  }

  public async put(integrationId: string, cursor: SyncCursor): Promise<void> {
    this.checkpoints.set(integrationId, copyCursor(cursor));
  }
}

function copyCursor(cursor: SyncCursor): SyncCursor {
  return {
    updatedAt: cursor.updatedAt,
    sourceRecordId: cursor.sourceRecordId,
  };
}

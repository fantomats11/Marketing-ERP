import type { DatabaseClient } from '../config/database.js';
import type { CheckpointStore } from './checkpoint-store.js';
import type { SyncCursor } from '../integrations/types.js';

export class PostgresCheckpointStore implements CheckpointStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async get(integrationId: string): Promise<SyncCursor | undefined> {
    const res = await this.db.query(
      `SELECT metadata->'cursor' as cursor FROM public.sync_runs 
       WHERE data_source_id = $1 AND status = 'completed' 
       ORDER BY finished_at DESC LIMIT 1`,
      [integrationId],
    );
    const cursor = res.rows[0]?.cursor;
    return cursor ? cursor : undefined;
  }

  public async put(integrationId: string, cursor: SyncCursor): Promise<void> {
    await this.db.query(
      `INSERT INTO public.sync_runs (id, data_source_id, status, started_at, finished_at, metadata) 
       VALUES (gen_random_uuid(), $1, 'completed', now(), now(), jsonb_build_object('cursor', $2::jsonb))`,
      [integrationId, JSON.stringify(cursor)],
    );
  }
}

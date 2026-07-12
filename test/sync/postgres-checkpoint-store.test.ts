import { describe, expect, test, vi, beforeEach } from 'vitest';
import { PostgresCheckpointStore } from '../../src/sync/postgres-checkpoint-store.js';
import type { DatabaseClient } from '../../src/config/database.js';
import type { SyncCursor } from '../../src/integrations/types.js';

describe('PostgresCheckpointStore', () => {
  let mockDb: any;
  let store: PostgresCheckpointStore;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    store = new PostgresCheckpointStore(mockDb as unknown as DatabaseClient);
  });

  test('get returns undefined when no run is found', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });

    const result = await store.get('test-integration');

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
      ['test-integration'],
    );
    expect(result).toBeUndefined();
  });

  test('get returns the cursor from the latest completed run', async () => {
    const expectedCursor: SyncCursor = {
      updatedAt: '2026-07-12T01:00:00Z',
      sourceRecordId: 'rec123',
    };
    mockDb.query.mockResolvedValueOnce({
      rows: [{ cursor: expectedCursor }],
    });

    const result = await store.get('test-integration');

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
      ['test-integration'],
    );
    expect(result).toEqual(expectedCursor);
  });

  test('put inserts a new sync run record containing the serialized cursor', async () => {
    const cursor: SyncCursor = {
      updatedAt: '2026-07-12T02:00:00Z',
      sourceRecordId: 'rec456',
    };
    mockDb.query.mockResolvedValueOnce({ rows: [] });

    await store.put('test-integration', cursor);

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT'),
      ['test-integration', JSON.stringify(cursor)],
    );
  });
});

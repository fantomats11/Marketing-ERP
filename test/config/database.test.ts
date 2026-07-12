import { describe, expect, test, vi, beforeEach } from 'vitest';
import pg from 'pg';
import { DatabaseClient } from '../../src/config/database.js';

vi.mock('pg', () => {
  const mClient = {
    release: vi.fn(),
    query: vi.fn(),
  };
  const mPool = {
    connect: vi.fn().mockResolvedValue(mClient),
    query: vi.fn(),
    end: vi.fn(),
  };
  return {
    default: {
      Pool: vi.fn(() => mPool),
    },
  };
});

describe('DatabaseClient', () => {
  let client: DatabaseClient;
  let poolInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DatabaseClient('postgresql://postgres:postgres@localhost:5432/postgres');
    // Get the mocked pool instance
    const poolMock = vi.mocked(pg.Pool);
    poolInstance = poolMock.mock.results[0]?.value;
  });

  test('forwards query parameters to the connection pool', async () => {
    const mockResult = { rows: [{ id: 1, name: 'Test' }], rowCount: 1 };
    poolInstance.query.mockResolvedValueOnce(mockResult);

    const queryText = 'SELECT * FROM users WHERE id = $1';
    const params = [1];
    const result = await client.query(queryText, params);

    expect(poolInstance.query).toHaveBeenCalledWith(queryText, params);
    expect(result).toEqual(mockResult);
  });

  test('connects to pool and retrieves client', async () => {
    const mockClient = { release: vi.fn(), query: vi.fn() };
    poolInstance.connect.mockResolvedValueOnce(mockClient);

    const connection = await client.connect();
    expect(poolInstance.connect).toHaveBeenCalled();
    expect(connection).toBe(mockClient);
  });

  test('closes the connection pool', async () => {
    poolInstance.end.mockResolvedValueOnce(undefined);

    await client.close();

    expect(poolInstance.end).toHaveBeenCalled();
  });
});

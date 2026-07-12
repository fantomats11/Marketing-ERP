import pg from 'pg';

export class DatabaseClient {
  private readonly pool: pg.Pool;

  public constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  public async connect(): Promise<pg.PoolClient> {
    return this.pool.connect();
  }

  public async query<T extends pg.QueryResultRow = any>(
    text: string,
    params?: any[],
  ): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

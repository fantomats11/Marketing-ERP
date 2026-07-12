export type AirtableFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface AirtableRecord {
  readonly id: string;
  readonly createdTime?: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface AirtableRecordPage {
  readonly records: readonly AirtableRecord[];
  readonly offset?: string;
}

export interface ListRecordsRequest {
  readonly baseId: string;
  readonly table: string;
  readonly view?: string;
  readonly filterByFormula?: string;
  readonly offset?: string;
  readonly maxRecords?: number;
}

export type AirtableClientErrorCode =
  | 'AIRTABLE_HTTP_ERROR'
  | 'AIRTABLE_INVALID_RESPONSE'
  | 'AIRTABLE_REQUEST_FAILED'
  | 'AIRTABLE_TIMEOUT';

export class AirtableClientError extends Error {
  public readonly code: AirtableClientErrorCode;
  public readonly status?: number;

  public constructor(code: AirtableClientErrorCode, status?: number) {
    super(safeErrorMessage(code, status));
    this.name = 'AirtableClientError';
    this.code = code;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export interface AirtableClientOptions {
  readonly apiUrl: string;
  readonly token: string;
  readonly fetch: AirtableFetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxRetryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;

export class AirtableClient {
  private readonly apiUrl: string;
  private readonly token: string;
  private readonly fetch: AirtableFetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRetryDelayMs: number;

  public constructor(options: AirtableClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetch = options.fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  }

  public async listRecords(request: ListRecordsRequest): Promise<AirtableRecordPage> {
    const url = createListRecordsUrl(this.apiUrl, request);

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const result = await this.request(url);
      if (!(result instanceof Response)) {
        return result;
      }

      if (isRetryable(result.status) && attempt < this.maxRetries) {
        await this.sleep(retryDelayMs(result.headers.get('Retry-After'), this.maxRetryDelayMs));
        continue;
      }

      throw new AirtableClientError('AIRTABLE_HTTP_ERROR', result.status);
    }

    throw new AirtableClientError('AIRTABLE_REQUEST_FAILED');
  }

  private async request(url: URL): Promise<AirtableRecordPage | Response> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutError = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new AirtableClientError('AIRTABLE_TIMEOUT'));
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([
        this.fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.token}` },
          signal: controller.signal,
        }).then(async (response) => (response.ok ? parseRecordPage(response) : response)),
        timeoutError,
      ]);
    } catch (error) {
      if (error instanceof AirtableClientError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new AirtableClientError('AIRTABLE_TIMEOUT');
      }
      throw new AirtableClientError('AIRTABLE_REQUEST_FAILED');
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}

function createListRecordsUrl(apiUrl: string, request: ListRecordsRequest): URL {
  const url = new URL(
    `${apiUrl}/v0/${encodeURIComponent(request.baseId)}/${encodeURIComponent(request.table)}`,
  );
  appendQuery(url, 'view', request.view);
  appendQuery(url, 'filterByFormula', request.filterByFormula);
  appendQuery(url, 'offset', request.offset);
  if (request.maxRecords !== undefined) {
    url.searchParams.set('maxRecords', String(request.maxRecords));
  }
  return url;
}

function appendQuery(url: URL, name: string, value: string | undefined): void {
  if (value !== undefined) {
    url.searchParams.set(name, value);
  }
}

async function parseRecordPage(response: Response): Promise<AirtableRecordPage> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AirtableClientError('AIRTABLE_INVALID_RESPONSE');
  }

  if (!isRecordPage(value)) {
    throw new AirtableClientError('AIRTABLE_INVALID_RESPONSE');
  }

  return value;
}

function isRecordPage(value: unknown): value is AirtableRecordPage {
  if (typeof value !== 'object' || value === null || !('records' in value)) {
    return false;
  }

  const page = value as { records?: unknown; offset?: unknown };
  return Array.isArray(page.records)
    && page.records.every(isAirtableRecord)
    && (page.offset === undefined || typeof page.offset === 'string');
}

function isAirtableRecord(value: unknown): value is AirtableRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as { id?: unknown; createdTime?: unknown; fields?: unknown };
  return typeof record.id === 'string'
    && typeof record.fields === 'object'
    && record.fields !== null
    && (record.createdTime === undefined || typeof record.createdTime === 'string');
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(retryAfter: string | null, maximum: number): number {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, maximum);
    }

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay >= 0) {
      return Math.min(dateDelay, maximum);
    }
  }

  return Math.min(DEFAULT_RETRY_DELAY_MS, maximum);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeErrorMessage(code: AirtableClientErrorCode, status?: number): string {
  return status === undefined
    ? `Airtable request failed (${code})`
    : `Airtable request failed (${code}, status ${status})`;
}

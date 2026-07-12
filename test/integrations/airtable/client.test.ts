import { describe, expect, test, vi } from 'vitest';

import {
  AirtableClient,
  AirtableClientError,
  type AirtableFetch,
} from '../../../src/integrations/airtable/client.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('AirtableClient', () => {
  test('encodes base, table, query values, and forwards page offsets with authorization', async () => {
    const fetch = vi.fn<AirtableFetch>()
      .mockResolvedValueOnce(jsonResponse({ records: [{ id: 'rec-1', fields: {} }], offset: 'next page/+=' }))
      .mockResolvedValueOnce(jsonResponse({ records: [{ id: 'rec-2', fields: {} }] }));
    const client = new AirtableClient({
      apiUrl: 'https://api.airtable.test/root path',
      token: 'pat-secret-value',
      fetch,
    });

    const first = await client.listRecords({
      baseId: 'app /หนึ่ง',
      table: 'Transactions / รายการ',
      view: 'Main & Ready',
      filterByFormula: "{Status}='Ready / Go'",
      maxRecords: 1,
    });
    const second = await client.listRecords({
      baseId: 'app /หนึ่ง',
      table: 'Transactions / รายการ',
      offset: first.offset!,
    });

    expect(first.records).toEqual([{ id: 'rec-1', fields: {} }]);
    expect(second.records).toEqual([{ id: 'rec-2', fields: {} }]);
    const firstUrl = new URL(String(fetch.mock.calls[0]![0]));
    expect(firstUrl.pathname).toBe('/root%20path/v0/app%20%2F%E0%B8%AB%E0%B8%99%E0%B8%B6%E0%B9%88%E0%B8%87/Transactions%20%2F%20%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B8%81%E0%B8%B2%E0%B8%A3');
    expect(firstUrl.searchParams.get('view')).toBe('Main & Ready');
    expect(firstUrl.searchParams.get('filterByFormula')).toBe("{Status}='Ready / Go'");
    expect(firstUrl.searchParams.get('maxRecords')).toBe('1');
    expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get('offset')).toBe('next page/+=');
    expect(fetch.mock.calls[0]![1]).toEqual(expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer pat-secret-value' },
    }));
  });

  test('retries 429 and 5xx responses within a bound and caps Retry-After sleep', async () => {
    const fetch = vi.fn<AirtableFetch>()
      .mockResolvedValueOnce(new Response('rate-limit-private-body', {
        status: 429,
        headers: { 'Retry-After': '999' },
      }))
      .mockResolvedValueOnce(new Response('server-private-body', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ records: [] }));
    const sleep = vi.fn(async () => undefined);
    const client = new AirtableClient({
      apiUrl: 'https://api.airtable.test',
      token: 'pat-secret-value',
      fetch,
      sleep,
      maxRetries: 2,
      maxRetryDelayMs: 2_000,
    });

    await expect(client.listRecords({ baseId: 'app', table: 'Transactions' })).resolves.toEqual({
      records: [],
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 2_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
  });

  test('throws a safe bounded-retry error without token or response body', async () => {
    const fetch = vi.fn<AirtableFetch>().mockResolvedValue(
      new Response('private-record-and-token-like-body', { status: 500 }),
    );
    const client = new AirtableClient({
      apiUrl: 'https://api.airtable.test',
      token: 'pat-secret-value',
      fetch,
      sleep: async () => undefined,
      maxRetries: 1,
    });

    const error = await client.listRecords({ baseId: 'app', table: 'Transactions' })
      .catch((caught: unknown) => caught);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(AirtableClientError);
    expect(JSON.stringify(error)).not.toContain('pat-secret-value');
    expect(String(error)).not.toContain('private-record-and-token-like-body');
    expect(error).toMatchObject({ code: 'AIRTABLE_HTTP_ERROR', status: 500 });
  });

  test('aborts timed-out requests and exposes only a safe timeout error', async () => {
    const fetch = vi.fn<AirtableFetch>(async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const client = new AirtableClient({
      apiUrl: 'https://api.airtable.test',
      token: 'pat-secret-value',
      fetch,
      timeoutMs: 5,
      maxRetries: 0,
    });

    const error = await client.listRecords({ baseId: 'app', table: 'Transactions' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AirtableClientError);
    expect(error).toMatchObject({ code: 'AIRTABLE_TIMEOUT' });
    expect(JSON.stringify(error)).not.toContain('pat-secret-value');
  });

  test('keeps the timeout active until a successful response body finishes parsing', async () => {
    const fetch = vi.fn<AirtableFetch>().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => new Promise<never>(() => undefined),
    } as unknown as Response);
    const client = new AirtableClient({
      apiUrl: 'https://api.airtable.test',
      token: 'pat-secret-value',
      fetch,
      timeoutMs: 5,
      maxRetries: 0,
    });

    await expect(client.listRecords({ baseId: 'app', table: 'Transactions' }))
      .rejects.toMatchObject({ code: 'AIRTABLE_TIMEOUT' });
  });
});

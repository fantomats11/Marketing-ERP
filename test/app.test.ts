import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('application health endpoint', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns the service health contract with the current timestamp', async () => {
    app = buildApp({ now: () => new Date('2026-07-12T00:00:00.000Z') });

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: 'brandname-marketing-erp',
      timestamp: '2026-07-12T00:00:00.000Z',
    });
  });
});

import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerIntegrationRoutes,
  type IntegrationRouteDependencies,
} from './routes/integrations.js';

export interface BuildAppOptions {
  now?: () => Date;
  integrationRoutes?: IntegrationRouteDependencies;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const now = options.now ?? (() => new Date());

  app.get('/healthz', async () => ({
    ok: true,
    service: 'brandname-marketing-erp',
    timestamp: now().toISOString(),
  }));

  if (options.integrationRoutes !== undefined) {
    registerIntegrationRoutes(app, options.integrationRoutes);
  }

  return app;
}

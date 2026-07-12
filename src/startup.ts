import { z } from 'zod';
import { buildApp } from './app.js';
import type { AppConfig } from './config/env.js';

const portSchema = z.coerce.number().int().min(1).max(65_535);

export interface StartupApp {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface StartupDependencies {
  buildApp?: () => StartupApp;
  logError?: (message: string) => void;
  setExitCode?: (code: number) => void;
}

export async function startApplication(
  config: Pick<AppConfig, 'port'>,
  dependencies: StartupDependencies = {},
): Promise<void> {
  const createApp = dependencies.buildApp ?? buildApp;
  const logError = dependencies.logError ?? ((message: string) => console.error(message));
  const setExitCode = dependencies.setExitCode ?? ((code: number) => {
    process.exitCode = code;
  });
  let app: StartupApp | undefined;

  try {
    const port = portSchema.parse(config.port);
    app = createApp();
    await app.listen({ host: '0.0.0.0', port });
  } catch {
    logError('Application startup failed');
    setExitCode(1);
    await app?.close().catch(() => undefined);
  }
}

import { startApplication } from './startup.js';
import { loadConfig } from './config/env.js';

async function run(): Promise<void> {
  try {
    const config = loadConfig(process.env);
    await startApplication(config);
  } catch {
    console.error('Application startup failed');
    process.exitCode = 1;
  }
}

void run();

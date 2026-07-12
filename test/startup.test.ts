import { describe, expect, it } from 'vitest';
import { startApplication, type StartupApp } from '../src/startup.js';

const startupFailure = 'Application startup failed';

describe('application startup', () => {
  it('uses the validated configuration port and listens on all interfaces', async () => {
    const listenCalls: Array<{ host: string; port: number }> = [];
    const app: StartupApp = {
      listen: async (options) => {
        listenCalls.push(options);
      },
      close: async () => {},
    };

    await startApplication({ port: 4321 }, {
      buildApp: () => app,
      logError: () => {},
      setExitCode: () => {},
    });

    expect(listenCalls).toEqual([{ host: '0.0.0.0', port: 4321 }]);
  });

  it('redacts invalid port failures and sets the exit code', async () => {
    const messages: string[] = [];
    const exitCodes: number[] = [];
    let buildCalls = 0;

    await startApplication({ port: Number.NaN }, {
      buildApp: () => {
        buildCalls += 1;
        throw new Error('app should not be built');
      },
      logError: (message) => messages.push(message),
      setExitCode: (code) => exitCodes.push(code),
    });

    expect(buildCalls).toBe(0);
    expect(messages).toEqual([startupFailure]);
    expect(exitCodes).toEqual([1]);
  });

  it('closes the app and redacts listener failures', async () => {
    const messages: string[] = [];
    const exitCodes: number[] = [];
    let closeCalls = 0;
    const app: StartupApp = {
      listen: async () => {
        throw new Error('secret bind details');
      },
      close: async () => {
        closeCalls += 1;
      },
    };

    await startApplication({ port: 4321 }, {
      buildApp: () => app,
      logError: (message) => messages.push(message),
      setExitCode: (code) => exitCodes.push(code),
    });

    expect(closeCalls).toBe(1);
    expect(messages).toEqual([startupFailure]);
    expect(exitCodes).toEqual([1]);
  });
});

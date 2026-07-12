import { describe, expect, test } from 'vitest';

import { ConfigValidationError, loadConfig } from '../../src/config/env.js';

const productionEnvironment = {
  APP_ENV: 'production',
  AIRTABLE_PAT: 'pat-secret-value',
  AIRTABLE_RENTACOAT_BASE_ID: 'appRentacoat',
  AIRTABLE_GOMALL_BASE_ID: 'appGomall',
  GCP_PROJECT_ID: 'brandname-production',
  GCP_REGION: 'asia-southeast1',
  DATABASE_URL: 'postgres://user:database-secret@db.example/marketing',
};

describe('loadConfig', () => {
  test('applies safe defaults and keeps secrets server-side but out of JSON', () => {
    const config = loadConfig(productionEnvironment);

    expect(config.appEnv).toBe('production');
    expect(config.port).toBe(3000);
    expect(config.airtable.apiUrl).toBe('https://api.airtable.com');
    expect(config.sync.intervalMinutes).toBe(15);
    expect(config.airtable.pat).toBe('pat-secret-value');
    expect(config.database.url).toBe('postgres://user:database-secret@db.example/marketing');

    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain('AIRTABLE_PAT');
    expect(serialized).not.toContain('pat-secret-value');
    expect(serialized).not.toContain('DATABASE_URL');
    expect(serialized).not.toContain('database-secret');
  });

  test.each(['staging', 'production'] as const)(
    'requires deployment dependencies in %s',
    (appEnv) => {
      expect(() => loadConfig({ APP_ENV: appEnv })).toThrow(ConfigValidationError);
    },
  );

  test('reports only missing deployment variable names without raw environment values', () => {
    const error = expectConfigError(() =>
      loadConfig({
        APP_ENV: 'production',
        AIRTABLE_PAT: 'pat-should-not-appear',
        UNRELATED_VALUE: 'should-not-appear',
      }),
    );

    expect(error.message).toContain('AIRTABLE_RENTACOAT_BASE_ID');
    expect(error.message).toContain('AIRTABLE_GOMALL_BASE_ID');
    expect(error.message).toContain('GCP_PROJECT_ID');
    expect(error.message).toContain('GCP_REGION');
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).not.toContain('pat-should-not-appear');
    expect(error.message).not.toContain('should-not-appear');
  });

  test('rejects malformed provider URLs by environment variable name', () => {
    const error = expectConfigError(() =>
      loadConfig({
        APP_ENV: 'development',
        AIRTABLE_API_URL: 'not a url',
      }),
    );

    expect(error.message).toContain('AIRTABLE_API_URL');
    expect(error.message).not.toContain('not a url');
  });

  test.each([
    ['http://api.airtable.com', 'http'],
    ['https://airtable-user:airtable-password@api.airtable.com', 'airtable-password'],
  ])('rejects unsafe Airtable API URL %s by variable name only', (url, secret) => {
    const error = expectConfigError(() =>
      loadConfig({
        APP_ENV: 'development',
        AIRTABLE_API_URL: url,
      }),
    );

    expect(error.message).toBe('Invalid environment variables: AIRTABLE_API_URL');
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(url);
  });

  test('rejects malformed or non-postgres DATABASE_URL in production', () => {
    const baseEnv = { ...productionEnvironment };

    // Test non-postgres URL
    const nonPostgresUrl = 'https://example.com';
    const errorNonPostgres = expectConfigError(() =>
      loadConfig({
        ...baseEnv,
        DATABASE_URL: nonPostgresUrl,
      }),
    );
    expect(errorNonPostgres.message).toContain('DATABASE_URL');
    expect(errorNonPostgres.message).not.toContain(nonPostgresUrl);

    // Test malformed URL
    const malformedUrl = 'not-a-url';
    const errorMalformed = expectConfigError(() =>
      loadConfig({
        ...baseEnv,
        DATABASE_URL: malformedUrl,
      }),
    );
    expect(errorMalformed.message).toContain('DATABASE_URL');
    expect(errorMalformed.message).not.toContain(malformedUrl);
  });
});

function expectConfigError(action: () => unknown): ConfigValidationError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }

  throw new Error('Expected configuration validation to fail.');
}

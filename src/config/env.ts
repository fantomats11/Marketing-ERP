import { z } from 'zod';

export const AppEnvSchema = z.enum(['development', 'test', 'staging', 'production']);

export type AppEnv = z.infer<typeof AppEnvSchema>;

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

export type LogLevel = z.infer<typeof LogLevelSchema>;

const RawEnvironmentSchema = z.object({
  APP_ENV: AppEnvSchema.default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: LogLevelSchema.default('info'),
  AIRTABLE_PAT: z.string().min(1).optional(),
  AIRTABLE_RENTACOAT_BASE_ID: z.string().min(1).optional(),
  AIRTABLE_GOMALL_BASE_ID: z.string().min(1).optional(),
  AIRTABLE_API_URL: z.url().refine(isSafeAirtableApiUrl).default('https://api.airtable.com'),
  GCP_PROJECT_ID: z.string().min(1).optional(),
  GCP_REGION: z.string().min(1).optional(),
  DATABASE_URL: z.url().refine(isPostgresUrl).optional(),
  AIRTABLE_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
});

type RawEnvironment = z.infer<typeof RawEnvironmentSchema>;

export interface AirtableConfig {
  readonly apiUrl: string;
  readonly rentacoatBaseId?: string;
  readonly gomallBaseId?: string;
  readonly pat?: string;
}

export interface GcpConfig {
  readonly projectId?: string;
  readonly region?: string;
}

export interface DatabaseConfig {
  readonly url?: string;
}

export interface AppConfig {
  readonly appEnv: AppEnv;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly airtable: AirtableConfig;
  readonly gcp: GcpConfig;
  readonly database: DatabaseConfig;
  readonly sync: {
    readonly intervalMinutes: number;
  };
}

export class ConfigValidationError extends Error {
  public readonly variableNames: readonly string[];

  public constructor(variableNames: readonly string[]) {
    super(`Invalid environment variables: ${variableNames.join(', ')}`);
    this.name = 'ConfigValidationError';
    this.variableNames = variableNames;
  }
}

const requiredDeploymentVariables = [
  'AIRTABLE_PAT',
  'AIRTABLE_RENTACOAT_BASE_ID',
  'AIRTABLE_GOMALL_BASE_ID',
  'GCP_PROJECT_ID',
  'GCP_REGION',
  'DATABASE_URL',
] as const satisfies readonly (keyof RawEnvironment)[];

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = RawEnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigValidationError(issueVariableNames(parsed.error.issues));
  }

  const raw = parsed.data;
  const missingDeploymentVariables = isDeploymentEnvironment(raw.APP_ENV)
    ? requiredDeploymentVariables.filter((name) => raw[name] === undefined)
    : [];

  if (missingDeploymentVariables.length > 0) {
    throw new ConfigValidationError(missingDeploymentVariables);
  }

  return createAppConfig(raw);
}

function createAppConfig(raw: RawEnvironment): AppConfig {
  const airtable: AirtableConfig = {
    apiUrl: raw.AIRTABLE_API_URL,
    ...(raw.AIRTABLE_RENTACOAT_BASE_ID === undefined
      ? {}
      : { rentacoatBaseId: raw.AIRTABLE_RENTACOAT_BASE_ID }),
    ...(raw.AIRTABLE_GOMALL_BASE_ID === undefined
      ? {}
      : { gomallBaseId: raw.AIRTABLE_GOMALL_BASE_ID }),
  };
  defineServerSecret(airtable, 'pat', raw.AIRTABLE_PAT);

  const database: DatabaseConfig = {};
  defineServerSecret(database, 'url', raw.DATABASE_URL);

  return {
    appEnv: raw.APP_ENV,
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    airtable,
    gcp: {
      ...(raw.GCP_PROJECT_ID === undefined ? {} : { projectId: raw.GCP_PROJECT_ID }),
      ...(raw.GCP_REGION === undefined ? {} : { region: raw.GCP_REGION }),
    },
    database,
    sync: {
      intervalMinutes: raw.AIRTABLE_SYNC_INTERVAL_MINUTES,
    },
  };
}

function defineServerSecret(
  target: AirtableConfig | DatabaseConfig,
  name: 'pat' | 'url',
  value: string | undefined,
): void {
  if (value === undefined) {
    return;
  }

  Object.defineProperty(target, name, {
    value,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function isDeploymentEnvironment(appEnv: AppEnv): boolean {
  return appEnv === 'staging' || appEnv === 'production';
}

function isSafeAirtableApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
}

function issueVariableNames(issues: readonly z.core.$ZodIssue[]): string[] {
  return [...new Set(issues.map((issue) => String(issue.path[0] ?? 'environment')))].sort();
}

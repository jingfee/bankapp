import { accessSync, constants, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { isPasswordHash } from '../auth/password-hash';

export interface AppConfig {
  /** Enable Banking application id; used as the `kid` of the signed JWTs. */
  applicationId: string;
  /** Path of the Enable Banking RSA private key (PEM). */
  privateKeyPath: string;
  /** Where Enable Banking sends the owner back after BankID. */
  redirectUrl: string;
  /** Directory holding the SQLite database. */
  dataDir: string;
  /** Directory the settlement reports (Excel) are saved in, one folder per year. */
  reportsDir: string;
  /** IANA time zone the scheduler runs in, e.g. `Europe/Stockholm`. */
  timezone: string;
  /** Whether syncs run on a schedule; off in development, which shares the banks' request limit. */
  scheduledSyncs: boolean;
  /** When scheduled syncs run each day in {@link timezone}, as sorted `HH:MM` times. */
  syncTimes: string[];
  /** The owner's username; there is no registration. */
  username: string;
  /** scrypt hash of the owner's password, made with `pnpm hash-password`; never the password itself. */
  passwordHash: string;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Banks allow about four syncs a day without the owner present; more would be refused. */
export const MAX_SYNC_TIMES = 4;
export const DEFAULT_SYNC_TIMES = ['06:00', '11:00', '16:00', '21:00'];

const required = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} must not be empty`);

const schema = z.object({
  ENABLE_BANKING_APPLICATION_ID: required('ENABLE_BANKING_APPLICATION_ID'),
  ENABLE_BANKING_PRIVATE_KEY_PATH: required('ENABLE_BANKING_PRIVATE_KEY_PATH'),
  REDIRECT_URL: required('REDIRECT_URL').pipe(
    z.url({ protocol: /^https?$/, error: 'REDIRECT_URL must be an http(s) URL' }),
  ),
  DATA_DIR: required('DATA_DIR'),
  REPORTS_DIR: z.string().trim().optional(),
  SCHEDULED_SYNCS: z
    .enum(['true', 'false', ''], { error: 'SCHEDULED_SYNCS must be true or false' })
    .optional(),
  SYNC_TIMES: z
    .string()
    .optional()
    .transform((value) =>
      value?.trim()
        ? [...new Set(value.split(',').map((time) => time.trim()))].sort()
        : DEFAULT_SYNC_TIMES,
    )
    .pipe(
      z
        .array(
          z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
            error: 'SYNC_TIMES must be comma-separated HH:MM times, e.g. 06:00,18:00',
          }),
        )
        .max(MAX_SYNC_TIMES, {
          error: `SYNC_TIMES must have at most ${MAX_SYNC_TIMES} times: banks refuse more syncs a day`,
        }),
    ),
  BANKAPP_USERNAME: required('BANKAPP_USERNAME'),
  BANKAPP_PASSWORD_HASH: required('BANKAPP_PASSWORD_HASH').refine(isPasswordHash, {
    error: 'BANKAPP_PASSWORD_HASH is not a hash made by `pnpm hash-password`',
  }),
  TIMEZONE: required('TIMEZONE').refine(isTimeZone, {
    error: 'TIMEZONE must be an IANA time zone such as Europe/Stockholm',
  }),
});

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('sv-SE', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Reads and validates the configuration, throwing a {@link ConfigError} that lists every problem. */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => issue.message));
  }
  const values = parsed.data;

  const problems: string[] = [];
  const keyPath = values.ENABLE_BANKING_PRIVATE_KEY_PATH;
  let pem: string | undefined;
  try {
    if (statSync(keyPath).isFile()) pem = readFileSync(keyPath, 'utf8');
  } catch {
    // Reported below.
  }
  if (pem === undefined) {
    problems.push(`ENABLE_BANKING_PRIVATE_KEY_PATH is not a readable file: ${keyPath}`);
  } else if (!isPrivateKey(pem)) {
    problems.push(
      `ENABLE_BANKING_PRIVATE_KEY_PATH does not contain a valid PEM private key: ${keyPath}`,
    );
  }
  try {
    mkdirSync(values.DATA_DIR, { recursive: true });
    accessSync(values.DATA_DIR, constants.W_OK);
  } catch {
    problems.push(`DATA_DIR cannot be created or written to: ${values.DATA_DIR}`);
  }
  const reportsDir = values.REPORTS_DIR || join(values.DATA_DIR, 'reports');
  try {
    mkdirSync(reportsDir, { recursive: true, mode: 0o700 });
    accessSync(reportsDir, constants.W_OK);
  } catch {
    problems.push(`REPORTS_DIR cannot be created or written to: ${reportsDir}`);
  }
  if (problems.length > 0) throw new ConfigError(problems);

  return {
    applicationId: values.ENABLE_BANKING_APPLICATION_ID,
    privateKeyPath: values.ENABLE_BANKING_PRIVATE_KEY_PATH,
    redirectUrl: values.REDIRECT_URL,
    dataDir: values.DATA_DIR,
    reportsDir,
    timezone: values.TIMEZONE,
    scheduledSyncs: values.SCHEDULED_SYNCS === 'true',
    syncTimes: values.SYNC_TIMES,
    username: values.BANKAPP_USERNAME,
    passwordHash: values.BANKAPP_PASSWORD_HASH,
  };
}

function isPrivateKey(pem: string): boolean {
  try {
    createPrivateKey(pem);
    return true;
  } catch {
    return false;
  }
}

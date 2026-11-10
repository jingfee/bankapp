import { accessSync, constants, statSync } from 'node:fs';
import { z } from 'zod';

export interface AppConfig {
  /** Enable Banking application id; used as the `kid` of the signed JWTs. */
  applicationId: string;
  /** Path of the Enable Banking RSA private key (PEM). */
  privateKeyPath: string;
  /** Where Enable Banking sends the owner back after BankID. */
  redirectUrl: string;
  /** Directory holding the SQLite database. */
  dataDir: string;
  /** IANA time zone the scheduler runs in, e.g. `Europe/Stockholm`. */
  timezone: string;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

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
  try {
    accessSync(values.ENABLE_BANKING_PRIVATE_KEY_PATH, constants.R_OK);
    if (!statSync(values.ENABLE_BANKING_PRIVATE_KEY_PATH).isFile()) {
      problems.push(
        `ENABLE_BANKING_PRIVATE_KEY_PATH is not a file: ${values.ENABLE_BANKING_PRIVATE_KEY_PATH}`,
      );
    }
  } catch {
    problems.push(
      `ENABLE_BANKING_PRIVATE_KEY_PATH is not a readable file: ${values.ENABLE_BANKING_PRIVATE_KEY_PATH}`,
    );
  }
  if (problems.length > 0) throw new ConfigError(problems);

  return {
    applicationId: values.ENABLE_BANKING_APPLICATION_ID,
    privateKeyPath: values.ENABLE_BANKING_PRIVATE_KEY_PATH,
    redirectUrl: values.REDIRECT_URL,
    dataDir: values.DATA_DIR,
    timezone: values.TIMEZONE,
  };
}

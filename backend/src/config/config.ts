import { accessSync, constants, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
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
  /** The owner's personnummer (12 digits), passed to banks that take it when connecting. */
  personnummer?: string | undefined;
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
  PERSONNUMMER: z
    .string()
    .trim()
    .regex(/^\d{12}$/, 'PERSONNUMMER must be 12 digits, e.g. 199001011234')
    .optional(),
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
  if (problems.length > 0) throw new ConfigError(problems);

  return {
    applicationId: values.ENABLE_BANKING_APPLICATION_ID,
    privateKeyPath: values.ENABLE_BANKING_PRIVATE_KEY_PATH,
    redirectUrl: values.REDIRECT_URL,
    dataDir: values.DATA_DIR,
    timezone: values.TIMEZONE,
    personnummer: values.PERSONNUMMER,
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

import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, loadConfig } from '../src/config/config';

describe('loadConfig', () => {
  let dir: string;
  let validEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bankapp-config-'));
    writeFileSync(
      join(dir, 'key.pem'),
      generateKeyPairSync('rsa', { modulusLength: 2048 })
        .privateKey.export({ type: 'pkcs8', format: 'pem' })
        .toString(),
    );
    validEnv = {
      ENABLE_BANKING_APPLICATION_ID: 'app-id',
      ENABLE_BANKING_PRIVATE_KEY_PATH: join(dir, 'key.pem'),
      REDIRECT_URL: 'https://bankapp.example/callback',
      DATA_DIR: join(dir, 'data'),
      TIMEZONE: 'Europe/Stockholm',
    };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts a complete configuration', () => {
    expect(loadConfig(validEnv)).toEqual({
      applicationId: 'app-id',
      privateKeyPath: join(dir, 'key.pem'),
      redirectUrl: 'https://bankapp.example/callback',
      dataDir: join(dir, 'data'),
      timezone: 'Europe/Stockholm',
    });
  });

  it.each([
    'ENABLE_BANKING_APPLICATION_ID',
    'ENABLE_BANKING_PRIVATE_KEY_PATH',
    'REDIRECT_URL',
    'DATA_DIR',
    'TIMEZONE',
  ])('names %s when it is missing', (name) => {
    delete validEnv[name];

    expect(() => loadConfig(validEnv)).toThrow(new RegExp(`${name} is required`));
  });

  it('rejects a blank application id', () => {
    validEnv['ENABLE_BANKING_APPLICATION_ID'] = '   ';

    expect(() => loadConfig(validEnv)).toThrow(/ENABLE_BANKING_APPLICATION_ID must not be empty/);
  });

  it('rejects a redirect URL that is not an http(s) URL', () => {
    validEnv['REDIRECT_URL'] = 'not a url';

    expect(() => loadConfig(validEnv)).toThrow(/REDIRECT_URL must be an http\(s\) URL/);
  });

  it('reads the optional personnummer', () => {
    validEnv['PERSONNUMMER'] = '199001011234';

    expect(loadConfig(validEnv).personnummer).toBe('199001011234');
  });

  it.each(['19900101-1234', '9001011234', 'abc'])('rejects the personnummer %s', (value) => {
    validEnv['PERSONNUMMER'] = value;

    expect(() => loadConfig(validEnv)).toThrow(/PERSONNUMMER must be 12 digits/);
  });

  it('rejects an unknown time zone', () => {
    validEnv['TIMEZONE'] = 'Mars/Olympus';

    expect(() => loadConfig(validEnv)).toThrow(/TIMEZONE must be an IANA time zone/);
  });

  it('rejects a private key path that cannot be read', () => {
    validEnv['ENABLE_BANKING_PRIVATE_KEY_PATH'] = join(dir, 'missing.pem');

    expect(() => loadConfig(validEnv)).toThrow(
      /ENABLE_BANKING_PRIVATE_KEY_PATH is not a readable file/,
    );
  });

  it('rejects a key file that is not a PEM private key', () => {
    writeFileSync(join(dir, 'bad.pem'), 'not a key');
    validEnv['ENABLE_BANKING_PRIVATE_KEY_PATH'] = join(dir, 'bad.pem');

    expect(() => loadConfig(validEnv)).toThrow(/does not contain a valid PEM private key/);
  });

  it('rejects a data directory that cannot be created', () => {
    writeFileSync(join(dir, 'file'), '');
    validEnv['DATA_DIR'] = join(dir, 'file', 'data');

    expect(() => loadConfig(validEnv)).toThrow(/DATA_DIR cannot be created or written to/);
  });

  it('reports every problem at once', () => {
    validEnv['REDIRECT_URL'] = 'nope';
    validEnv['TIMEZONE'] = 'nope';

    const failure = (() => {
      try {
        loadConfig(validEnv);
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(ConfigError);
    expect((failure as ConfigError).message).toMatch(/REDIRECT_URL[\s\S]*TIMEZONE/);
  });
});

import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../src/auth/password-hash';
import { ConfigError, loadConfig } from '../src/config/config';

describe('loadConfig', () => {
  let dir: string;
  let validEnv: NodeJS.ProcessEnv;
  const hash = hashPassword('secret');

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
      BANKAPP_USERNAME: 'owner',
      BANKAPP_PASSWORD_HASH: hash,
    };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts a complete configuration', () => {
    expect(loadConfig(validEnv)).toEqual({
      applicationId: 'app-id',
      privateKeyPath: join(dir, 'key.pem'),
      redirectUrl: 'https://bankapp.example/callback',
      dataDir: join(dir, 'data'),
      reportsDir: join(dir, 'data', 'reports'),
      timezone: 'Europe/Stockholm',
      scheduledSyncs: false,
      syncTimes: ['06:00', '11:00', '16:00', '21:00'],
      username: 'owner',
      passwordHash: hash,
      ownerName: 'Jag',
      partnerName: 'Partner',
    });
  });

  it('reads OWNER_NAME and PARTNER_NAME, trimmed', () => {
    const config = loadConfig({ ...validEnv, OWNER_NAME: ' Kim ', PARTNER_NAME: 'Robin' });
    expect([config.ownerName, config.partnerName]).toEqual(['Kim', 'Robin']);
  });

  it('falls back to Jag and Partner when the names are blank', () => {
    const config = loadConfig({ ...validEnv, OWNER_NAME: '  ', PARTNER_NAME: '' });
    expect([config.ownerName, config.partnerName]).toEqual(['Jag', 'Partner']);
  });

  it.each(['BANKAPP_USERNAME', 'BANKAPP_PASSWORD_HASH'])('requires %s', (name) => {
    const env = { ...validEnv, [name]: undefined };
    expect(() => loadConfig(env)).toThrow(name);
  });

  it('rejects a password hash that is plain text', () => {
    expect(() => loadConfig({ ...validEnv, BANKAPP_PASSWORD_HASH: 'hunter2' })).toThrow(
      /BANKAPP_PASSWORD_HASH/,
    );
  });

  it('turns scheduled syncs on with SCHEDULED_SYNCS=true', () => {
    expect(loadConfig({ ...validEnv, SCHEDULED_SYNCS: 'true' }).scheduledSyncs).toBe(true);
  });

  it.each(['false', ''])('keeps scheduled syncs off when SCHEDULED_SYNCS is %j', (value) => {
    expect(loadConfig({ ...validEnv, SCHEDULED_SYNCS: value }).scheduledSyncs).toBe(false);
  });

  it('reads SYNC_TIMES as sorted times without repeats', () => {
    expect(loadConfig({ ...validEnv, SYNC_TIMES: ' 18:00, 06:30 ,18:00' }).syncTimes).toEqual([
      '06:30',
      '18:00',
    ]);
  });

  it.each(['6:00', '24:00', '06:60', '06:00;18:00', '06:00,'])('rejects SYNC_TIMES %j', (value) => {
    expect(() => loadConfig({ ...validEnv, SYNC_TIMES: value })).toThrow(/SYNC_TIMES/);
  });

  it('rejects more than four SYNC_TIMES, which banks would refuse', () => {
    expect(() => loadConfig({ ...validEnv, SYNC_TIMES: '06:00,10:00,14:00,18:00,22:00' })).toThrow(
      /at most 4/,
    );
  });

  it('rejects an unclear SCHEDULED_SYNCS', () => {
    expect(() => loadConfig({ ...validEnv, SCHEDULED_SYNCS: 'yes' })).toThrow(/SCHEDULED_SYNCS/);
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

  it('ignores a leftover PERSONNUMMER', () => {
    validEnv['PERSONNUMMER'] = '199001011234';

    expect(() => loadConfig(validEnv)).not.toThrow();
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

  it('keeps settlement reports under the data directory unless REPORTS_DIR says otherwise', () => {
    expect(loadConfig(validEnv).reportsDir).toBe(join(dir, 'data', 'reports'));
    validEnv['REPORTS_DIR'] = join(dir, 'elsewhere');
    expect(loadConfig(validEnv).reportsDir).toBe(join(dir, 'elsewhere'));
  });

  it('rejects a reports directory that cannot be created', () => {
    writeFileSync(join(dir, 'file'), '');
    validEnv['REPORTS_DIR'] = join(dir, 'file', 'reports');

    expect(() => loadConfig(validEnv)).toThrow(/REPORTS_DIR cannot be created or written to/);
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

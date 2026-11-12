import { Logger, type INestApplication } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { banks } from '../src/db/schema';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { FakeEnableBankingClient, testConfig } from './support';

describe('daily database backup', () => {
  let app: INestApplication;
  let dataDir: string;
  const backupsDir = () => join(dataDir, 'backups');
  const backupFiles = () => readdirSync(backupsDir()).sort();

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    dataDir = mkdtempSync(join(tmpdir(), 'bankapp-backup-'));
  });

  afterEach(async () => {
    await app?.close();
    vi.useRealTimers();
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** Starts the app at the given instant, with the database in memory and backups in a temp dir. */
  async function startAt(now: string): Promise<void> {
    vi.setSystemTime(new Date(now));
    app = await createApp({
      config: { ...testConfig, dataDir },
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
    });
    await app.init();
  }

  it('writes a dated, consistent copy of the database at 03:00 Stockholm time', async () => {
    // 2026-07-01 is CEST (UTC+2), so 03:00 local is 01:00 UTC.
    await startAt('2026-07-01T00:30:00Z');
    (app.get(DATABASE) as AppDatabase)
      .insert(banks)
      .values({ name: 'Skandia', country: 'SE', maximumConsentSeconds: 3600 })
      .run();

    expect(() => backupFiles()).toThrow(); // nothing before 03:00

    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

    expect(backupFiles()).toEqual(['bankapp-2026-07-01.db']);
    const copy = new Database(join(backupsDir(), 'bankapp-2026-07-01.db'), { readonly: true });
    expect(copy.prepare('select name from banks').all()).toEqual([{ name: 'Skandia' }]);
    copy.close();
  });

  it('keeps only the newest 7 backups', async () => {
    mkdirSync(backupsDir(), { recursive: true });
    for (let day = 20; day <= 29; day++) {
      writeFileSync(join(backupsDir(), `bankapp-2026-06-${day}.db`), 'old');
    }
    await startAt('2026-07-01T00:30:00Z');

    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

    expect(backupFiles()).toEqual([
      'bankapp-2026-06-24.db',
      'bankapp-2026-06-25.db',
      'bankapp-2026-06-26.db',
      'bankapp-2026-06-27.db',
      'bankapp-2026-06-28.db',
      'bankapp-2026-06-29.db',
      'bankapp-2026-07-01.db',
    ]);
  });

  it('logs a failed backup and keeps running, trying again the next night', async () => {
    // A file where the backups directory should be makes the backup fail.
    writeFileSync(backupsDir(), 'in the way');
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await startAt('2026-07-01T00:30:00Z');

    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

    expect(error).toHaveBeenCalledWith(expect.stringContaining('Database backup failed'));

    rmSync(backupsDir());
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(backupFiles()).toEqual(['bankapp-2026-07-02.db']);
  });
});

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CLOCK, type Clock } from '../clock';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';
import { DATABASE } from '../db/database.module';
import type { AppDatabase } from '../db/database';

export const BACKUP_JOB = 'database-backup';
/** Every night at 03:00 in the configured time zone. */
export const BACKUP_SCHEDULE = '0 3 * * *';
export const BACKUPS_DIR_NAME = 'backups';
export const BACKUPS_TO_KEEP = 7;

const BACKUP_FILE = /^bankapp-\d{4}-\d{2}-\d{2}\.db$/;

@Injectable()
export class BackupScheduler implements OnModuleInit {
  private readonly logger = new Logger(BackupScheduler.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  onModuleInit(): void {
    const job = CronJob.from({
      cronTime: BACKUP_SCHEDULE,
      timeZone: this.config.timezone,
      onTick: () => this.backUp(),
      start: true,
    });
    this.registry.addCronJob(BACKUP_JOB, job);
  }

  /** Writes today's backup and prunes old ones. Never throws: a failed backup is only logged. */
  private backUp(): void {
    try {
      const dir = join(this.config.dataDir, BACKUPS_DIR_NAME);
      // The backups hold personal data, so keep them readable by the app's user only.
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, `bankapp-${this.localDate()}.db`);
      const partial = `${file}.partial`;
      rmSync(partial, { force: true });
      try {
        // A consistent snapshot taken in one transaction while the app keeps running. It is
        // written under a temporary name so a failed or interrupted run never damages (or
        // impersonates) a good backup; a run earlier the same day is replaced.
        this.db.$client.prepare('VACUUM INTO ?').run(partial);
        chmodSync(partial, 0o600);
        renameSync(partial, file);
      } finally {
        rmSync(partial, { force: true });
      }
      this.prune(dir);
      this.logger.log(`Wrote database backup ${file}`);
    } catch (error) {
      this.logger.error(`Database backup failed: ${String(error)}`);
    }
  }

  private prune(dir: string): void {
    const backups = readdirSync(dir)
      .filter((name) => BACKUP_FILE.test(name))
      .sort();
    for (const name of backups.slice(0, Math.max(0, backups.length - BACKUPS_TO_KEEP))) {
      rmSync(join(dir, name), { force: true });
    }
  }

  /** Today's date as YYYY-MM-DD in the configured time zone. */
  private localDate(): string {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: this.config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.now());
  }
}

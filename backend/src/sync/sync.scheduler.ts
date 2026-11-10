import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';
import { SyncService } from './sync.service';

export const SYNC_JOB = 'scheduled-sync';
/** Every day at 06:00 and 18:00 in the configured time zone. */
export const SYNC_SCHEDULE = '0 6,18 * * *';

@Injectable()
export class SyncScheduler implements OnModuleInit {
  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly sync: SyncService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.scheduledSyncs) return;
    const job = CronJob.from({
      cronTime: SYNC_SCHEDULE,
      timeZone: this.config.timezone,
      onTick: () => {
        this.sync.start('scheduled');
      },
      start: true,
    });
    this.registry.addCronJob(SYNC_JOB, job);
  }
}

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
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
  private readonly logger = new Logger(SyncScheduler.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly sync: SyncService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.scheduledSyncs) {
      this.logger.log('Scheduled syncs are off (SCHEDULED_SYNCS is not true)');
      return;
    }
    const job = CronJob.from({
      cronTime: SYNC_SCHEDULE,
      timeZone: this.config.timezone,
      onTick: () => {
        try {
          if (!this.sync.start('scheduled').started) {
            this.logger.warn('Skipped a scheduled sync: another sync is running');
          }
        } catch (error) {
          this.logger.error(`Could not start a scheduled sync: ${String(error)}`);
        }
      },
      start: true,
    });
    this.registry.addCronJob(SYNC_JOB, job);
    this.logger.log(`Scheduled syncs at 06:00 and 18:00 ${this.config.timezone}`);
  }
}

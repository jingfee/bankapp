import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';
import { SyncService } from './sync.service';

/** The name of the job that syncs at `time`, one job per configured time. */
export const syncJob = (time: string): string => `scheduled-sync-${time}`;

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
    for (const time of this.config.syncTimes) {
      const [hour, minute] = time.split(':').map(Number);
      const job = CronJob.from({
        cronTime: `${minute} ${hour} * * *`,
        timeZone: this.config.timezone,
        onTick: () => this.startSync(),
        start: true,
      });
      this.registry.addCronJob(syncJob(time), job);
    }
    this.logger.log(
      `Scheduled syncs at ${this.config.syncTimes.join(', ')} ${this.config.timezone}`,
    );
  }

  private startSync(): void {
    try {
      if (!this.sync.start('scheduled').started) {
        this.logger.warn('Skipped a scheduled sync: another sync is running');
      }
    } catch (error) {
      this.logger.error(`Could not start a scheduled sync: ${String(error)}`);
    }
  }
}

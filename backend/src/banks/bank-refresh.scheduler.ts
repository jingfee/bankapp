import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config';
import { BanksService } from './banks.service';

export const BANK_REFRESH_JOB = 'bank-list-refresh';
/** Every night at 04:00 in the configured time zone. */
export const BANK_REFRESH_SCHEDULE = '0 4 * * *';

@Injectable()
export class BankRefreshScheduler implements OnModuleInit {
  private readonly logger = new Logger(BankRefreshScheduler.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly banks: BanksService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    const job = CronJob.from({
      cronTime: BANK_REFRESH_SCHEDULE,
      timeZone: this.config.timezone,
      onTick: () => {
        this.banks
          .refresh()
          .catch((error: unknown) =>
            this.logger.warn(`Could not refresh the bank list: ${String(error)}`),
          );
      },
      start: true,
    });
    this.registry.addCronJob(BANK_REFRESH_JOB, job);
  }
}

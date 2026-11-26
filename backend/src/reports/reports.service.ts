import { Inject, Injectable } from '@nestjs/common';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SettlementPeriod } from '@bankapp/shared';
import { CLOCK, type Clock } from '../clock';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';
import { buildSettlementWorkbook, reportFileName } from './settlement-workbook';

/** Saves each closed month's settlement report as an Excel file under the reports folder. */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  path(month: string): string {
    const { dir, file } = reportFileName(month);
    return join(this.config.reportsDir, dir, file);
  }

  exists(month: string): boolean {
    return existsSync(this.path(month));
  }

  /** Writes the report of a closed period, replacing an earlier one; throws when it cannot. */
  async write(period: SettlementPeriod): Promise<void> {
    const workbook = await buildSettlementWorkbook(period, this.wallClock(), {
      owner: this.config.ownerName,
      partner: this.config.partnerName,
    });
    const file = this.path(period.month);
    // The reports hold personal data: readable by the app's user only.
    mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
    const partial = `${file}.partial`;
    rmSync(partial, { force: true });
    try {
      // Written under a temporary name, so a failed write never leaves a broken report.
      await workbook.xlsx.writeFile(partial);
      chmodSync(partial, 0o600);
      renameSync(partial, file);
    } finally {
      rmSync(partial, { force: true });
    }
  }

  /** The time now as the owner's clock shows it, stored as UTC because spreadsheets have no time zone. */
  private wallClock(): Date {
    const text = new Intl.DateTimeFormat('sv-SE', {
      timeZone: this.config.timezone,
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(this.clock.now());
    return new Date(`${text.replace(' ', 'T')}Z`);
  }

  remove(month: string): void {
    rmSync(this.path(month), { force: true });
  }
}

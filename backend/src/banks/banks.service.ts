import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import type { Bank } from '@bankapp/shared';
import { DATABASE } from '../db/database.module';
import type { AppDatabase } from '../db/database';
import { banks } from '../db/schema';
import { EnableBankingClient } from '../enable-banking/enable-banking-client';

/** Banks are offered for Sweden only. */
export const BANK_COUNTRY = 'SE';

@Injectable()
export class BanksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BanksService.name);

  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    private readonly enableBanking: EnableBankingClient,
  ) {}

  /** Fills an empty cache right away so a fresh install does not wait for the daily refresh. */
  async onApplicationBootstrap(): Promise<void> {
    if (this.db.select().from(banks).limit(1).all().length > 0) return;
    await this.refresh().catch((error: unknown) =>
      this.logger.warn(`Could not fetch the bank list at startup: ${String(error)}`),
    );
  }

  list(): Bank[] {
    return this.db
      .select()
      .from(banks)
      .orderBy(asc(banks.name))
      .all()
      .map(({ name, logoUrl, beta }) => ({ name, logoUrl, beta }));
  }

  /** Replaces the cached list with Enable Banking's current one; keeps the old list if the fetch fails. */
  async refresh(): Promise<void> {
    const fetched = await this.enableBanking.listBanks(BANK_COUNTRY);
    this.db.transaction((tx) => {
      tx.delete(banks).run();
      if (fetched.length > 0) tx.insert(banks).values(fetched).onConflictDoNothing().run();
    });
  }
}

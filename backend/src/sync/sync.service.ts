import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq, gt, isNull } from 'drizzle-orm';
import { CLOCK, type Clock } from '../clock';
import { DATABASE } from '../db/database.module';
import type { AppDatabase } from '../db/database';
import { accounts, balances, connections, syncAccountResults, syncRuns } from '../db/schema';
import {
  EnableBankingClient,
  type EnableBankingBalance,
} from '../enable-banking/enable-banking-client';

export type SyncTrigger = 'initial' | 'scheduled' | 'manual';

type AccountRow = typeof accounts.$inferSelect;

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly now: Clock,
    private readonly enableBanking: EnableBankingClient,
  ) {}

  /** A run cut short by a restart would otherwise show as in progress forever. */
  onModuleInit(): void {
    this.db
      .update(syncRuns)
      .set({ finishedAt: this.now() })
      .where(isNull(syncRuns.finishedAt))
      .run();
  }

  /** Whether a sync is running right now. */
  isSyncing(): boolean {
    return (
      this.db
        .select({ id: syncRuns.id })
        .from(syncRuns)
        .where(isNull(syncRuns.finishedAt))
        .get() !== undefined
    );
  }

  /**
   * Starts a sync and returns once it is recorded as running; the promise resolves when it has
   * finished and never rejects. With a `connectionId` only that connection's accounts are synced,
   * otherwise every account of every connection that has not expired.
   */
  start(trigger: SyncTrigger, connectionId?: number): Promise<void> {
    let runId: number;
    let rows: AccountRow[];
    try {
      const now = this.now();
      rows = this.db
        .select({ account: accounts })
        .from(accounts)
        .innerJoin(connections, eq(accounts.connectionId, connections.id))
        .where(
          connectionId === undefined
            ? gt(connections.validUntil, now)
            : eq(connections.id, connectionId),
        )
        .all()
        .map((row) => row.account);
      runId = this.db
        .insert(syncRuns)
        .values({ trigger, startedAt: now })
        .returning({ id: syncRuns.id })
        .get().id;
    } catch (cause) {
      this.logger.error(`Could not start a ${trigger} sync: ${String(cause)}`);
      return Promise.resolve();
    }
    return this.execute(runId, rows).catch((cause: unknown) =>
      this.logger.error(`Sync ${runId} failed: ${String(cause)}`),
    );
  }

  private async execute(runId: number, rows: AccountRow[]): Promise<void> {
    try {
      for (const account of rows) {
        try {
          await this.syncAccount(runId, account);
        } catch (cause) {
          // One account's storage problem must not stop the others from being synced.
          this.logger.error(`Could not record the sync of account ${account.id}: ${String(cause)}`);
        }
      }
    } finally {
      this.db.update(syncRuns).set({ finishedAt: this.now() }).where(eq(syncRuns.id, runId)).run();
    }
  }

  private async syncAccount(runId: number, account: AccountRow): Promise<void> {
    let fetched: EnableBankingBalance[];
    try {
      fetched = await this.enableBanking.getBalances(account.uid);
    } catch (cause) {
      this.logger.warn(`Could not fetch balances for account ${account.id}: ${String(cause)}`);
      this.db
        .insert(syncAccountResults)
        .values({
          syncRunId: runId,
          accountId: account.id,
          outcome: 'failed',
          error: String(cause),
          syncedAt: this.now(),
        })
        .run();
      return;
    }
    const fetchedAt = this.now();
    this.db.transaction((tx) => {
      if (fetched.length > 0) {
        tx.insert(balances)
          .values(
            fetched.map((balance) => ({
              accountId: account.id,
              type: balance.type,
              amount: normalise(account.type, balance),
              currency: balance.currency,
              referenceDate: balance.referenceDate,
              fetchedAt,
            })),
          )
          .run();
      }
      tx.insert(syncAccountResults)
        .values({
          syncRunId: runId,
          accountId: account.id,
          outcome: 'ok',
          error: null,
          syncedAt: fetchedAt,
        })
        .run();
    });
  }
}

/** Card accounts must read negative when money is owed, whichever way the bank signs it. */
function normalise(type: AccountRow['type'], balance: EnableBankingBalance): number {
  if (type !== 'card' || balance.creditDebit === null) return balance.amount;
  const size = Math.abs(balance.amount);
  return balance.creditDebit === 'debit' ? -size : size;
}

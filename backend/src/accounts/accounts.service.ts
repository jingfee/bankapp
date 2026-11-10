import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { AccountsResponse } from '@bankapp/shared';
import { DATABASE } from '../db/database.module';
import type { AppDatabase } from '../db/database';
import { accounts, connections } from '../db/schema';

@Injectable()
export class AccountsService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  /** The accounts of every connected bank, grouped by bank. */
  listByBank(): AccountsResponse {
    const rows = this.db
      .select({ bank: connections.bankName, name: accounts.name, type: accounts.type })
      .from(accounts)
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .orderBy(asc(connections.bankName), asc(accounts.name))
      .all();
    const byBank = new Map<string, AccountsResponse['banks'][number]>();
    for (const { bank, name, type } of rows) {
      const group = byBank.get(bank) ?? { bank, accounts: [] };
      group.accounts.push({ name, type });
      byBank.set(bank, group);
    }
    return { banks: [...byBank.values()] };
  }
}

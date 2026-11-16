import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import type { AccountsResponse, TransactionDetails, TransactionsResponse } from '@bankapp/shared';
import { InvalidInput, NoSuchAccount, NoSuchTransaction } from '../domain-errors';
import { parseId } from '../transactions/ids';
import { parseFilter } from './transaction-filter';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(): AccountsResponse {
    return this.accounts.listByBank();
  }

  /** Hides or shows an account with `hidden: true` or `false`. */
  @Put(':id/hidden')
  setHidden(@Param('id') id: string, @Body() body: unknown): void {
    const { hidden } = (body ?? {}) as { hidden?: unknown };
    if (typeof hidden !== 'boolean') throw new InvalidInput('hidden must be true or false');
    this.accounts.setHidden(parseId(id, new NoSuchAccount()), hidden);
  }
}

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(
    @Query('before') before?: string,
    @Query() query: Record<string, unknown> = {},
  ): TransactionsResponse {
    const { q, from, to, accounts, categories, kind, min, max } = query;
    const filter = parseFilter({ q, from, to, accounts, categories, kind, min, max });
    if ('error' in filter) throw new InvalidInput(filter.error);
    return this.accounts.listTransactions(before, filter);
  }

  @Get(':id')
  get(@Param('id') id: string): TransactionDetails {
    const details = this.accounts.getTransaction(parseId(id, new NoSuchTransaction()));
    if (details === null) throw new NoSuchTransaction();
    return details;
  }
}

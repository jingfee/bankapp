import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import type { AccountsResponse, TransactionsResponse } from '@bankapp/shared';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(): AccountsResponse {
    return this.accounts.listByBank();
  }

  @Get(':id/transactions')
  transactions(@Param('id') id: string, @Query('before') before?: string): TransactionsResponse {
    const accountId = /^\d+$/.test(id) ? Number(id) : undefined;
    const page =
      accountId === undefined ? undefined : this.accounts.listTransactions(accountId, before);
    if (page === undefined) throw new NotFoundException('There is no such account');
    if (page === 'bad-cursor') throw new BadRequestException('The cursor is not valid');
    return page;
  }
}

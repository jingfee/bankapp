import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import type { AccountsResponse, TransactionDetails, TransactionsResponse } from '@bankapp/shared';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(): AccountsResponse {
    return this.accounts.listByBank();
  }
}

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@Query('before') before?: string): TransactionsResponse {
    const page = this.accounts.listTransactions(before);
    if (page === 'bad-cursor') throw new BadRequestException('The cursor is not valid');
    return page;
  }

  @Get(':id')
  get(@Param('id') id: string): TransactionDetails {
    const details = /^\d{1,15}$/.test(id) ? this.accounts.getTransaction(Number(id)) : null;
    if (details === null) throw new NotFoundException('There is no such transaction');
    return details;
  }
}

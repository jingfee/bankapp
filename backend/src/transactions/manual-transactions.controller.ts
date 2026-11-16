import { Body, Controller, Delete, HttpCode, Param, Post, Put } from '@nestjs/common';
import type { Transaction } from '@bankapp/shared';
import { NoSuchTransaction } from '../domain-errors';
import { parseId } from './ids';
import { ManualTransactions } from './manual-transactions';

@Controller('transactions')
export class ManualTransactionsController {
  constructor(private readonly manual: ManualTransactions) {}

  /** Adds a manual transaction (ADR 0009). */
  @Post()
  add(@Body() body: unknown): Transaction {
    return this.manual.add(body);
  }

  /** Edits a manual transaction; a bank transaction cannot be edited. */
  @Put(':id')
  edit(@Param('id') id: string, @Body() body: unknown): Transaction {
    return this.manual.edit(parseId(id, new NoSuchTransaction()), body);
  }

  /** Deletes a manual transaction; a bank transaction cannot be deleted. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): void {
    this.manual.delete(parseId(id, new NoSuchTransaction()));
  }
}

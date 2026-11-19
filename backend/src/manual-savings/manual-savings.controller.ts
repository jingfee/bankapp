import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { ManualSavingsAccount, ManualSavingsResponse } from '@bankapp/shared';
import { NoSuchBalanceEntry, NoSuchManualSavingsAccount } from '../domain-errors';
import { parseId } from '../transactions/ids';
import { ManualSavings } from './manual-savings';

@Controller('manual-savings-accounts')
export class ManualSavingsController {
  constructor(private readonly savings: ManualSavings) {}

  @Get()
  list(): ManualSavingsResponse {
    return this.savings.list();
  }

  @Post()
  create(@Body() body: unknown): ManualSavingsAccount {
    return this.savings.create(body);
  }

  @Put(':id')
  rename(@Param('id') id: string, @Body() body: unknown): ManualSavingsAccount {
    return this.savings.rename(this.accountId(id), body);
  }

  @Post(':id/close')
  close(@Param('id') id: string, @Body() body: unknown): ManualSavingsAccount {
    return this.savings.close(this.accountId(id), body);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string): ManualSavingsAccount {
    return this.savings.reopen(this.accountId(id));
  }

  @Post(':id/entries')
  addEntry(@Param('id') id: string, @Body() body: unknown): ManualSavingsAccount {
    return this.savings.addEntry(this.accountId(id), body);
  }

  @Put(':id/entries/:entryId')
  updateEntry(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() body: unknown,
  ): ManualSavingsAccount {
    return this.savings.updateEntry(
      this.accountId(id),
      parseId(entryId, new NoSuchBalanceEntry()),
      body,
    );
  }

  @Delete(':id/entries/:entryId')
  deleteEntry(@Param('id') id: string, @Param('entryId') entryId: string): ManualSavingsAccount {
    return this.savings.deleteEntry(this.accountId(id), parseId(entryId, new NoSuchBalanceEntry()));
  }

  private accountId(value: string): number {
    return parseId(value, new NoSuchManualSavingsAccount());
  }
}

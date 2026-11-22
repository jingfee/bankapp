import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { MortgageResponse } from '@bankapp/shared';
import { NoSuchLoanPart, NoSuchMortgageEntry } from '../domain-errors';
import { parseId } from '../transactions/ids';
import { Mortgage } from './mortgage';

@Controller('mortgage')
export class MortgageController {
  constructor(private readonly mortgage: Mortgage) {}

  @Get()
  get(): MortgageResponse {
    return this.mortgage.get();
  }

  @Post('parts')
  addPart(@Body() body: unknown): MortgageResponse {
    return this.mortgage.addPart(body);
  }

  @Put('parts/:id')
  updatePart(@Param('id') id: string, @Body() body: unknown): MortgageResponse {
    return this.mortgage.updatePart(this.partId(id), body);
  }

  @Post('parts/:id/end')
  endPart(@Param('id') id: string, @Body() body: unknown): MortgageResponse {
    return this.mortgage.endPart(this.partId(id), body);
  }

  @Post('parts/:id/rate-changes')
  addRateChange(@Param('id') id: string, @Body() body: unknown): MortgageResponse {
    return this.mortgage.addRateChange(this.partId(id), body);
  }

  @Post('parts/:id/amortisation-changes')
  addAmortisationChange(@Param('id') id: string, @Body() body: unknown): MortgageResponse {
    return this.mortgage.addAmortisationChange(this.partId(id), body);
  }

  @Post('entries')
  addEntry(@Body() body: unknown): MortgageResponse {
    return this.mortgage.addEntry(body);
  }

  @Put('entries/:id')
  updateEntry(@Param('id') id: string, @Body() body: unknown): MortgageResponse {
    return this.mortgage.updateEntry(this.entryId(id), body);
  }

  @Delete('entries/:id')
  deleteEntry(@Param('id') id: string): MortgageResponse {
    return this.mortgage.deleteEntry(this.entryId(id));
  }

  private partId(value: string): number {
    return parseId(value, new NoSuchLoanPart());
  }

  private entryId(value: string): number {
    return parseId(value, new NoSuchMortgageEntry());
  }
}

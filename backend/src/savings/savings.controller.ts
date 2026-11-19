import { Controller, Get } from '@nestjs/common';
import type { SavingsResponse } from '@bankapp/shared';
import { Savings } from './savings';

@Controller('savings')
export class SavingsController {
  constructor(private readonly savings: Savings) {}

  /** Every savings account with its monthly history and the current totals. */
  @Get()
  get(): SavingsResponse {
    return this.savings.overview();
  }
}

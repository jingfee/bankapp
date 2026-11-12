import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { OverviewResponse, OverviewTransactionsResponse } from '@bankapp/shared';
import { OverviewService, isMonth } from './overview.service';

@Controller('overview')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  /** The month's totals and breakdown; `month` is `YYYY-MM` and defaults to the current month. */
  @Get()
  get(@Query('month') month?: string): OverviewResponse {
    return this.overview.overview(this.validMonth(month ?? this.overview.currentMonth()));
  }

  @Get('transactions')
  transactions(
    @Query('month') month?: string,
    @Query('subcategoryId') subcategoryId?: string,
  ): OverviewTransactionsResponse {
    if (month === undefined || subcategoryId === undefined || !/^\d{1,15}$/.test(subcategoryId)) {
      throw new BadRequestException('month and subcategoryId are required');
    }
    return this.overview.listForSubcategory(this.validMonth(month), Number(subcategoryId));
  }

  private validMonth(month: string): string {
    if (!isMonth(month)) throw new BadRequestException('month must be YYYY-MM');
    return month;
  }
}

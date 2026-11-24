import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { OverviewResponse, OverviewTransactionsResponse, OverviewView } from '@bankapp/shared';
import { isMonth } from '../calendar';
import { OverviewService } from './overview.service';

@Controller('overview')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  /** The month's totals and breakdown; `month` is `YYYY-MM` and defaults to the current month. */
  @Get()
  get(@Query('month') month?: string, @Query('view') view?: string): OverviewResponse {
    return this.overview.overview(
      this.validMonth(month ?? this.overview.currentMonth()),
      this.validView(view),
    );
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

  /** `view` is `mine` (Min andel) or `full` (Hela beloppet, the default). */
  private validView(view: string | undefined): OverviewView {
    if (view === undefined) return 'full';
    if (view !== 'mine' && view !== 'full')
      throw new BadRequestException('view must be mine or full');
    return view;
  }

  private validMonth(month: string): string {
    if (!isMonth(month)) throw new BadRequestException('month must be YYYY-MM');
    return month;
  }
}

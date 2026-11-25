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

  /**
   * The transactions behind the month's breakdown: every categorised one, or only those of
   * `subcategoryId` when it is given. The app reads the whole month once, so a month it has
   * saved can be drilled into offline (ADR 0017).
   */
  @Get('transactions')
  transactions(
    @Query('month') month?: string,
    @Query('subcategoryId') subcategoryId?: string,
  ): OverviewTransactionsResponse {
    if (month === undefined) throw new BadRequestException('month is required');
    if (subcategoryId === undefined) return this.overview.listForMonth(this.validMonth(month));
    if (!/^\d{1,15}$/.test(subcategoryId)) {
      throw new BadRequestException('subcategoryId must be a number');
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

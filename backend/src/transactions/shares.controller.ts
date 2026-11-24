import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import type {
  HouseholdRatioEntry,
  HouseholdRatioResponse,
  SubcategorySharesResponse,
  TransactionDetails,
} from '@bankapp/shared';
import { CLOCK, type Clock } from '../clock';
import { loadTransactionDetails } from '../accounts/transaction-details';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { NoSuchAccount, NoSuchSubcategory, NoSuchTransaction } from '../domain-errors';
import { parseId } from './ids';
import { Shares, inForceFrom } from './shares';

const shareOf = (body: unknown) => ((body ?? {}) as { share?: unknown }).share;

@Controller()
export class SharesController {
  constructor(
    private readonly shares: Shares,
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Sets the account's share option; Jag clears it. Hushåll needs a household ratio first. */
  @Put('accounts/:id/share')
  setAccountShare(@Param('id') id: string, @Body() body: unknown): void {
    this.shares.setAccountShare(parseId(id, new NoSuchAccount()), shareOf(body));
  }

  /** The subcategories whose share is not Jag. */
  @Get('subcategory-shares')
  subcategoryShares(): SubcategorySharesResponse {
    return { shares: this.shares.subcategoryShares() };
  }

  /** Sets the subcategory's share option; Jag clears it. Hushåll needs a household ratio first. */
  @Put('subcategories/:id/share')
  setSubcategoryShare(@Param('id') id: string, @Body() body: unknown): void {
    this.shares.setSubcategoryShare(parseId(id, new NoSuchSubcategory()), shareOf(body));
  }

  /** Sets the transaction's own share, or removes it with `share: null`. */
  @Put('transactions/:id/share')
  setTransactionShare(@Param('id') id: string, @Body() body: unknown): TransactionDetails {
    const transactionId = parseId(id, new NoSuchTransaction());
    this.shares.setTransactionShare(transactionId, shareOf(body));
    const details = loadTransactionDetails(this.db, transactionId);
    if (details === null) throw new NoSuchTransaction();
    return details;
  }

  @Get('household-ratio')
  householdRatio(): HouseholdRatioResponse {
    return this.ratioResponse(this.shares.householdRatio());
  }

  /** Replaces the list; it needs at least one entry, each a date and a whole percentage 1-99. */
  @Put('household-ratio')
  setHouseholdRatio(@Body() body: unknown): HouseholdRatioResponse {
    return this.ratioResponse(
      this.shares.setHouseholdRatio(((body ?? {}) as { entries?: unknown }).entries),
    );
  }

  private ratioResponse(entries: HouseholdRatioEntry[]): HouseholdRatioResponse {
    return { entries, inForceFrom: inForceFrom(entries, this.clock.today()) };
  }
}

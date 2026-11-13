import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import type {
  AccountsResponse,
  HouseholdRatioResponse,
  OffsetCandidatesResponse,
  TransactionCategoryResponse,
  TransactionDetails,
  TransactionReviewCountResponse,
  TransactionReviewResponse,
  TransactionsResponse,
} from '@bankapp/shared';
import { SHARE_OPTIONS, type ShareOption } from '@bankapp/shared';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(): AccountsResponse {
    return this.accounts.listByBank();
  }

  /** Hides or shows an account with `hidden: true` or `false`. */
  @Put(':id/hidden')
  setHidden(@Param('id') id: string, @Body() body: unknown): void {
    const { hidden } = (body ?? {}) as { hidden?: unknown };
    if (typeof hidden !== 'boolean') throw new BadRequestException('hidden must be true or false');
    if (!isId(id) || this.accounts.setHidden(Number(id), hidden) === 'no-account') {
      throw new NotFoundException('There is no such account');
    }
  }

  /** Sets the account's share option; Jag clears it. Hushåll needs a household ratio first. */
  @Put(':id/share')
  setShare(@Param('id') id: string, @Body() body: unknown): void {
    const { share } = (body ?? {}) as { share?: unknown };
    if (!SHARE_OPTIONS.includes(share as ShareOption)) {
      throw new BadRequestException(`share must be one of ${SHARE_OPTIONS.join(', ')}`);
    }
    const result = isId(id)
      ? this.accounts.setShare(Number(id), share as ShareOption)
      : 'no-account';
    if (result === 'no-account') throw new NotFoundException('There is no such account');
    if (result === 'no-ratio') {
      throw new ConflictException('Set a household ratio before choosing Hushåll');
    }
  }
}

@Controller('household-ratio')
export class HouseholdRatioController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  get(): HouseholdRatioResponse {
    return { entries: this.accounts.householdRatio() };
  }

  /** Replaces the list; it needs at least one entry, each a date and a whole percentage 1-99. */
  @Put()
  set(@Body() body: unknown): HouseholdRatioResponse {
    const { entries } = (body ?? {}) as { entries?: unknown };
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new BadRequestException('entries must be a list with at least one entry');
    }
    const seen = new Set<string>();
    for (const entry of entries as { from?: unknown; percent?: unknown }[]) {
      const { from, percent } = entry ?? {};
      if (
        typeof from !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        Number.isNaN(Date.parse(from)) ||
        new Date(from).toISOString().slice(0, 10) !== from
      ) {
        throw new BadRequestException('from must be a date, YYYY-MM-DD');
      }
      if (
        typeof percent !== 'number' ||
        !Number.isInteger(percent) ||
        percent < 1 ||
        percent > 99
      ) {
        throw new BadRequestException('percent must be a whole number from 1 to 99');
      }
      if (seen.has(from)) throw new BadRequestException('Two entries cannot start on the same day');
      seen.add(from);
    }
    const list = (entries as { from: string; percent: number }[]).map(({ from, percent }) => ({
      from,
      percent,
    }));
    return { entries: this.accounts.setHouseholdRatio(list) };
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

  /** The guessed and uncategorised transactions, for the owner to review. */
  @Get('review')
  review(): TransactionReviewResponse {
    return this.accounts.listForReview();
  }

  @Get('review/count')
  reviewCount(): TransactionReviewCountResponse {
    return { count: this.accounts.countForReview() };
  }

  @Get(':id')
  get(@Param('id') id: string): TransactionDetails {
    const details = isId(id) ? this.accounts.getTransaction(Number(id)) : null;
    if (details === null) throw new NotFoundException('There is no such transaction');
    return details;
  }

  /** Sets the owner's chosen subcategory as confirmed, or removes it with `subcategoryId: null`. */
  @Put(':id/category')
  setCategory(@Param('id') id: string, @Body() body: unknown): TransactionCategoryResponse {
    if (!isId(id)) throw new NotFoundException('There is no such transaction');
    const { subcategoryId } = (body ?? {}) as { subcategoryId?: unknown };
    if (
      subcategoryId !== null &&
      !(typeof subcategoryId === 'number' && Number.isInteger(subcategoryId))
    ) {
      throw new BadRequestException('subcategoryId must be a subcategory id or null');
    }
    const result = this.accounts.setCategory(Number(id), subcategoryId);
    if (result === 'no-transaction') throw new NotFoundException('There is no such transaction');
    if (result === 'no-subcategory') throw new BadRequestException('There is no such subcategory');
    if (result === 'offset') {
      throw new ConflictException('A kvittad refund follows its purchase; change the purchase');
    }
    return result;
  }

  /** Purchases the money-in transaction could be offset against, ranked, or found by `q`. */
  @Get(':id/offset-candidates')
  offsetCandidates(@Param('id') id: string, @Query('q') q?: string): OffsetCandidatesResponse {
    const result = isId(id) ? this.accounts.offsetCandidates(Number(id), q) : 'no-transaction';
    if (result === 'no-transaction') throw new NotFoundException('There is no such transaction');
    return result;
  }

  /** Offsets the transaction against a purchase, or removes the link with `purchaseId: null`. */
  @Put(':id/offset')
  setOffset(@Param('id') id: string, @Body() body: unknown): TransactionDetails {
    if (!isId(id)) throw new NotFoundException('There is no such transaction');
    const { purchaseId } = (body ?? {}) as { purchaseId?: unknown };
    if (purchaseId !== null && !(typeof purchaseId === 'number' && Number.isInteger(purchaseId))) {
      throw new BadRequestException('purchaseId must be a transaction id or null');
    }
    const result = this.accounts.setOffset(Number(id), purchaseId);
    if (result === 'no-transaction') throw new NotFoundException('There is no such transaction');
    if (result === 'no-purchase') throw new BadRequestException('There is no such purchase');
    if (result === 'not-linkable') {
      throw new BadRequestException(
        'Only a booked money-in transaction can be offset against a booked purchase in the same currency',
      );
    }
    return result;
  }
}

function isId(value: string): boolean {
  return /^\d{1,15}$/.test(value);
}

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
  OffsetCandidatesResponse,
  TransactionCategoryResponse,
  TransactionDetails,
  TransactionReviewCountResponse,
  TransactionReviewResponse,
  TransactionsResponse,
} from '@bankapp/shared';
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

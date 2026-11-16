import { Controller, Get } from '@nestjs/common';
import type { TransactionReviewCountResponse, TransactionReviewResponse } from '@bankapp/shared';
import { Review } from './review';

@Controller('transactions/review')
export class ReviewController {
  constructor(private readonly review: Review) {}

  /** The guessed and uncategorised transactions, for the owner to review. */
  @Get()
  list(): TransactionReviewResponse {
    return this.review.list();
  }

  @Get('count')
  count(): TransactionReviewCountResponse {
    return { count: this.review.count() };
  }
}

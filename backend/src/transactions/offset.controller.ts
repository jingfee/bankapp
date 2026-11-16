import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import type { OffsetCandidatesResponse, TransactionDetails } from '@bankapp/shared';
import { loadTransactionDetails } from '../accounts/transaction-details';
import { DATABASE } from '../db/database.module';
import type { AppDatabase } from '../db/database';
import { InvalidInput, NoSuchTransaction } from '../domain-errors';
import { isWholeNumber, parseId } from './ids';
import { Offset } from './offset';

@Controller('transactions')
export class OffsetController {
  constructor(
    private readonly offset: Offset,
    @Inject(DATABASE) private readonly db: AppDatabase,
  ) {}

  /** Purchases the money-in transaction could be offset against, ranked, or found by `q`. */
  @Get(':id/offset-candidates')
  candidates(@Param('id') id: string, @Query('q') q?: string): OffsetCandidatesResponse {
    return this.offset.candidates(parseId(id, new NoSuchTransaction()), q);
  }

  /** Offsets the transaction against a purchase, or removes the link with `purchaseId: null`. */
  @Put(':id/offset')
  link(@Param('id') id: string, @Body() body: unknown): TransactionDetails {
    const transactionId = parseId(id, new NoSuchTransaction());
    const { purchaseId } = (body ?? {}) as { purchaseId?: unknown };
    if (purchaseId !== null && !isWholeNumber(purchaseId)) {
      throw new InvalidInput('purchaseId must be a transaction id or null');
    }
    this.offset.link(transactionId, purchaseId);
    return loadTransactionDetails(this.db, transactionId) ?? failMissing();
  }
}

function failMissing(): never {
  throw new NoSuchTransaction();
}

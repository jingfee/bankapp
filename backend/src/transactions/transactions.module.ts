import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { ManualTransactions } from './manual-transactions';
import { ManualTransactionsController } from './manual-transactions.controller';
import { Offset } from './offset';
import { OffsetController } from './offset.controller';
import { Replace } from './replace';
import { ReplaceController } from './replace.controller';
import { Review } from './review';
import { ReviewController } from './review.controller';
import { Shares } from './shares';
import { SharesController } from './shares.controller';

/**
 * The owner's decisions about transactions. Registered before the accounts module, whose
 * `transactions/:id` route would otherwise catch `transactions/review`.
 */
@Module({
  imports: [CategoriesModule],
  controllers: [
    ReviewController,
    ReplaceController,
    ManualTransactionsController,
    OffsetController,
    SharesController,
  ],
  providers: [Offset, Replace, ManualTransactions, Review, Shares],
})
export class TransactionsModule {}
